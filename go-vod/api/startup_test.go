package api

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/pulsejet/memories/go-vod/config"
	"github.com/pulsejet/memories/go-vod/core"
	"github.com/stretchr/testify/require"
)

func TestServerFailsWhenScratchCannotBeCreated(t *testing.T) {
	parent := filepath.Join(t.TempDir(), "file")
	require.NoError(t, os.WriteFile(parent, []byte("keep"), 0600))
	cfg := config.Defaults("test")
	cfg.TempDir = filepath.Join(parent, "scratch")
	s, err := NewServer(cfg)
	require.Error(t, err)
	require.Nil(t, s)
	content, err := os.ReadFile(parent)
	require.NoError(t, err)
	require.Equal(t, "keep", string(content))
}

func TestHEVCMasterPreservesCodecAndPortraitResolution(t *testing.T) {
	r := core.Rendition{Quality: "1080p", Width: 1080, Height: 1920, Bitrate: 3000000, Codecs: "hvc1.1.6.L123.80,mp4a.40.2"}
	query := VodQuery{Codecs: "h264,hevc"}.Encode()
	master, err := MasterPlaylist([]core.Rendition{r}, 60, query)
	require.NoError(t, err)
	require.Contains(t, master, "RESOLUTION=1080x1920")
	require.Contains(t, master, `CODECS="hvc1.1.6.L123.80,mp4a.40.2"`)
	require.Contains(t, master, "1080p.m3u8?codecs=h264%2Chevc")
}
