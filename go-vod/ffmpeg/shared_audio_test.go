package ffmpeg

import (
	"slices"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestSharedAudioNormalizesOnceWithoutVideoHardware(t *testing.T) {
	s := baseSpec()
	s.RKMPP, s.HLS, s.AudioOnly = true, true, true
	s.StartAt, s.EndAt = 6, 12
	s.Audio = AudioInfo{CodecName: "aac", Profile: "LC", Channels: 2, SampleRate: 48000, BitRate: 384000}
	args := SegmentArgs(s, 2, "/cache/audio-%06d.ts")
	joined := strings.Join(args, " ")
	require.Contains(t, joined, "-vn -map 0:a:0 -c:a aac -ac 2 -ar 48000 -b:a 128k")
	require.Contains(t, joined, "apad=whole_dur=6.000000")
	require.Contains(t, joined, "asetpts=N/SR/TB+6.000000/TB")
	require.Contains(t, joined, "-to 12.000000")
	require.NotContains(t, args, "-t")
	require.Contains(t, joined, "-hls_segment_options avoid_negative_ts=disabled")
	for _, flag := range []string{"-hwaccel", "-vf", "-c:v", "-g", "-keyint_min"} {
		require.NotContains(t, args, flag)
	}
	require.False(t, IsRKMPPEncoder(Encoder(s)))
}

func TestSharedAudioVideoJobsDoNotEncodeOrMuxAudio(t *testing.T) {
	for _, copyVideo := range []bool{false, true} {
		s := baseSpec()
		s.RKMPP, s.HLS, s.SeparateAudio, s.Copy = true, true, true, copyVideo
		s.Audio = AudioInfo{CodecName: "pcm_s16le", Channels: 2, SampleRate: 48000, BitRate: 1536000}
		args := BuildArgs(s)
		require.Contains(t, args, "-an")
		require.NotContains(t, args, "-c:a")
		for i, arg := range args {
			if arg == "-map" {
				require.NotEqual(t, "0:a:0?", args[i+1])
			}
		}
		s.SeparateAudio = false
		require.True(t, slices.Contains(BuildArgs(s), "-c:a"), "progressive/muxed output must retain audio")
	}
}
