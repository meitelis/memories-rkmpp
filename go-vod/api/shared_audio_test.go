package api

import (
	"strings"
	"testing"
	"time"

	"github.com/pulsejet/memories/go-vod/config"
	"github.com/pulsejet/memories/go-vod/core"
	"github.com/pulsejet/memories/go-vod/ffmpeg"
	"github.com/stretchr/testify/require"
)

func TestNormalizedAudioHasOneLazySharedTrackAcrossVideoQualities(t *testing.T) {
	for _, bitrate := range []int{160000, 384000} {
		cfg := config.Defaults("test")
		cfg.RKMPP = true
		cfg.TempDir = t.TempDir()
		t.Setenv("CACHE_DIR", t.TempDir())
		probe := &core.ProbeVideoData{Width: 3840, Height: 2160, Duration: 12 * time.Second,
			CodecName: "hevc", BitRate: 20000000, FrameRate: 30,
			Audio: ffmpeg.AudioInfo{CodecName: "aac", Profile: "LC", Channels: 2, SampleRate: 48000, BitRate: bitrate}}
		require.NoError(t, core.StoreCachedProbe(cfg.CacheDir(), 9, "shared-audio", probe))
		m, err := core.NewManager(core.NewManagerArgs{C: cfg, ManagerParams: core.ManagerParams{
			StreamID: "shared-audio", URL: "http://unused.invalid/fixture", FileID: 9, Etag: "shared-audio",
			PlayableCodecs: []string{"hevc"}, TConfig: config.TCfg{ChunkSize: 3}}, Idle: make(chan core.IdleEvent, 1)})
		require.NoError(t, err)
		t.Cleanup(m.Destroy)
		wantShared := bitrate == 384000
		require.Equal(t, wantShared, m.HasStream(core.QUALITY_AUDIO))
		renditions := m.Renditions()
		require.Len(t, renditions, 5)
		for _, r := range renditions {
			require.NotEqual(t, core.QUALITY_AUDIO, r.Quality)
			require.Equal(t, wantShared, r.SeparateAudio)
		}
		query := "?codecs=h264%2Chevc&token=test-only"
		master, err := MasterPlaylist(renditions, 30, query)
		require.NoError(t, err)
		if wantShared {
			require.Equal(t, 1, strings.Count(master, "#EXT-X-MEDIA:"))
			require.Contains(t, master, "audio.m3u8"+query)
			require.Equal(t, len(renditions), strings.Count(master, `AUDIO="audio"`))
			playlist, err := VariantPlaylist(m, config.TCfg{ChunkSize: 3}, core.QUALITY_AUDIO, query)
			require.NoError(t, err)
			require.Contains(t, playlist, "audio-000000.ts"+query)
		} else {
			require.NotContains(t, master, "#EXT-X-MEDIA:")
		}
	}
}
