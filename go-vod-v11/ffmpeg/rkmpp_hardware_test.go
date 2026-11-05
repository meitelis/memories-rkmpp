package ffmpeg

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// Explicit opt-in: these tests must execute on a Rockchip device, never
// silently pass on a CI runner because only encoder names were listed.
func TestRKMPPHardwareTimeline(t *testing.T) {
	if os.Getenv("MEMORIES_RKMPP_HW_TEST") != "1" {
		t.Skip("set MEMORIES_RKMPP_HW_TEST=1 on RK3588 with MPP/RGA devices")
	}
	bin, err := exec.LookPath("ffmpeg")
	require.NoError(t, err)
	probe, err := exec.LookPath("ffprobe")
	require.NoError(t, err)
	dir := t.TempDir()
	src := filepath.Join(dir, "fractional.mp4")
	out, err := exec.Command(bin, "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=30000/1001",
		"-f", "lavfi", "-i", "sine=sample_rate=44100", "-t", "12", "-c:v", "libx264", "-threads", "2",
		"-g", "120", "-c:a", "aac", "-ac", "2", src).CombinedOutput()
	require.NoError(t, err, string(out))
	info, err := Probe(context.Background(), probe, src, "")
	require.NoError(t, err)

	for _, codec := range []string{"h264", "hevc"} {
		t.Run(codec, func(t *testing.T) {
			var initial []byte
			for _, size := range []struct{ w, h int }{{640, 360}, {320, 180}} {
				for _, start := range []int{0, 6} {
					run := filepath.Join(dir, fmt.Sprintf("%s-%d-%d", codec, size.w, start))
					require.NoError(t, os.Mkdir(run, 0755))
					s := Spec{Bin: bin, Input: src, RKMPP: true, RKMPPOutputCodec: codec,
						CodecName: info.CodecName, PixelFormat: info.PixelFormat, BitDepth: info.BitDepth,
						FrameRate: info.FrameRate, FrameRateExact: info.FrameRateExact,
						Width: size.w, Height: size.h, QF: 24, Bitrate: 1500000, HLS: true, ChunkSize: 3,
						StartAt: float64(start), Audio: info.Audio}
					require.True(t, usesRKMPPFrames(s))
					init := filepath.Join(run, "init.mp4")
					args := SegmentArgs(s, start/3, filepath.Join(run, "video-%06d.m4s"), init)
					args = append(args[:len(args)-1], "-to", strconv.Itoa(start+6), "-")
					out, err := exec.Command(bin, args...).CombinedOutput()
					require.NoError(t, err, string(out))
					initBytes, err := os.ReadFile(init)
					require.NoError(t, err)
					if start == 0 {
						initial = initBytes
					} else {
						require.Equal(t, initial, initBytes, "cold seek must reuse cached init")
					}
					for id := start / 3; id < start/3+2; id++ {
						segment, err := os.ReadFile(filepath.Join(run, fmt.Sprintf("video-%06d.m4s", id)))
						require.NoError(t, err)
						joined := filepath.Join(run, fmt.Sprintf("joined-%d.mp4", id))
						require.NoError(t, os.WriteFile(joined, append(append([]byte{}, initial...), segment...), 0644))
						out, err = exec.Command(bin, "-v", "error", "-xerror", "-i", joined, "-map", "0", "-f", "null", "-").CombinedOutput()
						require.NoError(t, err, string(out))
						assertPacketGrid(t, probe, joined, float64(id*3), 3)
					}
				}
			}
		})
	}
}

