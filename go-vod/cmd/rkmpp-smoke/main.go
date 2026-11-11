// rkmpp-smoke is an offline hardware preflight for the RK3588 go-vod 0.7.1
// FFmpeg argument builder. It does not contact Nextcloud or run a server.
package main

import (
	"bytes"
	"context"
	"errors"
	"flag"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/pulsejet/memories/go-vod/ffmpeg"
)

func evenDimension(v int) int {
	if v < 2 {
		return 2
	}
	return v &^ 1
}

func targetDimensions(width, height int) (int, int) {
	if width < 2 || height < 2 {
		return 0, 0
	}
	// Keep RAW source orientation. go-vod rotates only after RGA scaling.
	long := max(width, height)
	short := min(width, height)
	ratio := math.Min(1, math.Min(1280/float64(long), 720/float64(short)))
	return evenDimension(int(float64(width) * ratio)), evenDimension(int(float64(height) * ratio))
}

func hasFlagValue(args []string, flag, want string) bool {
	for i := 0; i+1 < len(args); i++ {
		if args[i] == flag && args[i+1] == want {
			return true
		}
	}
	return false
}

func checkCapabilities(ctx context.Context, ffbin string) error {
	for _, tc := range []struct {
		option, required string
	}{
		{"-encoders", "h264_rkmpp"},
		{"-encoders", "hevc_rkmpp"},
		{"-hwaccels", "rkmpp"},
		{"-filters", "scale_rkrga"},
		{"-filters", "vpp_rkrga"},
	} {
		c, cancel := context.WithTimeout(ctx, 20*time.Second)
		out, err := exec.CommandContext(c, ffbin, "-hide_banner", tc.option).CombinedOutput()
		cancel()
		if err != nil {
			return fmt.Errorf("%s failed: %w: %s", tc.option, err, out)
		}
		if !strings.Contains(string(out), tc.required) {
			return fmt.Errorf("FFmpeg %s missing %q: wrong image/FFmpeg build", tc.option, tc.required)
		}
		fmt.Printf("OK: FFmpeg supports %s\n", tc.required)
	}
	return nil
}

