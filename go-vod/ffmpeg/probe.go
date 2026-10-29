
package ffmpeg

// Package ffmpeg probes media files, reads stream metadata,
// identifies HDR formats, and extracts keyframe timestamps.

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

// VideoInfo describes the first video stream and first audio stream.
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

// AudioInfo describes the first audio stream.
// All fields remain zero-valued for silent video.
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

	BitsPerRawSample string `json:"bits_per_raw_sample"`
}

type probeOutput struct {
	Streams []videoStream   `json:"streams"`
	Format  *ffprobe.Format `json:"format"`
}

// Probe executes ffprobe and returns metadata for the first video
// stream, with metadata from the first audio stream if present.
func Probe(
	ctx context.Context,
	bin, fileURL, headers string,
) (VideoInfo, error) {
	ctx, cancel := context.WithTimeout(ctx, probeTimeout)
	defer cancel()

	args := []string{"-v", "error"}

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
		return VideoInfo{}, probeError(
			ctx, "ffprobe", fileURL, serr, err,
		)
	}

	return ParseProbeJSON(out)
}

// runFFprobe executes the requested binary without using a shell.
// This avoids shell interpretation of input URLs and headers.
func runFFprobe(
	ctx context.Context,
	bin string,
	args ...string,
) (stdout, stderr []byte, err error) {
	cmd := exec.CommandContext(ctx, bin, args...)

	var out, serr bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &serr

	err = cmd.Run()

	return out.Bytes(), serr.Bytes(), err
}

func probeError(
	ctx context.Context,
	operation, fileURL string,
	stderr []byte,
	err error,
) error {
	if ctx.Err() != nil {
		err = ctx.Err()
	}

	message := strings.TrimSpace(string(stderr))

	if message == "" {
		return fmt.Errorf("%s %q: %w",
			operation, fileURL, err)
	}

	return fmt.Errorf("%s %q: %w: %s",
		operation, fileURL, err, message)
}

// ParseProbeJSON parses ffprobe JSON output.
func ParseProbeJSON(data []byte) (VideoInfo, error) {
	var out probeOutput

	if err := json.Unmarshal(data, &out); err != nil {
		return VideoInfo{}, fmt.Errorf(
			"invalid ffprobe JSON: %w", err,
		)
	}

	var video *videoStream

	for i := range out.Streams {
		if out.Streams[i].CodecType == "video" {
			video = &out.Streams[i]
			break
		}
	}

	if video == nil {
		return VideoInfo{}, errors.New(
			"no video streams found",
		)
	}

	fps := exactFrameRate(
		video.AvgFrameRate,
		video.NominalFrameRate,
	)

	bitRate := parsePositiveInt(video.BitRate)
	if bitRate == 0 {
		if out.Format != nil {
			bitRate = parsePositiveInt(out.Format.BitRate)
		}
	}
	if bitRate == 0 {
		bitRate = defaultBitRate
	}

	depth := probeBitDepth(video.PixFmt)

	if rawDepth := parsePositiveInt(
		video.BitsPerRawSample,
	); rawDepth >= 8 && rawDepth <= 32 {
		depth = rawDepth
	}

	return VideoInfo{
		Width:          video.Width,
		Height:         video.Height,
		Duration:       probeDuration(*video, out.Format),
		FrameRate:      int(math.Round(fps)),
		FrameRateExact: fps,
		PixelFormat:    video.PixFmt,
		CodecName:      video.CodecName,
		BitRate:        bitRate,
		Rotation:       probeRotation(*video),
		HDR:            probeHDR(*video),
		BitDepth:       depth,
		Audio:          probeAudio(out.Streams),
	}, nil
}

// probeDuration uses stream duration when valid, otherwise
// falls back to container duration.
func probeDuration(
	s videoStream,
	format *ffprobe.Format,
) time.Duration {
	if duration, ok := parseDuration(s.Duration); ok {
		return duration
	}

	if format != nil {
		duration := format.Duration()
		if duration > 0 {
			return duration
		}
	}

	return 0
}

func parseDuration(value string) (time.Duration, bool) {
	seconds, err := strconv.ParseFloat(value, 64)

	if err != nil ||
		math.IsNaN(seconds) ||
		math.IsInf(seconds, 0) ||
		seconds <= 0 ||
		seconds > float64(math.MaxInt64)/float64(time.Second) {
		return 0, false
	}

	return time.Duration(seconds * float64(time.Second)), true
}

func parsePositiveInt(value string) int {
	number, err := strconv.Atoi(value)
	if err != nil || number <= 0 {
		return 0
	}
	return number
}

// probeAudio finds the first valid audio stream.
func probeAudio(streams []videoStream) AudioInfo {
	for i := range streams {
		s := &streams[i]

		if s.CodecType != "audio" ||
			s.CodecName == "" {
			continue
		}

		return AudioInfo{
			CodecName:  s.CodecName,
			Channels:   s.Channels,
			SampleRate: parsePositiveInt(s.SampleRate),
			BitRate:    parsePositiveInt(s.BitRate),
		}
	}

	return AudioInfo{}
}

// parseFrameRate preserves the existing integer-returning helper.
func parseFrameRate(frac string) int {
	return int(math.Round(exactFrameRate(frac)))
}

