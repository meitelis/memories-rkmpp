package ffmpeg

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

// Input codec/container and output codec are independent. Exercise every codec
// claimed by SupportsRKMPPDecode against both hardware encoders, not just AVC
// or HEVC files. This is a decode/encode capability test, not player acceptance.
func TestRKMPPHardwareInputFormats(t *testing.T) {
	if os.Getenv("MEMORIES_RKMPP_HW_TEST") != "1" {
		t.Skip("RK3588 hardware opt-in")
	}
	bin, err := exec.LookPath("ffmpeg")
	require.NoError(t, err)
	probe, err := exec.LookPath("ffprobe")
	require.NoError(t, err)
	for _, tc := range []struct {
		codec, ext string
		args       []string
	}{
		{"h264", "mov", []string{"-c:v", "libx264", "-preset", "ultrafast"}},
		{"hevc", "mp4", []string{"-c:v", "libx265", "-preset", "ultrafast", "-x265-params", "pools=2:frame-threads=1"}},
		{"vp8", "webm", []string{"-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "8"}},
		{"vp9", "webm", []string{"-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8"}},
		{"av1", "mkv", []string{"-c:v", "libsvtav1", "-preset", "12", "-svtav1-params", "lp=2"}},
		{"h263", "avi", []string{"-c:v", "h263"}},
		{"mpeg1video", "mkv", []string{"-c:v", "mpeg1video"}},
		{"mpeg2video", "mkv", []string{"-c:v", "mpeg2video"}},
		{"mpeg4", "avi", []string{"-c:v", "mpeg4"}},
		{"mjpeg", "mkv", []string{"-c:v", "mjpeg", "-pix_fmt", "yuvj420p"}},
	} {
		t.Run(tc.codec, func(t *testing.T) {
			src := filepath.Join(t.TempDir(), "input."+tc.ext)
			args := []string{"-v", "error", "-f", "lavfi", "-i", "testsrc2=s=176x144:r=25", "-t", "3", "-threads", "2"}
			args = append(args, tc.args...)
			args = append(args, src)
			out, err := exec.Command(bin, args...).CombinedOutput()
			require.NoError(t, err, string(out))
			info, err := Probe(context.Background(), probe, src, "")
			require.NoError(t, err)
			require.Equal(t, tc.codec, info.CodecName)
			for _, codec := range []string{"h264", "hevc"} {
				run := t.TempDir()
				init := filepath.Join(run, "init.mp4")
				s := Spec{Input: src, RKMPP: true, RKMPPOutputCodec: codec, CodecName: info.CodecName, PixelFormat: info.PixelFormat, BitDepth: info.BitDepth,
					FrameRate: info.FrameRate, FrameRateExact: info.FrameRateExact, Width: 160, Height: 128, Bitrate: 200000, QF: 24, HLS: true, ChunkSize: 3}
				require.True(t, usesRKMPPFrames(s))
				out, err := exec.Command(bin, SegmentArgs(s, 0, filepath.Join(run, "part-%06d.m4s"), init)...).CombinedOutput()
				require.NoError(t, err, "%s to %s: %s", tc.codec, codec, out)
				header, err := os.ReadFile(init)
				require.NoError(t, err)
				parts, err := filepath.Glob(filepath.Join(run, "part-*.m4s"))
				require.NoError(t, err)
				require.NotEmpty(t, parts)
				for _, p := range parts {
					part, err := os.ReadFile(p)
					require.NoError(t, err)
					joined := filepath.Join(run, "joined.mp4")
					require.NoError(t, os.WriteFile(joined, append(append([]byte{}, header...), part...), 0644))
					out, err := exec.Command(bin, "-v", "error", "-xerror", "-i", joined, "-f", "null", "-").CombinedOutput()
					require.NoError(t, err, string(out))
				}
			}
		})
	}
}
