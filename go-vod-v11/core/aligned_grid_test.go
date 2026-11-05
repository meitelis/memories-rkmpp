package core

import (
	"net/http/httptest"
	"testing"
	"time"

	"github.com/pulsejet/memories/go-vod/config"
	"github.com/stretchr/testify/require"
)

func gridManager(t *testing.T, cache string) *Manager {
	t.Helper()
	c := config.Defaults("test")
	c.RKMPP, c.CacheDir_ = true, cache
	m := &Manager{c: c, tc: config.TCfg{ChunkSize: 3}, fileid: 7, etag: "same", copyEligible: true,
		probe: &ProbeVideoData{Duration: 10 * time.Second, FrameRate: 30, FrameRateExact: 30,
			Width: 1280, Height: 720, CodecName: "h264", PixelFormat: "yuv420p"},
		streams: make(map[string]*Stream)}
	for _, q := range []string{"480p", QUALITY_AUDIO, QUALITY_DIRECT} {
		m.streams[q] = &Stream{c: c, m: m, quality: q, width: 854, height: 480}
	}
	return m
}

func TestAlignedGridUsesOneCachedChoiceForAllVideo(t *testing.T) {
	cache := t.TempDir()
	m := gridManager(t, cache)
	require.Nil(t, m.AlignedGrid(QUALITY_AUDIO), "audio must not settle the video decision")
	require.NoError(t, StoreCachedKeyframes(cache, 7, "same", []float64{0, .94, 3.94, 6.94, 9.94}))
	g := m.AlignedGrid("480p")
	require.NotNil(t, g)
	require.Equal(t, .94, g.Segments[1].Start)
	require.Same(t, g, m.streams["480p"].spec(.94, true).KeyframeGrid)
	require.Nil(t, m.streams["480p"].spec(0, false).KeyframeGrid, "progressive output is unchanged")
	require.Nil(t, m.streams[QUALITY_AUDIO].spec(0, true).KeyframeGrid)
	require.Nil(t, m.AlignedGrid(QUALITY_DIRECT), "Original keeps its established copy path")
	require.False(t, m.ServeChunk(httptest.NewRecorder(), "480p", len(g.Segments)))
}

func TestAlignedGridCacheMissCannotChangeAnActivePlaylist(t *testing.T) {
	cache := t.TempDir()
	m := gridManager(t, cache)
	require.Nil(t, m.AlignedGrid("480p"))
	require.NoError(t, StoreCachedKeyframes(cache, 7, "same", []float64{0, 1, 4, 7}))
	require.Nil(t, m.AlignedGrid("480p"), "a running ladder must never change its numbering")
	require.NotNil(t, gridManager(t, cache).AlignedGrid("480p"), "the next session can use the warmed cache")
}
