package ffmpeg

import (
	"github.com/stretchr/testify/require"
	"strings"
	"testing"
)

func TestRKMPPAuthenticatedColdSeek(t *testing.T) {
	s := Spec{RKMPP: true, Input: "http://nextcloud/video", Headers: "X-Memories-Service-Token: private-token\r\n", CodecName: "hevc", BitDepth: 10, FrameRateExact: 29.97, Width: 1920, Height: 1080, Quality: "1080p", HLS: true, ChunkSize: 3, StartAt: 12, Bitrate: 6000000, Audio: AudioInfo{CodecName: "aac"}}
	args := SegmentArgs(s, 4, "/tmp/1080p-%06d.ts")
	joined := strings.Join(args, " ")
	for _, part := range []string{"-hwaccel rkmpp", "-c:v h264_rkmpp", "scale_rkrga=", "-noaccurate_seek", "fps=fps=30:round=near,trim=start=12.000000", "atrim=start=12.000000", "-g 90 -keyint_min 90", "-hls_flags independent_segments", "-reconnect_on_http_error 429,5xx", "-headers " + s.Headers} {
		require.Contains(t, joined, part)
	}
	require.NotContains(t, strings.Join(RedactArgs(args), " "), "private-token")
	require.Equal(t, 1, strings.Count(joined, "-fps_mode"))
}

func TestRKMPPUnsupportedDecodeKeepsHardwareEncode(t *testing.T) {
	for _, s := range []Spec{{CodecName: "h264", BitDepth: 10}, {CodecName: "hevc", BitDepth: 10, HDR: true}, {CodecName: "prores", BitDepth: 10}} {
		s.RKMPP = true
		s.FrameRate = 30
		s.Quality = "720p"
		s.Width = 1280
		s.Height = 720
		args := strings.Join(BuildArgs(s), " ")
		require.Contains(t, args, "-c:v h264_rkmpp")
		require.NotContains(t, args, "-hwaccel rkmpp")
		require.NotContains(t, args, "scale_rkrga")
	}
}
