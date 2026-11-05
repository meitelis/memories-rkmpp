package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/pulsejet/memories/go-vod/config"
	"github.com/pulsejet/memories/go-vod/core"
	"github.com/stretchr/testify/require"
)

// The Memories 11 PHP envelope, callback authentication and HLS profiles are
// exercised against a local fixture server. This is a protocol test, not a
// browser test and not a connection to the user's Nextcloud instance.
func TestRKMPPHardwareAPI(t *testing.T) {
	if os.Getenv("MEMORIES_RKMPP_HW_TEST") != "1" {
		t.Skip("set MEMORIES_RKMPP_HW_TEST=1 on RK3588")
	}
	t.Setenv("CACHE_DIR", t.TempDir())
	bin, err := exec.LookPath("ffmpeg")
	require.NoError(t, err)
	probe, err := exec.LookPath("ffprobe")
	require.NoError(t, err)
	dir := t.TempDir()
	src := filepath.Join(dir, "fixture.mkv")
	out, err := exec.Command(bin, "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=1280x720:r=30",
		"-f", "lavfi", "-i", "sine=sample_rate=48000", "-t", "9", "-c:v", "libx264", "-threads", "2",
		"-c:a", "pcm_s16le", src).CombinedOutput()
	require.NoError(t, err, string(out))
	callback := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/index.php/apps/memories/api/stream/1" {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get(core.ServiceTokenHeader) != "fixture-service-token" {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		http.ServeFile(w, r, src)
	}))
	defer callback.Close()
	cfg := config.Defaults("0.7.0")
	cfg.RKMPP, cfg.RKMPPOutputCodec, cfg.VersionMonitor = true, "hevc", true
	cfg.TempDir, cfg.CacheDir_ = t.TempDir(), t.TempDir()
	cfg.FFmpeg, cfg.FFprobe, cfg.NextcloudURL = bin, probe, callback.URL
	cfg.Bridge.Enabled = false
	s := NewServer(cfg)
	params := core.ManagerParams{URL: cfg.FileURL(1), StreamID: "aabbccdd", FileID: 1, Etag: "fixture",
		ServiceToken: "fixture-service-token", PlayableCodecs: []string{"h264", "hevc"}, TConfig: config.TCfg{ChunkSize: 3, QF: 24}}
	m, err := s.reg.GetOrCreate(params)
	require.NoError(t, err)
	defer m.Destroy()
	request := VodRequest{Client: params.StreamID, FileID: 1, Etag: params.Etag, ServiceToken: params.ServiceToken,
		TConfig: params.TConfig, Query: VodQuery{Codecs: "h264,hevc", Token: "fixture-share-token"}}
	fetch := func(profile string) []byte {
		request.Profile = profile
		body, err := json.Marshal(request)
		require.NoError(t, err)
		r := httptest.NewRequest("POST", "/vod", bytes.NewReader(body))
		r.Header.Set("X-Go-Vod-Version", "0.7.0")
		w := httptest.NewRecorder()
		s.routes().ServeHTTP(w, r)
		require.Equal(t, http.StatusOK, w.Code, profile)
		require.NotEmpty(t, w.Body.Bytes(), profile)
		return w.Body.Bytes()
	}
	w := httptest.NewRecorder()
	s.routes().ServeHTTP(w, httptest.NewRequest("GET", "/ping", nil))
	require.Contains(t, w.Body.String(), `"version":"0.7.0"`)
	master := string(fetch("index.m3u8"))
	require.Equal(t, 4, strings.Count(master, "#EXT-X-MEDIA:"))
	require.Contains(t, master, `AUDIO="audio"`)
	require.Contains(t, master, "hvc1.")
	require.Contains(t, master, "mp4a.40.2")
	require.Contains(t, master, "fixture-share-token")
	for _, quality := range []string{"240p", "480p", "max", "audio", "audio96", "audio64", "audio32"} {
		playlist := string(fetch(quality + ".m3u8"))
		require.Contains(t, playlist, "#EXT-X-MAP:")
		require.Contains(t, playlist, quality+"-init.m4s")
		require.Contains(t, playlist, "fixture-share-token")
		init := fetch(quality + "-init.m4s")
		segment := fetch(quality + "-000002.m4s")
		joined := filepath.Join(dir, quality+".mp4")
		require.NoError(t, os.WriteFile(joined, append(init, segment...), 0644))
		out, err := exec.Command(bin, "-v", "error", "-xerror", "-i", joined, "-map", "0", "-f", "null", "-").CombinedOutput()
		require.NoError(t, err, string(out))
	}
}
