package core

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/pulsejet/memories/go-vod/config"
	"github.com/pulsejet/memories/go-vod/ffmpeg"
	"github.com/stretchr/testify/require"
)

func TestRKMPPUnusualAspectRatiosKeepLowerRenditions(t *testing.T) {
	for _, source := range []struct{ width, height, rotation int }{{1920, 1000, 0}, {1000, 1920, 0}, {1438, 1424, 90}, {1424, 1438, -90}} {
		t.Run(fmt.Sprint(source), func(t *testing.T) {
			cfg := config.Defaults("test")
			cfg.RKMPP = true
			cfg.TempDir = t.TempDir()
			probe := fmt.Sprintf("{\"streams\":[{\"codec_type\":\"video\",\"codec_name\":\"hevc\",\"width\":%d,\"height\":%d,\"duration\":\"12\",\"avg_frame_rate\":\"30/1\",\"bit_rate\":\"7000000\",\"side_data_list\":[{\"side_data_type\":\"Display Matrix\",\"rotation\":%d}]}]}", source.width, source.height, source.rotation)
			cfg.FFprobe = stubCopyProbe(t, probe, "", false)
			m, err := NewManager(NewManagerArgs{C: cfg, ManagerParams: ManagerParams{StreamID: "aspect", URL: "http://localhost/video", PlayableCodecs: []string{"hevc"}, TConfig: config.TCfg{ChunkSize: 3}}, Idle: make(chan IdleEvent, 1)})
			require.NoError(t, err)
			t.Cleanup(m.Destroy)
			require.True(t, m.HasStream("720p"))
			for _, rendition := range m.Renditions() {
				require.Zero(t, rendition.Width%2)
				require.Zero(t, rendition.Height%2)
				spec := m.streams[rendition.Quality].spec(0, true)
				width, height := rendition.Width, rendition.Height
				if ffmpeg.SwapsAxes(source.rotation) {
					width, height = height, width
				}
				args := strings.Join(ffmpeg.BuildArgs(spec), " ")
				require.Contains(t, args, fmt.Sprintf("w=%d:h=%d", width, height))
			}
		})
	}
}

func TestRKMPPMaxDimensionsAreEven(t *testing.T) {
	cfg := config.Defaults("test")
	cfg.RKMPP = true
	cfg.TempDir = t.TempDir()
	cfg.FFprobe = stubCopyProbe(t, "{\"streams\":[{\"codec_type\":\"video\",\"codec_name\":\"hevc\",\"width\":1281,\"height\":721,\"duration\":\"2\",\"bit_rate\":\"1000000\"}]}", "", false)
	m, err := NewManager(NewManagerArgs{C: cfg, ManagerParams: ManagerParams{StreamID: "odd", URL: "http://localhost/video", TConfig: config.TCfg{ChunkSize: 3}}, Idle: make(chan IdleEvent, 1)})
	require.NoError(t, err)
	t.Cleanup(m.Destroy)
	for _, rendition := range m.Renditions() {
		require.Zero(t, rendition.Width%2)
		require.Zero(t, rendition.Height%2)
		require.LessOrEqual(t, rendition.Width, 1281)
		require.LessOrEqual(t, rendition.Height, 721)
	}
}

func TestOutOfRangeChunksDoNotStartAnEncoder(t *testing.T) {
	m := &Manager{c: &config.Config{RKMPP: true}, tc: config.TCfg{ChunkSize: 3}, probe: &ProbeVideoData{Duration: 10 * time.Second}, streams: map[string]*Stream{"720p": {quality: "720p"}, "max": {quality: "max"}}}
	for _, id := range []int{-1, 3, 999999} {
		require.False(t, m.ServeChunk(nil, "720p", id))
	}
}
