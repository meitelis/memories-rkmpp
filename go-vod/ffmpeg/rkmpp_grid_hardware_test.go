package ffmpeg

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

// Fractional, irregular Original GOPs must survive RGA resizing, VBR encoding
// and cold restarts. Each fragment must decode using the original cached init.
func TestRKMPPHardwareSourceGrid(t *testing.T) {
	if os.Getenv("MEMORIES_RKMPP_HW_TEST") != "1" {
		t.Skip("set MEMORIES_RKMPP_HW_TEST=1 on RK3588 with MPP/RGA devices")
	}
	bin, err := exec.LookPath("ffmpeg")
	require.NoError(t, err)
	probe, err := exec.LookPath("ffprobe")
	require.NoError(t, err)
	dir := t.TempDir()
	src := filepath.Join(dir, "irregular.mp4")
	out, err := exec.Command(bin, "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=30000/1001",
		"-t", "11.011", "-c:v", "libx264", "-threads", "2", "-bf", "0", "-g", "1000", "-sc_threshold", "0",
		"-force_key_frames", "0,0.93,2.93,6.93,9.40", src).CombinedOutput()
	require.NoError(t, err, string(out))
	info, err := Probe(context.Background(), probe, src, "")
	require.NoError(t, err)
	keys, err := Keyframes(context.Background(), probe, src, "")
	require.NoError(t, err)
	grid := NewRKMPPKeyframeGrid(CopySegments(keys, info.Duration), info.FrameRate)
	require.NotNil(t, grid)
	require.Len(t, grid.Segments, 5)
	for _, codec := range []string{"h264", "hevc"} {
		for _, size := range []struct{ w, h int }{{640, 360}, {320, 180}} {
			t.Run(fmt.Sprintf("%s-%d", codec, size.w), func(t *testing.T) {
				var initial []byte
				for _, startID := range []int{0, 2} {
					run := t.TempDir()
					s := Spec{Bin: bin, Input: src, RKMPP: true, RKMPPOutputCodec: codec,
						CodecName: info.CodecName, PixelFormat: info.PixelFormat, BitDepth: info.BitDepth,
						FrameRate: info.FrameRate, FrameRateExact: info.FrameRateExact,
						Width: size.w, Height: size.h, QF: 24, Bitrate: 1300000, HLS: true, ChunkSize: 3,
						StartAt: grid.Segments[startID].Start, KeyframeGrid: grid}
					require.True(t, usesRKMPPFrames(s))
					init := filepath.Join(run, "init.mp4")
					out, err := exec.Command(bin, SegmentArgs(s, startID, filepath.Join(run, "video-%06d.m4s"), init)...).CombinedOutput()
					require.NoError(t, err, string(out))
					header, err := os.ReadFile(init)
					require.NoError(t, err)
					if startID == 0 {
						initial = header
					} else {
						require.Equal(t, initial, header, "cold start must preserve the cached init")
					}
					files, err := filepath.Glob(filepath.Join(run, "video-*.m4s"))
					require.NoError(t, err)
					require.Len(t, files, len(grid.Segments)-startID, "no extra periodic/scene IDRs")
					for id := startID; id < len(grid.Segments); id++ {
						segment, err := os.ReadFile(filepath.Join(run, fmt.Sprintf("video-%06d.m4s", id)))
						require.NoError(t, err)
						joined := filepath.Join(run, "joined.mp4")
						require.NoError(t, os.WriteFile(joined, append(append([]byte{}, initial...), segment...), 0644))
						out, err := exec.Command(bin, "-v", "error", "-xerror", "-i", joined, "-f", "null", "-").CombinedOutput()
						require.NoError(t, err, string(out))
						seg := grid.Segments[id]
						assertPacketGrid(t, probe, joined, seg.Start, seg.Duration)
					}
				}
			})
		}
	}
}
