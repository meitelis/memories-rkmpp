package core

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/pulsejet/memories/go-vod/config"
	"github.com/stretchr/testify/require"
)

func TestEncoderFailureCanRecoverOnNextRequest(t *testing.T) {
	dir := t.TempDir()
	cfg := config.Defaults("test")
	cfg.RKMPP = true
	cfg.FFmpeg = filepath.Join(dir, "ffmpeg")
	marker := filepath.Join(dir, "started")
	segment := filepath.Join(dir, "720p-000000.ts")
	script := "#!/bin/sh\nif [ ! -f '" + marker + "' ]; then touch '" + marker + "'; exit 1; fi\nprintf segment > '" + segment + "'\nprintf '720p-000000.ts\\n'\n"
	require.NoError(t, os.WriteFile(cfg.FFmpeg, []byte(script), 0755))
	m := &Manager{c: cfg, id: "recovery", tempDir: dir, tc: config.TCfg{ChunkSize: 3}, probe: &ProbeVideoData{Width: 1280, Height: 720, Duration: 12 * time.Second}}
	s := &Stream{c: cfg, m: m, quality: "720p", width: 1280, height: 720, bitrate: 1000000}
	s.init()
	t.Cleanup(func() { s.mutex.Lock(); defer s.mutex.Unlock(); s.clear() })
	first := httptest.NewRecorder()
	require.NoError(t, s.ServeChunk(first, 0))
	require.Equal(t, http.StatusBadGateway, first.Code)
	second := httptest.NewRecorder()
	require.NoError(t, s.ServeChunk(second, 0))
	require.Equal(t, http.StatusOK, second.Code)
	require.Equal(t, "segment", second.Body.String())
}

func TestFailedManagerProbeLeavesNoScratchDirectory(t *testing.T) {
	cfg := config.Defaults("test")
	cfg.TempDir = t.TempDir()
	cfg.FFprobe = "false"
	_, err := NewManager(NewManagerArgs{C: cfg, ManagerParams: ManagerParams{StreamID: "probe-failed", URL: "http://example.invalid/video"}, Generation: 1})
	require.Error(t, err)
	entries, err := os.ReadDir(cfg.TempDir)
	require.NoError(t, err)
	require.Empty(t, entries)
}

func TestDestroyedManagerCannotBeRevivedByStaleActivity(t *testing.T) {
	cfg := config.Defaults("test")
	cfg.TempDir = t.TempDir()
	cfg.FFprobe = stubProbe(t)
	r := NewRegistry(cfg, make(chan IdleEvent, 1))
	p := ManagerParams{URL: "http://localhost/input.mp4", StreamID: "destroyed"}
	m, err := r.GetOrCreate(p)
	require.NoError(t, err)
	m.Destroy()
	// Simulate an idle tick already in flight when Destroy ran.
	m.inactive.Add(1)
	require.Nil(t, r.get(p))
}
