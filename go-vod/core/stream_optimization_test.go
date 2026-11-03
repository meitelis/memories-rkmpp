package core

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/pulsejet/memories/go-vod/config"
	"github.com/stretchr/testify/require"
)

func TestConcurrentColdChunkRequestsShareEncoder(t *testing.T) {
	dir := t.TempDir()
	cfg := config.Defaults("test")
	cfg.RKMPP = true
	cfg.FFmpeg = filepath.Join(dir, "ffmpeg")
	marker := filepath.Join(dir, "starts")
	segment := filepath.Join(dir, "720p-000000.ts")
	script := "#!/bin/sh\nprintf 'start\\n' >> '" + marker + "'\nsleep 0.1\nprintf segment > '" + segment + "'\nprintf '720p-000000.ts\\n'\nsleep 5\n"
	require.NoError(t, os.WriteFile(cfg.FFmpeg, []byte(script), 0755))
	m := &Manager{c: cfg, id: "concurrent", tempDir: dir, tc: config.TCfg{ChunkSize: 3}, probe: &ProbeVideoData{Width: 1280, Height: 720, Duration: 12 * time.Second}}
	s := &Stream{c: cfg, m: m, quality: "720p", width: 1280, height: 720, bitrate: 1000000}
	s.init()
	t.Cleanup(func() { s.mutex.Lock(); defer s.mutex.Unlock(); s.clear() })
	const clients = 32
	start := make(chan struct{})
	responses := make([]*httptest.ResponseRecorder, clients)
	var wg sync.WaitGroup
	for i := range clients {
		responses[i] = httptest.NewRecorder()
		wg.Go(func() {
			<-start
			_ = s.ServeChunk(responses[i], 0)
		})
	}
	close(start)
	wg.Wait()
	for _, response := range responses {
		require.Equal(t, http.StatusOK, response.Code)
		require.Equal(t, "segment", response.Body.String())
	}
	starts, err := os.ReadFile(marker)
	require.NoError(t, err)
	require.Equal(t, 1, strings.Count(string(starts), "start\n"))
}

func TestStartupChecksAllPartsBeforeWriting(t *testing.T) {
	for _, second := range []string{"second", ""} {
		t.Run("second="+second, func(t *testing.T) {
			s, _ := testStream(t)
			s.m.tc.ChunkSize = 3
			s.m.probe = &ProbeVideoData{Duration: 12 * time.Second}
			for id, body := range []string{"first", second} {
				require.NoError(t, os.WriteFile(s.getTsPath(id), []byte(body), 0644))
				chunk := NewChunk(id)
				chunk.signal(true)
				s.chunks[id] = chunk
			}
			w := httptest.NewRecorder()
			s.ServeStartupChunk(w)
			if second == "" {
				require.Equal(t, http.StatusBadGateway, w.Code)
				require.Empty(t, w.Body.String())
			} else {
				require.Equal(t, http.StatusOK, w.Code)
				require.Equal(t, "firstsecond", w.Body.String())
			}
		})
	}
}

func TestChunkReadinessDoesNotReadItsBody(t *testing.T) {
	s, _ := testStream(t)
	chunk := NewChunk(0)
	chunk.signal(true)
	s.chunks[0] = chunk
	// No TS file exists. Readiness concerns the producer signal, while opening
	// and validating the file belongs to the delivery step.
	status, err := s.ensureChunkReady(0)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, status)
	w := httptest.NewRecorder()
	s.returnChunk(w, 0)
	require.Equal(t, http.StatusInternalServerError, w.Code)
}
