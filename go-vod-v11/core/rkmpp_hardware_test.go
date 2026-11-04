package core

import (
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/pulsejet/memories/go-vod/config"
	"github.com/stretchr/testify/require"
)

// Exercise the actual manager/stream supervisor, including its stdout
// publication, cached init, pause/resume and shared-audio paths. No Nextcloud
// or production containers are involved.
func TestRKMPPHardwareServing(t *testing.T) {
	if os.Getenv("MEMORIES_RKMPP_HW_TEST") != "1" {
		t.Skip("set MEMORIES_RKMPP_HW_TEST=1 on RK3588 with MPP/RGA devices")
	}
	bin, err := exec.LookPath("ffmpeg")
	require.NoError(t, err)
	probe, err := exec.LookPath("ffprobe")
	require.NoError(t, err)
	dir := t.TempDir()
	src := filepath.Join(dir, "audio.mkv")
	out, err := exec.Command(bin, "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=1280x720:r=30",
		"-f", "lavfi", "-i", "sine=sample_rate=48000", "-t", "15", "-c:v", "libx264", "-threads", "2",
		"-g", "120", "-c:a", "pcm_s16le", src).CombinedOutput()
	require.NoError(t, err, string(out))
	for _, codec := range []string{"h264", "hevc"} {
		t.Run(codec, func(t *testing.T) {
			cfg := config.Defaults("0.7.0")
			cfg.RKMPP, cfg.RKMPPOutputCodec = true, codec
			cfg.TempDir, cfg.CacheDir_ = t.TempDir(), t.TempDir()
			cfg.FFmpeg, cfg.FFprobe = bin, probe
			cfg.GoalBufferMin, cfg.GoalBufferMax = 1, 2
			m, err := NewManager(NewManagerArgs{C: cfg, ManagerParams: ManagerParams{
				URL: src, StreamID: "hardware", PlayableCodecs: []string{"h264", "hevc"},
				TConfig: config.TCfg{ChunkSize: 3, QF: 24}}, Idle: make(chan IdleEvent, 1)})
			require.NoError(t, err)
			t.Cleanup(m.Destroy)
			require.True(t, m.HasStream(QUALITY_AUDIO))
			for _, quality := range []string{"480p", QUALITY_MAX, QUALITY_AUDIO} {
				require.True(t, m.HasStream(quality))
				serve := func(id int) []byte {
					w := httptest.NewRecorder()
					require.True(t, m.ServeChunk(w, quality, id))
					require.Equal(t, http.StatusOK, w.Code, "%s chunk %d", quality, id)
					require.NotEmpty(t, w.Body.Bytes())
					return w.Body.Bytes()
				}
				serve(0)
				w := httptest.NewRecorder()
				require.True(t, m.ServeInit(w, quality))
				require.Equal(t, http.StatusOK, w.Code)
				init := append([]byte{}, w.Body.Bytes()...)
				// Force an actual cold restart, then decode against the old init.
				s := m.streams[quality]
				s.mutex.Lock()
				s.clear()
				s.mutex.Unlock()
				segment := serve(3)
				joined := filepath.Join(dir, codec+"-"+quality+".mp4")
				require.NoError(t, os.WriteFile(joined, append(init, segment...), 0644))
				out, err := exec.Command(bin, "-v", "error", "-xerror", "-i", joined, "-map", "0", "-f", "null", "-").CombinedOutput()
				require.NoError(t, err, string(out))
				track := "v:0"
				if quality == QUALITY_AUDIO {
					track = "a:0"
				}
				out, err = exec.Command(probe, "-v", "error", "-select_streams", track,
					"-show_entries", "packet=pts_time", "-of", "csv=p=0", joined).Output()
				require.NoError(t, err)
				first := strings.SplitN(strings.TrimSpace(string(out)), "\n", 2)[0]
				pts, err := strconv.ParseFloat(strings.TrimRight(first, ","), 64)
				require.NoError(t, err)
				require.InDelta(t, 9, pts, 0.05, "%s absolute timestamp", quality)
			}
			// Switching video quality must never restart the shared AAC encoder.
			audio := m.streams[QUALITY_AUDIO]
			audio.mutex.Lock()
			runs := audio.run
			audio.mutex.Unlock()
			for range 5 {
				for _, quality := range []string{"480p", QUALITY_MAX} {
					w := httptest.NewRecorder()
					require.True(t, m.ServeChunk(w, quality, 3))
					require.Equal(t, http.StatusOK, w.Code)
				}
			}
			audio.mutex.Lock()
			finalRuns := audio.run
			audio.mutex.Unlock()
			require.Equal(t, runs, finalRuns)
		})
	}
}
