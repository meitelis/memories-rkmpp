package ffmpeg

import (
	"slices"
	"strconv"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestRKMPPMinimumBitrateCoversLowBandwidthAudioAllocation(t *testing.T) {
	for _, tc := range []struct {
		name      string
		audio     AudioInfo
		audioRate int
		minimum   int
	}{
		{"silent", AudioInfo{}, 0, 142223},
		{"normalized", AudioInfo{CodecName: "ac3", Channels: 6, BitRate: 640000}, 128000, 284445},
		{"copied 64k AAC", AudioInfo{CodecName: "aac", Profile: "LC", Channels: 1, SampleRate: 44100, BitRate: 64000}, 64000, 213334},
		{"copied 256k AAC", AudioInfo{CodecName: "aac", Profile: "LC", Channels: 2, SampleRate: 48000, BitRate: 256000}, 256000, 426667},
	} {
		t.Run(tc.name, func(t *testing.T) {
			require.Equal(t, tc.minimum, RKMPPMinBitrate(tc.audio))
			for _, originalBudget := range []int{256000, 384000} {
				s := baseSpec()
				s.RKMPP, s.HLS, s.Audio = true, true, tc.audio
				s.Bitrate = max(originalBudget, RKMPPMinBitrate(tc.audio))
				args := BuildArgs(s)
				videoRate, err := strconv.Atoi(args[slices.Index(args, "-b:v")+1])
				require.NoError(t, err)
				require.GreaterOrEqual(t, videoRate, 128000)
				require.GreaterOrEqual(t, s.Bitrate*9/10, videoRate+tc.audioRate)
			}
		})
	}
}