// exactFrameRate parses rational or decimal frame rates.
// Values outside 1-240 fps are treated as invalid.
func exactFrameRate(values ...string) float64 {
	for _, value := range values {
		value = strings.TrimSpace(value)

		var fps float64

		if num, den, ok := strings.Cut(value, "/"); ok {
			n, e1 := strconv.ParseFloat(num, 64)
			d, e2 := strconv.ParseFloat(den, 64)

			if e1 != nil || e2 != nil || d <= 0 {
				continue
			}

			fps = n / d
		} else {
			var err error
			fps, err = strconv.ParseFloat(value, 64)
			if err != nil {
				continue
			}
		}

		if !math.IsNaN(fps) &&
			!math.IsInf(fps, 0) &&
			fps >= 1 &&
			fps <= 240 {
			return fps
		}
	}

	return float64(defaultFrameNum) /
		float64(defaultFrameDen)
}

// probeRotation prefers display matrix rotation over metadata tags.
func probeRotation(s videoStream) int {
	for _, sd := range s.SideDataList {
		if strings.EqualFold(
			sd.SideDataType, "Display Matrix",
		) {
			return normalizeRotation(sd.Rotation)
		}
	}

	return normalizeRotation(s.Tags.Rotate)
}

func normalizeRotation(rotation int) int {
	rotation %= 360

	if rotation < 0 {
		rotation += 360
	}

	return rotation
}

// probeBitDepth identifies the logical sample depth,
// not the storage container size.
//
// Examples:
// nv12     -> 8
// yuv420p10le -> 10
// p010le   -> 10
// p012le   -> 12
// p016le   -> 16
// nv15     -> 10
func probeBitDepth(pixFmt string) int {
	pixFmt = strings.ToLower(strings.TrimSpace(pixFmt))

	switch pixFmt {
	case "nv15", "nv20", "nv30":
		return 10
	case "p010le", "p010be",
		"p210le", "p210be",
		"p410le", "p410be",
		"y210le", "y210be",
		"y410":
		return 10
	case "p012le", "p012be",
		"y212le", "y212be",
		"y412":
		return 12
	case "p016le", "p016be",
		"p216le", "p216be",
		"p416le", "p416be",
		"y216le", "y216be",
		"y416":
		return 16
	}

	// Standard planar formats include the bit depth
	// directly before their endianness suffix.
	// Examples: yuv420p10le, gbrp12be, gray16le.
	for _, depth := range []int{16, 14, 12, 10, 9} {
		suffix := strconv.Itoa(depth)

		if strings.HasSuffix(pixFmt, suffix+"le") ||
			strings.HasSuffix(pixFmt, suffix+"be") {
			return depth
		}
	}

	return 8
}

// probeHDR detects HDR10, HLG and Dolby Vision using
// available ffprobe color and side-data metadata.
func probeHDR(s videoStream) bool {
	transfer := strings.ToLower(s.ColorTransfer)

	switch transfer {
	case "smpte2084", "arib-std-b67":
		return true
	}

	switch strings.ToLower(s.CodecName) {
	case "dvav", "dva1", "dvhe",
		"dvh1", "dvh2", "dvh3",
		"dvc1", "dav1":
		return true
	}

	for _, sd := range s.SideDataList {
		name := strings.ToLower(sd.SideDataType)

		if strings.Contains(name, "dolby vision") ||
			strings.Contains(name, "dovi configuration") ||
			strings.Contains(name, "hdr dynamic metadata") {
			return true
		}
	}

	// BT.2020 alone does not conclusively mean HDR.
	// Use sample depth as an additional indication.
	if s.ColorSpace == "bt2020nc" ||
		s.ColorSpace == "bt2020c" ||
		s.ColorPrimaries == "bt2020" {
		depth := probeBitDepth(s.PixFmt)

		if rawDepth := parsePositiveInt(
			s.BitsPerRawSample,
		); rawDepth >= 8 && rawDepth <= 32 {
			depth = rawDepth
		}

		return depth > 8
	}

	return false
}

// Keyframes returns packet PTS values in seconds for
// keyframes in the first video stream.
func Keyframes(
	ctx context.Context,
	bin, fileURL, headers string,
) ([]float64, error) {
	ctx, cancel := context.WithTimeout(
		ctx, keyframeTimeout,
	)
	defer cancel()

	args := []string{"-v", "error"}

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
		return nil, probeError(
			ctx, "ffprobe keyframes",
			fileURL, serr, err,
		)
	}

	return ParseKeyframes(out), nil
}

// ParseKeyframes extracts valid keyframe timestamps
// from FFprobe CSV packet output.
//
// Invalid, negative and non-finite timestamps are ignored.
func ParseKeyframes(data []byte) []float64 {
	var timestamps []float64

	for line := range strings.SplitSeq(
		string(data), "\n",
	) {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		fields := strings.Split(line, ",")
		if len(fields) < 2 {
			continue
		}

		var timestamp string
		var flags string

		// FFprobe normally emits:
		// 0.000000,K_
		//
		// Accept both possible field orders.
		for _, field := range fields {
			field = strings.TrimSpace(field)

			if strings.HasPrefix(field, "K") {
				flags = field
			} else if timestamp == "" {
				if value, err := strconv.ParseFloat(
					field, 64,
				); err == nil &&
					!math.IsNaN(value) &&
					!math.IsInf(value, 0) &&
					value >= 0 {
					timestamp = field
				}
			}
		}

		if flags == "" || timestamp == "" {
			continue
		}

		ts, err := strconv.ParseFloat(timestamp, 64)
		if err != nil {
			continue
		}

		timestamps = append(timestamps, ts)
	}

	return timestamps
}