func assertPacketGrid(t *testing.T, probe, file string, start, duration float64) {
	t.Helper()
	out, err := exec.Command(probe, "-v", "error", "-select_streams", "v:0", "-show_entries",
		"packet=pts_time,duration_time,flags", "-of", "json", file).Output()
	require.NoError(t, err)
	var data struct {
		Packets []struct {
			PTS      string `json:"pts_time"`
			Duration string `json:"duration_time"`
			Flags    string `json:"flags"`
		} `json:"packets"`
	}
	require.NoError(t, json.Unmarshal(out, &data))
	require.NotEmpty(t, data.Packets)
	first := data.Packets[0]
	require.True(t, strings.Contains(first.Flags, "K"), "segment must start independently")
	firstPTS, err := strconv.ParseFloat(first.PTS, 64)
	require.NoError(t, err)
	last := data.Packets[len(data.Packets)-1]
	lastPTS, err := strconv.ParseFloat(last.PTS, 64)
	require.NoError(t, err)
	lastDuration, err := strconv.ParseFloat(last.Duration, 64)
	require.NoError(t, err)
	require.InDelta(t, start, firstPTS, 0.0001)
	require.InDelta(t, start+duration, lastPTS+lastDuration, 0.0001)
	firstDuration, err := strconv.ParseFloat(first.Duration, 64)
	require.NoError(t, err)
	require.Greater(t, firstDuration, 0.0)
	for i, packet := range data.Packets {
		pts, err := strconv.ParseFloat(packet.PTS, 64)
		require.NoError(t, err)
		dur, err := strconv.ParseFloat(packet.Duration, 64)
		require.NoError(t, err)
		require.InDelta(t, firstDuration, dur, 0.0001, "packet %d duration: missing frame", i)
		require.InDelta(t, start+float64(i)*firstDuration, pts, 0.0001, "packet %d timestamp", i)
	}
}

// Run beyond the fast initial burst: every 50 fps frame must survive normal
// input pacing, and every segment must decode without earlier references.
func TestRKMPPHardwarePacedCadence(t *testing.T) {
	if os.Getenv("MEMORIES_RKMPP_HW_TEST") != "1" {
		t.Skip("set MEMORIES_RKMPP_HW_TEST=1 on RK3588 with MPP/RGA devices")
	}
	bin, err := exec.LookPath("ffmpeg")
	require.NoError(t, err)
	probe, err := exec.LookPath("ffprobe")
	require.NoError(t, err)
	dir := t.TempDir()
	src := filepath.Join(dir, "source50.mp4")
	out, err := exec.Command(bin, "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=1280x720:r=50",
		"-t", "30", "-c:v", "libx264", "-preset", "ultrafast", "-threads", "2", src).CombinedOutput()
	require.NoError(t, err, string(out))
	for _, codec := range []string{"h264", "hevc"} {
		t.Run(codec, func(t *testing.T) {
			run := t.TempDir()
			s := Spec{RKMPP: true, RKMPPOutputCodec: codec, Input: src,
				CodecName: "h264", PixelFormat: "yuv420p", BitDepth: 8,
				FrameRate: 50, FrameRateExact: 50, Width: 854, Height: 480,
				QF: 24, Bitrate: 1300000, HLS: true, ChunkSize: 3}
			init := filepath.Join(run, "init.mp4")
			out, err := exec.Command(bin, SegmentArgs(s, 0, filepath.Join(run, "video-%06d.m4s"), init)...).CombinedOutput()
			require.NoError(t, err, string(out))
			header, err := os.ReadFile(init)
			require.NoError(t, err)
			for id := 0; id < 10; id++ {
				segment, err := os.ReadFile(filepath.Join(run, fmt.Sprintf("video-%06d.m4s", id)))
				require.NoError(t, err)
				joined := filepath.Join(run, "joined.mp4")
				require.NoError(t, os.WriteFile(joined, append(append([]byte{}, header...), segment...), 0644))
				out, err := exec.Command(bin, "-v", "error", "-xerror", "-i", joined, "-f", "null", "-").CombinedOutput()
				require.NoError(t, err, string(out))
				assertPacketGrid(t, probe, joined, float64(id*3), 3)
			}
		})
	}
}

