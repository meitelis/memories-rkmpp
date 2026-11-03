package ffmpeg

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
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
	for _, s := range []Spec{{CodecName: "hevc", BitDepth: 12}, {CodecName: "hevc", BitDepth: 10, HDR: true}, {CodecName: "prores", BitDepth: 10}, {CodecName: "h264", PixelFormat: "yuv422p"}, {CodecName: "hevc", PixelFormat: "yuv444p10le", BitDepth: 10}} {
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

func TestRKMPPHigh10H264UsesHardwareFrames(t *testing.T) {
	s := Spec{RKMPP: true, CodecName: "h264", BitDepth: 10, PixelFormat: "yuv420p10le", Width: 1280, Height: 720, FrameRate: 30}
	args := strings.Join(BuildArgs(s), " ")
	require.Contains(t, args, "-hwaccel rkmpp")
	require.Contains(t, args, "scale_rkrga=")
	require.Contains(t, args, "-c:v h264_rkmpp")
}

func TestRKMPPCompatibleAudioKeepsSourcePacketsAcrossRenditionsAndSeeks(t *testing.T) {
	for _, sampleRate := range []int{44100, 48000} {
		for _, channels := range []int{1, 2} {
			for _, codec := range []string{"h264", "hevc"} {
				for _, quality := range []string{"480p", "1080p", QualityMax} {
					for _, start := range []float64{0, 9, 12} {
						t.Run(fmt.Sprintf("rate=%d/channels=%d/codec=%s/quality=%s/start=%g", sampleRate, channels, codec, quality, start), func(t *testing.T) {
							s := baseSpec()
							s.RKMPP, s.HLS, s.OutputCodec, s.Quality, s.StartAt = true, true, codec, quality, start
							s.Audio = AudioInfo{CodecName: "aac", Profile: "lC", Channels: channels, SampleRate: sampleRate, BitRate: 166915}
							args := SegmentArgs(s, int(start)/s.ChunkSize, SegmentPattern(t.TempDir(), quality))
							require.Equal(t, "copy", args[slices.Index(args, "-c:a")+1])
							for _, flag := range []string{"-af", "-ac", "-ar", "-b:a"} {
								require.NotContains(t, args, flag, "copied AAC must not be filtered or converted")
							}
							if start > 0 {
								require.Equal(t, "0", args[slices.Index(args, "-copypriorss:a")+1])
								require.Greater(t, slices.Index(args, "-copypriorss:a"), slices.Index(args, "-i"))
								require.Contains(t, args[slices.Index(args, "-vf")+1], fmt.Sprintf("trim=start=%.6f", start))
							} else {
								require.NotContains(t, args, "-copypriorss:a")
							}
							// Audio preserves absolute timestamps while the video remains on
							// the existing shared GOP clock.
							require.Contains(t, args, "-copyts")
							require.Equal(t, "90", args[slices.Index(args, "-g")+1])
							require.Equal(t, "90", args[slices.Index(args, "-keyint_min")+1])
						})
					}
				}
			}
		}
	}
}

func TestRKMPPAudioCompatibilityGate(t *testing.T) {
	compatible := AudioInfo{CodecName: "aac", Profile: "LC", Channels: 2, SampleRate: 48000, BitRate: 166915}
	for _, tc := range []struct {
		name   string
		change func(*AudioInfo)
		copy   bool
	}{
		{"AAC-LC", func(*AudioInfo) {}, true},
		{"case-insensitive codec and profile", func(a *AudioInfo) { a.CodecName, a.Profile = "AAC", "lc" }, true},
		{"highest allowed bitrate", func(a *AudioInfo) { a.BitRate = 256000 }, true},
		{"44.1kHz", func(a *AudioInfo) { a.SampleRate = 44100 }, true},
		{"unknown profile", func(a *AudioInfo) { a.Profile = "" }, false},
		{"HE-AAC", func(a *AudioInfo) { a.Profile = "HE-AAC" }, false},
		{"HE-AACv2", func(a *AudioInfo) { a.Profile = "HE-AACv2" }, false},
		{"AAC Main", func(a *AudioInfo) { a.Profile = "Main" }, false},
		{"unsupported sample rate", func(a *AudioInfo) { a.SampleRate = 32000 }, false},
		{"unknown sample rate", func(a *AudioInfo) { a.SampleRate = 0 }, false},
		{"unknown channels", func(a *AudioInfo) { a.Channels = 0 }, false},
		{"surround", func(a *AudioInfo) { a.Channels = 6 }, false},
		{"unknown bitrate", func(a *AudioInfo) { a.BitRate = 0 }, false},
		{"negative bitrate", func(a *AudioInfo) { a.BitRate = -1 }, false},
		{"over the copy bitrate limit", func(a *AudioInfo) { a.BitRate = 256001 }, false},
		{"320kbps audio benefits from normalization", func(a *AudioInfo) { a.BitRate = 320000 }, false},
		{"512kbps audio benefits from normalization", func(a *AudioInfo) { a.BitRate = 512000 }, false},
		{"other codec", func(a *AudioInfo) { a.CodecName = "mp3" }, false},
		{"lossless FLAC", func(a *AudioInfo) { a.CodecName, a.BitRate = "flac", 1000000 }, false},
		{"uncompressed PCM", func(a *AudioInfo) { a.CodecName, a.BitRate = "pcm_s16le", 1536000 }, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := baseSpec()
			s.RKMPP, s.HLS, s.StartAt, s.Audio = true, true, 12, compatible
			tc.change(&s.Audio)
			args := BuildArgs(s)
			if tc.copy {
				require.Equal(t, "copy", args[slices.Index(args, "-c:a")+1])
				require.NotContains(t, args, "-af")
			} else {
				require.Equal(t, "aac", args[slices.Index(args, "-c:a")+1])
				require.Equal(t, "2", args[slices.Index(args, "-ac")+1])
				require.Equal(t, "48000", args[slices.Index(args, "-ar")+1])
				require.Equal(t, "128k", args[slices.Index(args, "-b:a")+1])
				require.Equal(t, "atrim=start=12.000000,aresample=async=1", args[slices.Index(args, "-af")+1])
				require.NotContains(t, args, "-copypriorss:a")
			}
		})
	}
}

