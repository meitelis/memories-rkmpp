package core

import (
	"strings"
	"testing"

	"github.com/pulsejet/memories/go-vod/config"
	"github.com/stretchr/testify/require"
)

func TestRKMPPCodecNegotiation(t *testing.T) {
	for _, tc := range []struct {
		name     string
		enabled  bool
		forced   string
		playable []string
		want     string
	}{
		{"unknown client", true, "hevc", nil, "h264"},
		{"AVC client", true, "hevc", []string{"h264"}, "h264"},
		{"HEVC client", true, "hevc", []string{"h264", "hevc"}, "hevc"},
		{"forced AVC", true, "h264", []string{"hevc"}, "h264"},
		{"other backend", false, "hevc", []string{"hevc"}, "h264"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m := &Manager{c: &config.Config{RKMPP: tc.enabled, RKMPPOutputCodec: tc.forced}, playableCodecs: tc.playable}
			require.Equal(t, tc.want, m.OutputCodec())
		})
	}
}

func TestRKMPPAutoKeepsCompatibleAVCOriginal(t *testing.T) {
	m := &Manager{c: &config.Config{RKMPP: true, RKMPPOutputCodec: "auto"},
		probe: &ProbeVideoData{CodecName: "h264", BitDepth: 8}, playableCodecs: []string{"h264", "hevc"}}
	require.Equal(t, "h264", m.OutputCodec())
	m.probe.HDR = true
	require.Equal(t, "hevc", m.OutputCodec(), "HDR is mapped to an SDR ladder")
	m.c.RKMPPOutputCodec = "h264"
	require.Equal(t, "h264", m.OutputCodec())
}

func TestRKMPPPreservesCompatibleHEVCOriginalInMaster(t *testing.T) {
	c := config.Defaults("0.7.0")
	c.RKMPP, c.RKMPPOutputCodec = true, "hevc"
	c.TempDir, c.CacheDir_ = t.TempDir(), t.TempDir()
	t.Setenv("CACHE_DIR", c.CacheDir_)
	c.FFprobe = stubCopyProbe(t, `{"streams":[{"codec_type":"video","codec_name":"hevc","width":3200,"height":1800,"duration":"12","avg_frame_rate":"50/1","pix_fmt":"yuv420p","bit_rate":"7755786"},{"codec_type":"audio","codec_name":"aac","profile":"LC","channels":2,"sample_rate":"48000","bit_rate":"160915"}]}`, "", false)
	m, err := NewManager(NewManagerArgs{C: c, ManagerParams: ManagerParams{URL: "http://localhost/original.mp4", StreamID: "original", PlayableCodecs: []string{"hevc"}, TConfig: config.TCfg{ChunkSize: 3}}, Idle: make(chan IdleEvent, 1)})
	require.NoError(t, err)
	defer m.Destroy()
	require.True(t, m.IsCopyEligible())
	require.True(t, m.HasStream(QUALITY_DIRECT))
	require.True(t, m.HasStream(QUALITY_MAX), "retain an internal transcode fallback")
	found := false
	for _, r := range m.Renditions() {
		require.GreaterOrEqual(t, min(r.Width, r.Height), 480, "480p is the minimum video ladder resolution")
		require.NotEqual(t, QUALITY_MAX, r.Quality, "do not advertise a lossy duplicate of the original")
		require.True(t, r.SeparateAudio, "all video qualities must use the same audio stream")
		if r.Quality == QUALITY_DIRECT {
			found = true
			require.True(t, strings.HasPrefix(r.Codecs, "hvc1."))
		}
	}
	require.True(t, found, "original must be visible in the master playlist")
	require.True(t, m.HasStream("480p-low"), "weak links need a lower bitrate at the same minimum resolution")
	require.Less(t, m.streams["480p-low"].bitrate, m.streams["480p"].bitrate)
	require.Equal(t, m.streams["480p"].height, m.streams["480p-low"].height)
}

func TestRenditionsPreservePortraitDimensions(t *testing.T) {
	for _, source := range []struct{ width, height, rotation int }{
		{1920, 1080, 0}, {1080, 1920, 0}, {1920, 1080, -90},
		{1920, 1080, 270}, {1920, 1080, 90}, {1920, 1080, -270},
	} {
		m := &Manager{c: &config.Config{RKMPP: true}, probe: &ProbeVideoData{Width: source.width, Height: source.height, Rotation: source.rotation}, streams: map[string]*Stream{"720p": {quality: "720p", width: 1280, height: 720}}}
		r := m.Renditions()[0]
		if source.width < source.height || source.rotation != 0 {
			require.Equal(t, 720, r.Width)
			require.Equal(t, 1280, r.Height)
		} else {
			require.Equal(t, 1280, r.Width)
			require.Equal(t, 720, r.Height)
		}
	}
}
