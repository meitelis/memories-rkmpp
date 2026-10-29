package ffmpeg

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestRKMPPOutputCodec(t *testing.T) {
	for _, codec := range []string{"", "h264", "hevc"} {
		s := Spec{RKMPP: true, OutputCodec: codec, Width: 1920, Height: 1080, FrameRate: 60, Quality: QualityMax, HLS: true, ChunkSize: 3}
		encoder := EncoderRKMPP
		if codec == "hevc" {
			encoder = EncoderRKMPPHEVC
		}
		t.Run(codec, func(t *testing.T) {
			require.Equal(t, encoder, Encoder(s))
			args := strings.Join(SegmentArgs(s, 2, "/tmp/max-%06d.ts"), " ")
			require.Contains(t, args, "-c:v "+encoder)
			require.Contains(t, args, "-g 180 -keyint_min 180")
			require.Contains(t, args, "-an")
			if codec == "hevc" {
				require.Contains(t, args, "-profile:v main -tier main -level:v 4.1 -tag:v hvc1")
			}
			s.Copy = true
			require.Equal(t, EncoderCopy, Encoder(s))
		})
	}
}

func TestHEVCLevel(t *testing.T) {
	for _, tc := range []struct{ width, height, fps, level int }{
		{1280, 720, 30, 93}, {720, 1280, 30, 93},
		{1920, 1080, 30, 120}, {1080, 1920, 60, 123},
		{2560, 1440, 60, 150}, {3840, 2160, 60, 153},
		{7680, 4320, 60, 183},
	} {
		require.Equal(t, tc.level, HEVCLevel(tc.width, tc.height, tc.fps).IDC)
	}
	require.Equal(t, "hvc1.1.6.L123.80,mp4a.40.2", HEVCCodecs(1080, 1920, 60, true))
	require.Equal(t, "hvc1.1.6.L120.80", HEVCCodecs(1920, 1080, 30, false))
}