func TestRKMPPVideoBudgetAccountsForCopiedAudioBitrate(t *testing.T) {
	for _, tc := range []struct {
		name  string
		audio AudioInfo
		rate  string
	}{
		{"copied 166915bps", AudioInfo{CodecName: "aac", Profile: "LC", Channels: 2, SampleRate: 48000, BitRate: 166915}, "5233085"},
		{"copied 64000bps", AudioInfo{CodecName: "aac", Profile: "LC", Channels: 1, SampleRate: 48000, BitRate: 64000}, "5336000"},
		{"copied 256000bps 44.1kHz", AudioInfo{CodecName: "aac", Profile: "LC", Channels: 2, SampleRate: 44100, BitRate: 256000}, "5144000"},
		{"normalized HE-AAC", AudioInfo{CodecName: "aac", Profile: "HE-AAC", Channels: 2, SampleRate: 48000, BitRate: 166915}, "5272000"},
		{"normalized 320000bps AAC", AudioInfo{CodecName: "aac", Profile: "LC", Channels: 2, SampleRate: 48000, BitRate: 320000}, "5272000"},
		{"normalized lossless FLAC", AudioInfo{CodecName: "flac", Channels: 2, SampleRate: 48000, BitRate: 1000000}, "5272000"},
		{"silent", AudioInfo{}, "5400000"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := baseSpec()
			s.RKMPP, s.HLS, s.Bitrate, s.Audio = true, true, 6000000, tc.audio
			args := BuildArgs(s)
			require.Equal(t, tc.rate, args[slices.Index(args, "-b:v")+1])
			require.Equal(t, tc.rate, args[slices.Index(args, "-maxrate")+1])
		})
	}
}

func TestRKMPPHLSPreservesChildMuxerClock(t *testing.T) {
	for _, start := range []float64{0, 6} {
		s := baseSpec()
		s.RKMPP, s.HLS, s.StartAt = true, true, start
		s.Audio = AudioInfo{CodecName: "aac", Profile: "LC", Channels: 2, SampleRate: 48000, BitRate: 166915}
		args := SegmentArgs(s, int(start)/s.ChunkSize, SegmentPattern(t.TempDir(), s.Quality))
		require.Equal(t, "disabled", args[slices.Index(args, "-avoid_negative_ts")+1])
		require.Equal(t, "avoid_negative_ts=disabled", args[slices.Index(args, "-hls_segment_options")+1],
			"warm and cold MPEG-TS children must retain the same source clock")

		s.HLS = false
		require.NotContains(t, MP4Args(s), "-hls_segment_options")
		s.RKMPP = false
		require.NotContains(t, SegmentArgs(s, 0, SegmentPattern(t.TempDir(), s.Quality)), "-hls_segment_options")
	}
}
