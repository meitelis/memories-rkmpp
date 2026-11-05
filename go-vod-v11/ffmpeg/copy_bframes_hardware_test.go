package ffmpeg

import (
	"bytes"
	"context"
	"encoding/binary"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

// FFmpeg's packet demuxer adds a B-frame reorder offset to standalone fMP4.
// Check the raw presentation clock consumed by MSE, not that inferred offset.
func firstSamplePTS(t *testing.T, init, segment []byte) float64 {
	t.Helper()
	box := func(data []byte, path ...string) []byte {
		for _, kind := range path {
			var found []byte
			for len(data) >= 8 {
				n := int(binary.BigEndian.Uint32(data))
				require.GreaterOrEqual(t, n, 8)
				require.LessOrEqual(t, n, len(data))
				if string(data[4:8]) == kind {
					found = data[8:n]
					break
				}
				data = data[n:]
			}
			require.NotNil(t, found, "missing MP4 box %s", kind)
			data = found
		}
		return data
	}
	mdhd := box(init, "moov", "trak", "mdia", "mdhd")
	scaleAt := 12
	if mdhd[0] == 1 {
		scaleAt = 20
	}
	scale := binary.BigEndian.Uint32(mdhd[scaleAt:])
	dt := box(segment, "moof", "traf", "tfdt")
	var dts uint64
	if dt[0] == 1 {
		dts = binary.BigEndian.Uint64(dt[4:])
	} else {
		dts = uint64(binary.BigEndian.Uint32(dt[4:]))
	}
	trun := box(segment, "moof", "traf", "trun")
	flags := binary.BigEndian.Uint32(trun) & 0xffffff
	offset := 8
	for _, flag := range []uint32{1, 4, 0x100, 0x200, 0x400} {
		if flags&flag != 0 {
			offset += 4
		}
	}
	var cto int64
	if flags&0x800 != 0 {
		x := binary.BigEndian.Uint32(trun[offset:])
		cto = int64(x)
		if trun[0] == 1 {
			cto = int64(int32(x))
		}
	}
	return (float64(dts) + float64(cto)) / float64(scale)
}

func TestRKMPPHardwareCopyBFrameClock(t *testing.T) {
	if os.Getenv("MEMORIES_RKMPP_HW_TEST") != "1" {
		t.Skip("set MEMORIES_RKMPP_HW_TEST=1 in the RK3588 runtime image")
	}
	bin, err := exec.LookPath("ffmpeg")
	require.NoError(t, err)
	probe, err := exec.LookPath("ffprobe")
	require.NoError(t, err)
	for _, codec := range []string{"h264", "hevc"} {
		t.Run(codec, func(t *testing.T) {
			dir := t.TempDir()
			src := filepath.Join(dir, "bframes.mp4")
			args := []string{"-v", "error", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=50", "-t", "5.76", "-threads", "2"}
			if codec == "h264" {
				args = append(args, "-c:v", "libx264", "-g", "48", "-bf", "3", "-sc_threshold", "0")
			} else {
				args = append(args, "-c:v", "libx265", "-preset", "ultrafast", "-x265-params",
					"pools=2:frame-threads=1:keyint=48:min-keyint=48:scenecut=0:bframes=3:open-gop=0")
			}
			out, err := exec.Command(bin, append(args, src)...).CombinedOutput()
			require.NoError(t, err, string(out))
			info, err := Probe(context.Background(), probe, src, "")
			require.NoError(t, err)
			keys, err := Keyframes(context.Background(), probe, src, "")
			require.NoError(t, err)
			segments := CopySegments(keys, info.Duration)
			require.Len(t, segments, 6)
			var initial []byte
			for _, first := range []int{0, 3} {
				run := t.TempDir()
				s := Spec{Input: src, Copy: true, HLS: true, CodecName: codec, ChunkSize: 3}
				if first > 0 {
					s.StartAt = segments[first].Start + .001
				}
				init := filepath.Join(run, "init.mp4")
				out, err := exec.Command(bin, SegmentArgs(s, first, filepath.Join(run, "copy-%06d.m4s"), init)...).CombinedOutput()
				require.NoError(t, err, string(out))
				header, err := os.ReadFile(init)
				require.NoError(t, err)
				if first == 0 {
					initial = header
				} else {
					require.Equal(t, initial, header, "cached init must work after a cold seek")
				}
				parts, err := filepath.Glob(filepath.Join(run, "copy-*.m4s"))
				require.NoError(t, err)
				require.Len(t, parts, len(segments)-first)
				for id := first; id < len(segments); id++ {
					part, err := os.ReadFile(filepath.Join(run, fmt.Sprintf("copy-%06d.m4s", id)))
					require.NoError(t, err)
					require.False(t, bytes.Contains(part[:min(len(part), 160)], []byte("sidx")))
					require.InDelta(t, segments[id].Start, firstSamplePTS(t, initial, part), .000001, "segment %d source PTS", id)
					joined := filepath.Join(run, "joined.mp4")
					require.NoError(t, os.WriteFile(joined, append(append([]byte{}, initial...), part...), 0644))
					out, err := exec.Command(bin, "-v", "error", "-xerror", "-i", joined, "-f", "null", "-").CombinedOutput()
					require.NoError(t, err, string(out))
				}
			}
		})
	}
}
