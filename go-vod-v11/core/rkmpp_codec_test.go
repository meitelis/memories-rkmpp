package core

import (
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