func TestRKMPPHardwareHDR(t *testing.T) {
	if os.Getenv("MEMORIES_RKMPP_HW_TEST") != "1" {
		t.Skip("set MEMORIES_RKMPP_HW_TEST=1 on RK3588 with Mali OpenCL")
	}
	bin, err := exec.LookPath("ffmpeg")
	require.NoError(t, err)
	probe, err := exec.LookPath("ffprobe")
	require.NoError(t, err)
	for _, tc := range []struct{ transfer, size string }{
		{"smpte2084", "3840x2160"}, {"arib-std-b67", "640x360"},
	} {
		t.Run(tc.transfer, func(t *testing.T) {
			dir := t.TempDir()
			src := filepath.Join(dir, "hdr.mp4")
			out, err := exec.Command(bin, "-v", "error", "-f", "lavfi", "-i", "testsrc2=s="+tc.size+":r=24",
				"-t", "3", "-pix_fmt", "yuv420p10le", "-c:v", "libx265", "-preset", "ultrafast",
				"-x265-params", "pools=2:frame-threads=1:colorprim=bt2020:transfer="+tc.transfer+":colormatrix=bt2020nc", "-color_primaries", "bt2020",
				"-color_trc", tc.transfer, "-colorspace", "bt2020nc", src).CombinedOutput()
			require.NoError(t, err, string(out))
			info, err := Probe(context.Background(), probe, src, "")
			require.NoError(t, err)
			require.True(t, info.HDR)
			require.Equal(t, 10, info.BitDepth)
			require.Equal(t, tc.transfer, info.ColorTransfer, "fixture must identify PQ/HLG")
			require.Equal(t, "bt2020", info.ColorPrimaries)
			for _, codec := range []string{"h264", "hevc"} {
				s := Spec{Bin: bin, Input: src, RKMPP: true, RKMPPOutputCodec: codec, RKMPPOpenCL: true,
					CodecName: info.CodecName, PixelFormat: info.PixelFormat, BitDepth: info.BitDepth, HDR: info.HDR,
					ColorTransfer: info.ColorTransfer, ColorPrimaries: info.ColorPrimaries,
					ColorSpace: info.ColorSpace, ColorRange: info.ColorRange,
					FrameRate: info.FrameRate, FrameRateExact: info.FrameRateExact,
					Width: 640, Height: 360, QF: 24, Bitrate: 1500000, HLS: true, ChunkSize: 3}
				require.NoError(t, ProbeRKMPPOpenCL(context.Background(), s), "real source OpenCL frame probe")
				init := filepath.Join(dir, codec+"-init.mp4")
				pattern := filepath.Join(dir, codec+"-%06d.m4s")
				out, err := exec.Command(bin, SegmentArgs(s, 0, pattern, init)...).CombinedOutput()
				require.NoError(t, err, string(out))
				initBytes, err := os.ReadFile(init)
				require.NoError(t, err)
				seg, err := os.ReadFile(filepath.Join(dir, codec+"-000000.m4s"))
				require.NoError(t, err)
				joined := filepath.Join(dir, codec+".mp4")
				require.NoError(t, os.WriteFile(joined, append(initBytes, seg...), 0644))
				out, err = exec.Command(bin, "-v", "error", "-xerror", "-i", joined, "-f", "null", "-").CombinedOutput()
				require.NoError(t, err, string(out))
				out, err = exec.Command(probe, "-v", "error", "-show_streams", "-of", "json", joined).Output()
				require.NoError(t, err)
				var data probeOutput
				require.NoError(t, json.Unmarshal(out, &data))
				require.Len(t, data.Streams, 1)
				stream := data.Streams[0]
				require.Equal(t, codec, stream.CodecName)
				require.Equal(t, "bt709", stream.ColorTransfer)
				require.Equal(t, "bt709", stream.ColorPrimaries)
				require.Equal(t, "bt709", stream.ColorSpace)
				require.Equal(t, 8, probeBitDepth(stream.PixFmt))
				require.Equal(t, 640, stream.Width)
				require.Equal(t, 360, stream.Height)
			}
		})
	}
}
