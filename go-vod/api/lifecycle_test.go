package api

import (
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/pulsejet/memories/go-vod/config"
	"github.com/stretchr/testify/require"
)

func TestCloseIsConcurrentAndIdempotent(t *testing.T) {
	s := testServer(t, nil)
	var wg sync.WaitGroup
	for range 16 {
		wg.Add(1)
		go func() { defer wg.Done(); s.Close() }()
	}
	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("Close blocks without an idle-event receiver")
	}
}

func TestConcurrentVersionMismatchReturnsWithoutBlocking(t *testing.T) {
	s := testServer(t, func(c *config.Config) { c.VersionMonitor = true })
	responses := make(chan int, 16)
	for range cap(responses) {
		go func() {
			r := httptest.NewRequest("POST", "/vod", nil)
			r.Header.Set("X-Go-Vod-Version", "wrong")
			w := httptest.NewRecorder()
			s.routes().ServeHTTP(w, r)
			responses <- w.Code
		}()
	}
	for range cap(responses) {
		select {
		case code := <-responses:
			require.Equal(t, http.StatusServiceUnavailable, code)
		case <-time.After(time.Second):
			t.Fatal("a version mismatch blocked during shutdown")
		}
	}
}

func TestScratchResetCannotRemovePersistentCache(t *testing.T) {
	root := t.TempDir()
	cache := root + "/cache"
	require.NoError(t, os.MkdirAll(cache, 0755))
	marker := cache + "/keep"
	require.NoError(t, os.WriteFile(marker, []byte("keep"), 0644))
	t.Setenv("CACHE_DIR", cache)
	cfg := config.Defaults("test")
	cfg.TempDir = root
	s, err := NewServer(cfg)
	require.Error(t, err)
	require.Nil(t, s)
	data, err := os.ReadFile(marker)
	require.NoError(t, err)
	require.Equal(t, "keep", string(data))
}