func run(ctx context.Context, input, output, codec string, start, seconds float64, opencl bool) error {
	ffbin, err := exec.LookPath("ffmpeg")
	if err != nil {
		return err
	}
	probebin, err := exec.LookPath("ffprobe")
	if err != nil {
		return err
	}
	if err := checkCapabilities(ctx, ffbin); err != nil {
		return err
	}
	if input == "" {
		fmt.Println("Capability check complete. No real hardware was exercised (provide -input).")
		return nil
	}
	if !filepath.IsAbs(input) || !filepath.IsAbs(output) {
		return errors.New("-input and -output must be absolute paths")
	}
	info, err := ffmpeg.Probe(ctx, probebin, input, "")
	if err != nil {
		return fmt.Errorf("probe sample: %w", err)
	}
	if info.DolbyVision {
		return errors.New("Dolby Vision is not supported by the v11 RKMPP pipeline")
	}
	if info.Width < 2 || info.Height < 2 || info.Duration <= 0 {
		return fmt.Errorf("unsupported video dimensions/duration: %dx%d %s", info.Width, info.Height, info.Duration)
	}
	if start >= info.Duration.Seconds() {
		return fmt.Errorf("start %.1fs is beyond video duration %s", start, info.Duration)
	}
	if seconds > info.Duration.Seconds()-start {
		seconds = info.Duration.Seconds() - start
	}
	if seconds < 1 {
		return errors.New("need at least one second of media after seek")
	}
	width, height := targetDimensions(info.Width, info.Height)
	fmt.Printf("Source: %s %dx%d fps=%d pixel=%s depth=%d HDR=%v rotation=%d, target=%dx%d\n",
		info.CodecName, info.Width, info.Height, info.FrameRate, info.PixelFormat,
		info.BitDepth, info.HDR, info.Rotation, width, height)
	if err := os.MkdirAll(output, 0755); err != nil {
		return err
	}
	// Never allow leftovers from an earlier run to satisfy this run's checks.
	output, err = os.MkdirTemp(output, "run-")
	if err != nil {
		return err
	}
	fmt.Printf("Run directory: %s\n", output)
	codecs := []string{"h264", "hevc"}
	if codec != "both" {
		codecs = []string{codec}
	}
	for _, outCodec := range codecs {
		dst := filepath.Join(output, outCodec)
		if err := os.MkdirAll(dst, 0755); err != nil {
			return err
		}
		spec := ffmpeg.Spec{
			Bin: ffbin, Input: input, RKMPP: true, RKMPPOutputCodec: outCodec,
			CodecName: info.CodecName, PixelFormat: info.PixelFormat,
			FrameRate: info.FrameRate, FrameRateExact: info.FrameRateExact,
			Rotation: info.Rotation, HDR: info.HDR, BitDepth: info.BitDepth,
			ColorTransfer: info.ColorTransfer, ColorPrimaries: info.ColorPrimaries,
			ColorSpace: info.ColorSpace, ColorRange: info.ColorRange,
			Width: width, Height: height, QF: 24,
			Bitrate: 3_500_000, HLS: true, ChunkSize: 3,
			StartAt: start, Audio: info.Audio, RKMPPOpenCL: opencl,
		}
		pattern := filepath.Join(dst, "test-%06d.m4s")
		init := filepath.Join(dst, "test-init.mp4")
		playlist := filepath.Join(dst, "test.m3u8")
		segmentNum := int(start / 3)
		args := ffmpeg.SegmentArgs(spec, segmentNum, pattern, init)
		if len(args) == 0 || args[len(args)-1] != "-" {
			return errors.New("unexpected go-vod fMP4 argument layout")
		}
		if !hasFlagValue(args, "-c:v", outCodec+"_rkmpp") {
			return fmt.Errorf("wrong output encoder for %s", outCodec)
		}
		if !hasFlagValue(args, "-hls_segment_type", "fmp4") {
			return errors.New("fMP4 segment flag is missing")
		}
		if !hasFlagValue(args, "-hwaccel", "rkmpp") {
			fmt.Println("WARNING: source needs CPU decode (unsupported surface or HDR CPU fallback). This test does NOT validate hardware decoding.")
		}
		// Keep the production stdout playlist: FFmpeg resolves an absolute
		// init path differently when the playlist itself is a filesystem path.
		// With -copyts the output cutoff is on the absolute source clock.
		args = append(args[:len(args)-1], "-to", fmt.Sprintf("%.6f", start+seconds), "-")
		fmt.Printf("Encoding %s into %s (%.1fs)\n", outCodec, dst, seconds)
		fmt.Printf("FFmpeg: %s\n", ffmpeg.QuoteForLog(ffmpeg.RedactArgs(args)))
		c, cancel := context.WithTimeout(ctx, 3*time.Minute)
		cmd := exec.CommandContext(c, ffbin, args...)
		var stderr bytes.Buffer
		cmd.Stderr = &stderr
		out, e := cmd.Output()
		cancel()
		if e != nil {
			return fmt.Errorf("%s RKMPP pipeline failed: %w\n%s", outCodec, e, stderr.String())
		}
		// The HLS muxer republishes its growing playlist on stdout. Retain
		// only the final complete snapshot for independent decode validation.
		final, e := finalPlaylist(out)
		if e != nil {
			return e
		}
		if e = os.WriteFile(playlist, final, 0644); e != nil {
			return e
		}
		entries, e := filepath.Glob(filepath.Join(dst, "test-*.m4s"))
		if e != nil || len(entries) == 0 {
			return fmt.Errorf("%s produced no fMP4 segments", outCodec)
		}
		if st, e := os.Stat(init); e != nil || st.Size() == 0 {
			return fmt.Errorf("%s missing/empty fMP4 init: %v", outCodec, e)
		}
		// Decode the muxed playlist strictly; success proves init+segments
		// are consumable, not just that FFmpeg exited with status 0.
		c, cancel = context.WithTimeout(ctx, time.Minute)
		check := exec.CommandContext(c, ffbin, "-hide_banner", "-v", "error",
			"-xerror", "-i", playlist, "-map", "0:v:0", "-map", "0:a:0?",
			"-f", "null", "-")
		verifyOutput, e := check.CombinedOutput()
		cancel()
		if e != nil {
			return fmt.Errorf("%s fMP4 decode validation failed: %w\n%s", outCodec, e, verifyOutput)
		}
		fmt.Printf("PASS: %s hardware encoder completed, %d fMP4 segments; playlist decoded\n", outCodec, len(entries))
	}
	fmt.Println("Offline smoke successful. This does NOT test the Nextcloud 11 player or real HLS switching.")
	return nil
}

func finalPlaylist(output []byte) ([]byte, error) {
	i := bytes.LastIndex(output, []byte("#EXTM3U"))
	if i < 0 || !bytes.Contains(output[i:], []byte("#EXT-X-ENDLIST")) {
		return nil, errors.New("FFmpeg did not finish a VOD playlist")
	}
	return output[i:], nil
}

func main() {
	input := flag.String("input", "", "absolute path to a local sample video, mounted read-only")
	output := flag.String("output", "/cache/rkmpp-smoke", "absolute output directory for test-only segments")
	codec := flag.String("codec", "both", "h264, hevc, or both")
	seconds := flag.Float64("seconds", 9, "seconds of material to test")
	start := flag.Float64("start", 0, "start position in seconds (set 6 for a cold seek)")
	opencl := flag.Bool("opencl", false, "try Mali OpenCL HDR conversion (experimental)")
	flag.Parse()
	if *codec != "h264" && *codec != "hevc" && *codec != "both" {
		fmt.Fprintln(os.Stderr, "invalid -codec; choose h264, hevc or both")
		os.Exit(2)
	}
	if *seconds <= 0 || *start < 0 || math.IsNaN(*seconds) || math.IsInf(*seconds, 0) || math.IsNaN(*start) || math.IsInf(*start, 0) {
		fmt.Fprintln(os.Stderr, "invalid -seconds or -start")
		os.Exit(2)
	}
	if err := run(context.Background(), *input, *output, *codec, *start, *seconds, *opencl); err != nil {
		fmt.Fprintln(os.Stderr, "FAIL:", err)
		os.Exit(1)
	}
}
