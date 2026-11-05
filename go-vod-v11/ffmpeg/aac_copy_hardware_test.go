package ffmpeg

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/stretchr/testify/require"
)

// The AAC encoder writes negative priming packets in MP4. Copying them into
// unsigned fMP4 tfdt used to wrap hls.js audio by almost 25 hours, freezing
// playback after its first segment. ffprobe alone interprets that as signed
// and therefore misses the browser failure: check the raw box as well.
func TestRKMPPHardwareAACCopyClock(t *testing.T) {
	if os.Getenv("MEMORIES_RKMPP_HW_TEST") != "1" {
		t.Skip("run with the packaged multimedia image and hardware matrix")
	}
	bin, err := exec.LookPath("ffmpeg")
	require.NoError(t, err)
	probe, err := exec.LookPath("ffprobe")
	require.NoError(t, err)
	dir := t.TempDir()
	src := filepath.Join(dir, "primed.m4a")
	out, err := exec.Command(bin, "-v", "error", "-f", "lavfi", "-i", "sine=sample_rate=48000",
		"-t", "12", "-c:a", "aac", "-ac", "2", "-b:a", "160k", src).CombinedOutput()
	require.NoError(t, err, string(out))
	for _, start := range []int{0, 6} {
		run := t.TempDir()
		s := Spec{RKMPP: true, HLS: true, AudioOnly: true, Input: src,
			StartAt: float64(start), EndAt: float64(start + 6), ChunkSize: 3,
			Audio: AudioInfo{CodecName: "aac", Profile: "LC", Channels: 2,
				SampleRate: 48000, BitRate: 160000, DurationSeconds: 12}}
		init := filepath.Join(run, "init.mp4")
		out, err := exec.Command(bin, SegmentArgs(s, start/3, filepath.Join(run, "audio-%06d.m4s"), init)...).CombinedOutput()
		require.NoError(t, err, string(out))
		header, err := os.ReadFile(init)
		require.NoError(t, err)
		for id := start / 3; id < start/3+2; id++ {
			segment, err := os.ReadFile(filepath.Join(run, fmt.Sprintf("audio-%06d.m4s", id)))
			require.NoError(t, err)
			tfdt := bytes.Index(segment, []byte("tfdt"))
			require.GreaterOrEqual(t, tfdt, 0)
			require.Equal(t, byte(1), segment[tfdt+4])
			timestamp := binary.BigEndian.Uint64(segment[tfdt+8 : tfdt+16])
			want := (math.Ceil(float64(start)*48000/1024) + math.Ceil(float64((id-start/3)*3)*48000/1024)) * 1024
			require.InDelta(t, want, timestamp, 1, "unsigned decode time must stay on the source sample clock")
			joined := filepath.Join(run, "joined.mp4")
			require.NoError(t, os.WriteFile(joined, append(append([]byte{}, header...), segment...), 0644))
			out, _, err = runFFprobe(context.Background(), probe, "-v", "error", "-show_entries", "packet=pts_time", "-of", "json", joined)
			require.NoError(t, err)
			var data struct {
				Packets []struct {
					PTS string `json:"pts_time"`
				} `json:"packets"`
			}
			require.NoError(t, json.Unmarshal(out, &data))
			require.NotEmpty(t, data.Packets)
			first, err := strconv.ParseFloat(data.Packets[0].PTS, 64)
			require.NoError(t, err)
			require.InDelta(t, want/48000, first, 1.0/48000)
		}
	}
}
