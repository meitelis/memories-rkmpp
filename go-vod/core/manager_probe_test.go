package core

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/pulsejet/memories/go-vod/config"
	"github.com/stretchr/testify/require"
)

func TestManagerFFprobeFailure(t *testing.T) {
	bin := filepath.Join(t.TempDir(), "ffprobe")
	require.NoError(t, os.WriteFile(bin, []byte("#!/bin/sh\necho boom >&2\nexit 1\n"), 0755))

	m := &Manager{c: &config.Config{FFprobe: bin}, url: "http://localhost/input.mp4"}
	err := m.ffprobe()
	require.Error(t, err)
	require.Contains(t, err.Error(), "boom")
}

func TestRKMPPRejectsCachedDolbyVision(t *testing.T) {
	cfg := config.Defaults("0.7.0")
	cfg.RKMPP = true
	cfg.CacheDir_ = t.TempDir()
	StoreCachedProbe(cfg.CacheDir(), 1, "dv", &ProbeVideoData{
		Width: 1920, Height: 1080, Duration: time.Second, CodecName: "hevc", DolbyVision: true,
	})
	m := &Manager{c: cfg, fileid: 1, etag: "dv", playableCodecs: []string{"hevc"}}
	require.ErrorContains(t, m.ffprobe(), "Dolby Vision is not supported")
}
