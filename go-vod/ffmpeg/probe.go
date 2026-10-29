// Package ffmpeg owns everything that shells out to the ffmpeg toolchain:
// probing inputs, building transcoder arguments and naming output segments.
package ffmpeg

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os/exec"
	"strconv"
	"strings"
	"time"

	ffprobe "github.com/vansante/go-ffprobe"
)

const (
	EncoderCopy  = "copy"
	EncoderX264  = "libx264"
	EncoderVAAPI = "h264_vaapi"
	EncoderNVENC = "h264_nvenc"

	QualityMax = "max"
	CodecH264  = "h264"

	probeTimeout    = 5 * time.Second
	keyframeTimeout = 5 * time.Minute
	defaultBitRate  = 5000000
	defaultFrameNum = 30
	defaultFrameDen = 1
)

type VideoInfo struct {
	Width          int
	Height         int
	Duration       time.Duration
	FrameRate      int
	FrameRateExact float64
	PixelFormat    string
	CodecName      string
	BitRate        int
	Rotation       int
	HDR            bool
	BitDepth       int
	Audio          AudioInfo
}

// AudioInfo describes the first audio stream; empty when silent.
type AudioInfo struct {
	CodecName  string
	Channels   int
	SampleRate int
	BitRate    int
}

type sideData struct {
	SideDataType string `json:"side_data_type"`
	Rotation     int    `json:"rotation"`
}

type videoStream struct {
	ffprobe.Stream
	NominalFrameRate string     `json:"r_frame_rate"`
	SideDataList     []sideData `json:"side_data_list"`
	ColorTransfer    string     `json:"color_transfer"`
	ColorPrimaries   string     `json:"color_primaries"`
	BitsPerRawSample string     `json:"bits_per_raw_sample"`
}

type probeOutput struct {
	Streams []videoStream   `json:"streams"`
	Format  *ffprobe.Format `json:"format"`
}

// Probe runs ffprobe and parses the first video stream.
func Probe(ctx context.Context, bin, fileURL, headers string) (VideoInfo, error) {
	ctx, cancel := context.WithTimeout(ctx, probeTimeout)
	defer cancel()

	args := []string{
		"-v", "error",
	}
	if headers != "" {
		args = append(args, "-headers", headers)
	}
	args = append(args,
		"-show_entries", "format:stream",
		"-of", "json",
		"-i", fileURL,
	)
	out, serr, err := runFFprobe(ctx, bin, args...)
	if err != nil {
		if ctx.Err() != nil {
			err = ctx.Err()
		}
		return VideoInfo{}, fmt.Errorf("ffprobe %s: %w: %s", fileURL, err, serr)
	}
	return ParseProbeJSON(out)
}

// runFFprobe executes the binary, capturing stdout and stderr.
func runFFprobe(ctx context.Context, bin string, args ...string) (stdout, stderr []byte, err error) {
	cmd := exec.CommandContext(ctx, bin, args...)
	var out, serr bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &serr
	err = cmd.Run()
	return out.Bytes(), serr.Bytes(), err
}

// ParseProbeJSON parses Probe output, defaulting missing fields.
func ParseProbeJSON(data []byte) (VideoInfo, error) {
	var out probeOutput
	if err := json.Unmarshal(data, &out); err != nil {
		return VideoInfo{}, err
	}
	var s *videoStream
	for i := range out.Streams {
		if out.Streams[i].CodecType == "video" {
			s = &out.Streams[i]
			break
		}
	}
	if s == nil {
		return VideoInfo{}, errors.New("no video streams found")
	}

	duration := parseDuration(s.Duration)
	if duration == 0 && out.Format != nil {
		duration = durationFromSeconds(out.Format.DurationSeconds)
	}

	bitRate := positiveInt(s.BitRate)
	if bitRate == 0 && out.Format != nil {
		bitRate = positiveInt(out.Format.BitRate)
	}
	if bitRate == 0 {
		bitRate = defaultBitRate
	}

	return VideoInfo{
		Width:          s.Width,
		Height:         s.Height,
		Duration:       duration,
		FrameRate:      parseFrameRate(s.AvgFrameRate),
		FrameRateExact: exactFrameRate(s.NominalFrameRate, s.AvgFrameRate),
		PixelFormat:    s.PixFmt,
		CodecName:      s.CodecName,
		BitRate:        bitRate,
		Rotation:       probeRotation(*s),
		HDR:            probeHDR(*s),
		BitDepth:       streamBitDepth(*s),
		Audio:          probeAudio(out.Streams),
	}, nil
}

func parseDuration(value string) time.Duration {
	seconds, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return 0
	}
	return durationFromSeconds(seconds)
}

func durationFromSeconds(seconds float64) time.Duration {
	if math.IsNaN(seconds) || math.IsInf(seconds, 0) || seconds <= 0 || seconds >= float64(math.MaxInt64)/float64(time.Second) {
		return 0
	}
	return time.Duration(seconds * float64(time.Second))
}

func positiveInt(value string) int {
	n, err := strconv.Atoi(value)
	if err != nil || n <= 0 {
		return 0
	}
	return n
}

// probeAudio describes the first audio stream; empty when silent.
func probeAudio(streams []videoStream) AudioInfo {
	for i := range streams {
		st := &streams[i]
		if st.CodecType != "audio" || st.CodecName == "" {
			continue
		}
		return AudioInfo{
			CodecName:  st.CodecName,
			Channels:   st.Channels,
			SampleRate: positiveInt(st.SampleRate),
			BitRate:    positiveInt(st.BitRate),
		}
	}
	return AudioInfo{}
}

