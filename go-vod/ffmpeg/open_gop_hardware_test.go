package ffmpeg

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestRKMPPHardwareOpenGOPPresentation(t *testing.T) {
	if os.Getenv("MEMORIES_RKMPP_HW_TEST") != "1" {
		t.Skip("RK3588 hardware opt-in")
	}
	bin, err := exec.LookPath("ffmpeg")
	require.NoError(t, err)
	probe, err := exec.LookPath("ffprobe")
	require.NoError(t, err)
	for _, inputCodec := range []string{"h264", "hevc"} {
		t.Run(inputCodec, func(t *testing.T) {
			src := filepath.Join(t.TempDir(), "open.mp4")
			args := []string{"-v", "error", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=50", "-t", "5.76", "-threads", "2"}
			if inputCodec == "h264" {
				args = append(args, "-c:v", "libx264", "-x264-params", "keyint=48:min-keyint=48:scenecut=0:bframes=3:open-gop=1")
			} else {
				args = append(args, "-c:v", "libx265", "-preset", "ultrafast", "-x265-params", "pools=2:frame-threads=1:keyint=48:min-keyint=48:scenecut=0:bframes=3:open-gop=1")
			}
			out, err := exec.Command(bin, append(args, src)...).CombinedOutput()
			require.NoError(t, err, string(out))
			info, err := Probe(context.Background(), probe, src, "")
			require.NoError(t, err)
			frames, err := ProbeTimeline(context.Background(), probe, src, "")
			require.NoError(t, err)
			segments := SourceSegments(frames, info.Duration)
			require.Len(t, segments, 6)
			require.Less(t, segments[1].Start, frames[1].PTS, "fixture must contain leading pictures")
			copyDir := t.TempDir()
			init := filepath.Join(copyDir, "init.mp4")
			out, err = exec.Command(bin, SegmentArgs(Spec{Input: src, CodecName: inputCodec, Copy: true, HLS: true, ChunkSize: 3}, 0, filepath.Join(copyDir, "copy-%06d.m4s"), init)...).CombinedOutput()
			require.NoError(t, err, string(out))
			header, err := os.ReadFile(init)
			require.NoError(t, err)
			for i, seg := range segments {
				part, err := os.ReadFile(filepath.Join(copyDir, fmt.Sprintf("copy-%06d.m4s", i)))
				require.NoError(t, err)
				require.InDelta(t, seg.Start, slices.Min(samplePresentationTimes(t, header, part)), .000001, "copied GOP %d", i)
			}
			grid := NewRKMPPKeyframeGrid(segments, info.FrameRate)
			require.NotNil(t, grid)
			for _, outputCodec := range []string{"h264", "hevc"} {
				var initial []byte
				for _, first := range []int{0, 2} {
					run := t.TempDir()
					init := filepath.Join(run, "init.mp4")
					s := Spec{Input: src, CodecName: inputCodec, PixelFormat: info.PixelFormat, BitDepth: info.BitDepth, RKMPP: true, RKMPPOutputCodec: outputCodec,
						FrameRate: info.FrameRate, FrameRateExact: info.FrameRateExact, Width: 320, Height: 180, Bitrate: 700000, QF: 24, HLS: true, ChunkSize: 3, StartAt: segments[first].Start, KeyframeGrid: grid}
					out, err := exec.Command(bin, SegmentArgs(s, first, filepath.Join(run, "video-%06d.m4s"), init)...).CombinedOutput()
					require.NoError(t, err, string(out))
					header, err := os.ReadFile(init)
					require.NoError(t, err)
					if first == 0 {
						initial = header
					} else {
						require.Equal(t, initial, header, "cold init: %s to %s", inputCodec, outputCodec)
					}
					for id := first; id < len(segments); id++ {
						part, err := os.ReadFile(filepath.Join(run, fmt.Sprintf("video-%06d.m4s", id)))
						require.NoError(t, err)
						pts := samplePresentationTimes(t, initial, part)
						require.InDelta(t, segments[id].Start, pts[0], .000001, "encoded GOP %d: %s to %s", id, inputCodec, outputCodec)
						joined := filepath.Join(run, "joined.mp4")
						require.NoError(t, os.WriteFile(joined, append(append([]byte{}, initial...), part...), 0644))
						out, err = exec.Command(bin, "-v", "error", "-xerror", "-i", joined, "-f", "null", "-").CombinedOutput()
						require.NoError(t, err, string(out))
						assertPacketGrid(t, probe, joined, segments[id].Start, segments[id].Duration)
					}
				}
			}
		})
	}
}
