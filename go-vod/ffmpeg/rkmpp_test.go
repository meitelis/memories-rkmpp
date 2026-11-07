package ffmpeg

import (
	"slices"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func assertHasPair(t *testing.T, args []string, key, value string) {
	t.Helper()
	for i := 0; i+1 < len(args); i++ {
		if args[i] == key && args[i+1] == value {
			return
		}
	}
	t.Fatalf("expected %q %q in argv: %s", key, value, strings.Join(args, " "))
}

func TestRKMPPv11EncoderDispatch(t *testing.T) {
	require.Equal(t, EncoderX264, Encoder(Spec{}))
	require.Equal(t, EncoderRKMPP, Encoder(Spec{RKMPP: true}))
	require.Equal(t, EncoderRKMPPHEVC, Encoder(Spec{RKMPP: true, RKMPPOutputCodec: "hevc"}))
	require.Equal(t, EncoderCopy, Encoder(Spec{RKMPP: true, Copy: true}))
	require.Equal(t, EncoderVAAPI, Encoder(Spec{VAAPI: true}))
}

func TestRKMPPInputPacingOnlyAppliesToEncodedHLSVideo(t *testing.T) {
	s := Spec{RKMPP: true, HLS: true, Input: "/tmp/video.mp4"}
	args := BuildArgs(s)
	assertHasPair(t, args, "-readrate", "1.5")
	assertHasPair(t, args, "-readrate_initial_burst", "24")
	assertHasPair(t, args, "-readrate_catchup", "3")
	require.Less(t, slices.Index(args, "-readrate"), slices.Index(args, "-i"))
	for _, other := range []Spec{
		{RKMPP: true, HLS: true, Copy: true},
		{RKMPP: true, HLS: true, AudioOnly: true},
		{RKMPP: true}, {HLS: true},
	} {
		require.False(t, RKMPPInputPaced(other))
		require.NotContains(t, BuildArgs(other), "-readrate")
	}
}

func TestRKMPPv11FMP4ColdSeekKeepsV11Muxer(t *testing.T) {
	s := Spec{
		RKMPP: true, HLS: true, StartAt: 12, Input: "/tmp/video.mp4",
		CodecName: "hevc", PixelFormat: "yuv420p10le", BitDepth: 10,
		FrameRate: 30, Width: 1280, Height: 720, ChunkSize: 3,
		Bitrate: 6000000, Audio: AudioInfo{CodecName: "aac", Profile: "LC", SampleRate: 48000, Channels: 2, BitRate: 160000},
	}
	args := SegmentArgs(s, 3, "/tmp/720p-%06d.m4s", "/tmp/720p-init.m4s")
	joined := strings.Join(args, " ")
	assertHasPair(t, args, "-hwaccel", "rkmpp")
	assertHasPair(t, args, "-hwaccel_output_format", "drm_prime")
	assertHasPair(t, args, "-c:v", "h264_rkmpp")
	assertHasPair(t, args, "-hls_segment_type", "fmp4")
	assertHasPair(t, args, "-hls_fmp4_init_filename", "/tmp/720p-init.m4s")
	assertHasPair(t, args, "-hls_segment_filename", "/tmp/720p-%06d.m4s")
	assertHasPair(t, args, "-g", "90")
	assertHasPair(t, args, "-keyint_min", "90")
	assertHasPair(t, args, "-copyts", "-fflags")
	require.Contains(t, joined, "scale_rkrga=")
	require.Contains(t, joined, "movflags=+frag_discont+negative_cts_offsets:use_editlist=0")
	require.NotContains(t, joined, "-force_key_frames")
	require.Contains(t, joined, "-c:a copy")
}

func TestRKMPPv11HEVCHasHVC1Tag(t *testing.T) {
	s := Spec{RKMPP: true, RKMPPOutputCodec: "hevc", Input: "/tmp/video.mp4", CodecName: "h264", Width: 1920, Height: 1080, FrameRate: 30}
	args := MP4Args(s)
	assertHasPair(t, args, "-c:v", "hevc_rkmpp")
	assertHasPair(t, args, "-tag:v", "hvc1")
	assertHasPair(t, args, "-f", "mp4")
}

func TestRKMPPv11HardwareDecodeFallsBackForUnsupportedFormats(t *testing.T) {
	for _, tc := range []struct {
		codec, pixel string
		depth        int
		hdr          bool
	}{
		{"prores", "yuv422p10le", 10, false},
		{"hevc", "yuv444p10le", 10, false},
		{"hevc", "yuv420p12le", 12, false},
		{"hevc", "p010le", 10, true},
		{"hevc", "yuv420p9le", 9, false},
		{"hevc", "yuv420p10be", 10, false},
	} {
		s := Spec{RKMPP: true, Input: "/tmp/video.mp4", CodecName: tc.codec, PixelFormat: tc.pixel,
			BitDepth: tc.depth, HDR: tc.hdr, Width: 1280, Height: 720}
		args := BuildArgs(s)
		joined := strings.Join(args, " ")
		require.False(t, slices.Contains(args, "rkmpp"), joined)
		require.NotContains(t, joined, "scale_rkrga", joined)
		require.Contains(t, joined, "-c:v h264_rkmpp")
	}
}

func TestRKMPPv11NeverAltersDirectStreamCopy(t *testing.T) {
	s := Spec{RKMPP: true, Copy: true, CodecName: "hevc", Input: "/tmp/original.mp4", HLS: true, ChunkSize: 3}
	args := SegmentArgs(s, 0, "/tmp/direct-%06d.m4s", "/tmp/direct-init.m4s")
	joined := strings.Join(args, " ")
	require.Contains(t, joined, "-c:v copy")
	require.NotContains(t, joined, "scale_rkrga")
	assertHasPair(t, args, "-hls_segment_type", "fmp4")
}

func TestRKMPPv11SdrAndMaliHDRSeparation(t *testing.T) {
	s := Spec{RKMPP: true, Input: "/tmp/video.mp4", CodecName: "hevc", PixelFormat: "p010le",
		BitDepth: 10, HDR: true, RKMPPOpenCL: true, Width: 1280, Height: 720}
	args := BuildArgs(s)
	joined := strings.Join(args, " ")
	require.Contains(t, joined, "scale_rkrga=force_divisible_by=2:format=p010")
	require.Contains(t, joined, "tonemap_opencl")
	require.Contains(t, joined, "format=drm_prime")
	s.RKMPPOpenCL = false
	cpu := strings.Join(BuildArgs(s), " ")
	require.NotContains(t, cpu, "scale_rkrga")
	require.Contains(t, cpu, "tonemap=hable")
	require.NotContains(t, cpu, "tonemap_opencl")
}