// parseFrameRate parses a "num/den" frame rate, defaulting to 30fps.
func parseFrameRate(frac string) int {
	parts := strings.Split(frac, "/")
	if len(parts) != 2 {
		return defaultFrameNum
	}
	num, e1 := strconv.Atoi(parts[0])
	den, e2 := strconv.Atoi(parts[1])
	if e1 != nil || e2 != nil || den == 0 {
		num, den = defaultFrameNum, defaultFrameDen
	}
	return int(float64(num) / float64(den))
}

// probeRotation reads rotation from display-matrix side data, else tags.
func probeRotation(s videoStream) int {
	for _, sd := range s.SideDataList {
		if strings.EqualFold(sd.SideDataType, "Display Matrix") {
			return NormalizeRotation(sd.Rotation)
		}
	}
	// Legacy rotate tags are clockwise; display matrices are counterclockwise.
	return NormalizeRotation(-s.Tags.Rotate)
}

// probeBitDepth reads sample depth from the pix_fmt name, 8 when unknown.
// Matched on explicit suffixes since Contains "12" would match nv12.
func probeBitDepth(pixFmt string) int {
	pixFmt = strings.ToLower(strings.TrimSpace(pixFmt))
	switch pixFmt {
	case "nv15", "nv20", "nv30", "y410":
		return 10
	case "y412":
		return 12
	case "y416":
		return 16
	}
	for _, depth := range []int{9, 10, 12, 14, 16} {
		d := strconv.Itoa(depth)
		if strings.HasSuffix(pixFmt, d+"le") || strings.HasSuffix(pixFmt, d+"be") {
			return depth
		}
	}
	return 8
}

func streamBitDepth(s videoStream) int {
	if depth := positiveInt(s.BitsPerRawSample); depth >= 8 && depth <= 32 {
		return depth
	}
	return probeBitDepth(s.PixFmt)
}

// probeHDR detects HDR from transfer and color metadata.
func probeHDR(s videoStream) bool {
	switch strings.ToLower(s.ColorTransfer) {
	case "smpte2084", "arib-std-b67":
		return true
	}
	// Dolby Vision by codec or RPU side data, including profile 8 tucked
	// into HEVC streams whose transfer tags look SDR alone. Explicit names
	// only: prefix-matching "dv" would catch SDR dvvideo.
	switch strings.ToLower(s.CodecName) {
	case "dvav", "dva1", "dvhe", "dvh1", "dvh2", "dvh3", "dvc1", "dav1":
		return true
	}
	for _, sd := range s.SideDataList {
		name := strings.ToLower(sd.SideDataType)
		if strings.Contains(name, "dolby vision") || strings.Contains(name, "dovi configuration") || strings.Contains(name, "hdr dynamic metadata") {
			return true
		}
	}
	// Wide-gamut 10-bit SDR is not HDR. Infer HDR from BT.2020 only when
	// transfer metadata is missing, never over an explicit SDR transfer tag.
	transfer := strings.ToLower(strings.TrimSpace(s.ColorTransfer))
	if transfer != "" && transfer != "unknown" && transfer != "unspecified" {
		return false
	}
	if s.ColorSpace == "bt2020nc" || s.ColorSpace == "bt2020c" || s.ColorPrimaries == "bt2020" {
		return streamBitDepth(s) > 8
	}
	return false
}

// Keyframes runs ffprobe and parses keyframe timestamps in seconds.
func Keyframes(ctx context.Context, bin, fileURL, headers string) ([]float64, error) {
	ctx, cancel := context.WithTimeout(ctx, keyframeTimeout)
	defer cancel()

	args := []string{
		"-v", "error",
	}
	if headers != "" {
		args = append(args, "-headers", headers)
	}
	args = append(args,
		"-select_streams", "v:0",
		"-show_entries", "packet=pts_time,flags",
		"-of", "csv=p=0",
		"-i", fileURL,
	)
	out, serr, err := runFFprobe(ctx, bin, args...)
	if err != nil {
		if ctx.Err() != nil {
			err = ctx.Err()
		}
		return nil, fmt.Errorf("ffprobe keyframes %s: %w: %s", fileURL, err, serr)
	}
	return ParseKeyframes(out), nil
}

// ParseKeyframes parses Keyframes output, keeping keyframe (K) packets,
// so garbage yields an empty slice and callers fall back to re-encoding.
func ParseKeyframes(data []byte) []float64 {
	var out []float64
	for line := range strings.SplitSeq(string(data), "\n") {
		pts, flags, _ := strings.Cut(strings.TrimSpace(line), ",")
		if strings.HasPrefix(pts, "K") {
			pts, flags = flags, pts
		}
		if !strings.Contains(flags, "K") {
			continue
		}
		if ts, err := strconv.ParseFloat(pts, 64); err == nil && ts >= 0 && !math.IsNaN(ts) && !math.IsInf(ts, 0) {
			out = append(out, ts)
		}
	}
	return out
}

func exactFrameRate(values ...string) float64 {
	for _, value := range values {
		value = strings.TrimSpace(value)
		num, den, ok := strings.Cut(value, "/")
		if !ok {
			num, den = value, "1"
		}
		n, e1 := strconv.ParseFloat(num, 64)
		d, e2 := strconv.ParseFloat(den, 64)
		if e1 == nil && e2 == nil && d > 0 && n/d >= 1 && n/d <= 240 {
			return n / d
		}
	}
	return 30
}
