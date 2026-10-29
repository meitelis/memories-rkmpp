package ffmpeg

import (
	"fmt"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestRotationConventions(t *testing.T) {
	for input, want := range map[int]int{0: 0, 360: 0, -360: 0, 90: 90, -270: 90, -90: -90, 270: -90, 180: 180, -180: 180, 450: 90} {
		t.Run(fmt.Sprint(input), func(t *testing.T) {
			require.Equal(t, want, NormalizeRotation(input))
			require.Equal(t, want == 90 || want == -90, SwapsAxes(input))
			info, err := ParseProbeJSON([]byte(fmt.Sprintf(`{"streams":[{"codec_type":"video","side_data_list":[{"side_data_type":"Display Matrix","rotation":%d}]}]}`, input)))
			require.NoError(t, err)
			require.Equal(t, want, info.Rotation)
		})
	}
	info, err := ParseProbeJSON([]byte(`{"streams":[{"codec_type":"video","tags":{"rotate":"90"}}]}`))
	require.NoError(t, err)
	require.Equal(t, -90, info.Rotation)
}

func TestRKMPPRotationAliases(t *testing.T) {
	for _, hw := range []bool{true, false} {
		for rotation, transpose := range map[int]string{90: "2", -270: "2", -90: "1", 270: "1", 180: "4", -180: "4"} {
			t.Run(fmt.Sprintf("hardware=%v/rotation=%d", hw, rotation), func(t *testing.T) {
				s := Spec{RKMPP: true, CodecName: "hevc", Rotation: rotation, ForceSwTranspose: !hw, Quality: QualityMax}
				args := strings.Join(BuildArgs(s), " ")
				require.Contains(t, args, "-noautorotate")
				if hw {
					require.Contains(t, args, "vpp_rkrga=transpose="+transpose)
				} else if transpose == "4" {
					require.Contains(t, args, "transpose=1,transpose=1")
				} else {
					require.Contains(t, args, "transpose="+transpose)
				}
				require.Contains(t, args, "setsar=1")
			})
		}
	}
}

func TestRKMPPFrameRateUsesSameClockAsGOP(t *testing.T) {
	for _, fps := range []float64{23.976, 29.97, 59.94, 60} {
		s := Spec{RKMPP: true, FrameRateExact: fps, HLS: true, ChunkSize: 3}
		args := strings.Join(SegmentArgs(s, 0, "/tmp/%06d.ts"), " ")
		rate := RKMPPFrameRate(s)
		require.Contains(t, args, fmt.Sprintf("fps=fps=%d:round=near", rate))
		require.Contains(t, args, fmt.Sprintf("-g %d -keyint_min %d", 3*rate, 3*rate))
	}
}
