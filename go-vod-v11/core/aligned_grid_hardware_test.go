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

// Exercise serving IDs beyond the fixed-grid limit and a cold encoder restart
// through the actual stream supervisor, rather than just constructing CLI args.
func TestRKMPPHardwareAlignedServing(t *testing.T) {
	if os.Getenv("MEMORIES_RKMPP_HW_TEST") != "1" {
		t.Skip("set MEMORIES_RKMPP_HW_TEST=1 on RK3588 with MPP/RGA devices")
	}
	bin, err := exec.LookPath("ffmpeg")
	require.NoError(t, err)
	probe, err := exec.LookPath("ffprobe")
	require.NoError(t, err)
	dir := t.TempDir()
	src := filepath.Join(dir, "irregular.mp4")
	out, err := exec.Command(bin, "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=1280x720:r=30000/1001",
		"-f", "lavfi", "-i", "sine=sample_rate=48000", "-t", "11.011", "-c:v", "libx264", "-threads", "2",
		"-bf", "0", "-g", "1000", "-sc_threshold", "0", "-force_key_frames", "0,0.93,2.93,6.93,9.40", "-c:a", "aac", src).CombinedOutput()
	require.NoError(t, err, string(out))
	cfg := config.Defaults("0.7.0")
	cfg.RKMPP, cfg.RKMPPOutputCodec = true, "h264"
	cfg.TempDir, cfg.CacheDir_ = t.TempDir(), t.TempDir()
	cfg.FFmpeg, cfg.FFprobe = bin, probe
	m, err := NewManager(NewManagerArgs{C: cfg, ManagerParams: ManagerParams{
		URL: src, StreamID: "aligned-hardware", PlayableCodecs: []string{"h264"},
		TConfig: config.TCfg{ChunkSize: 3, QF: 24}}, Idle: make(chan IdleEvent, 1)})
	require.NoError(t, err)
	t.Cleanup(m.Destroy)
	_, ok := m.EnsureCopySegments()
	require.True(t, ok)
	g := m.AlignedGrid("480p")
	require.NotNil(t, g)
	require.Len(t, g.Segments, 5)
	serve := func(quality string, id int) []byte {
		w := httptest.NewRecorder()
		require.True(t, m.ServeChunk(w, quality, id))
		require.Equal(t, http.StatusOK, w.Code)
		return append([]byte{}, w.Body.Bytes()...)
	}
	serve(QUALITY_AUDIO, 0)
	m.streams[QUALITY_AUDIO].mutex.Lock()
	audioRun := m.streams[QUALITY_AUDIO].run
	m.streams[QUALITY_AUDIO].mutex.Unlock()
	for _, quality := range []string{"480p", QUALITY_MAX} {
		serve(quality, 0)
		w := httptest.NewRecorder()
		require.True(t, m.ServeInit(w, quality))
		require.Equal(t, http.StatusOK, w.Code)
		init := append([]byte{}, w.Body.Bytes()...)
		s := m.streams[quality]
		s.mutex.Lock()
		s.clear()
		s.mutex.Unlock()
		// ID 4 is valid on the source grid despite being past 11 s on a 3 s grid.
		segment := serve(quality, 4)
		joined := filepath.Join(dir, quality+".mp4")
		require.NoError(t, os.WriteFile(joined, append(init, segment...), 0644))
		out, err := exec.Command(bin, "-v", "error", "-xerror", "-i", joined, "-f", "null", "-").CombinedOutput()
		require.NoError(t, err, string(out))
		out, err = exec.Command(probe, "-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time", "-of", "csv=p=0", joined).Output()
		require.NoError(t, err)
		pts, err := strconv.ParseFloat(strings.TrimRight(strings.SplitN(strings.TrimSpace(string(out)), "\n", 2)[0], ","), 64)
		require.NoError(t, err)
		require.InDelta(t, g.Segments[4].Start, pts, 0.0001)
	}
	m.streams[QUALITY_AUDIO].mutex.Lock()
	finalAudioRun := m.streams[QUALITY_AUDIO].run
	m.streams[QUALITY_AUDIO].mutex.Unlock()
	require.Equal(t, audioRun, finalAudioRun, "video switches must not restart shared audio")
}
