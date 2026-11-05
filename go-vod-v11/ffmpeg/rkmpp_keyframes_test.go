package ffmpeg

import (
	"math"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestRKMPPKeyframeGrid(t *testing.T) {
	segs := CopySegments([]float64{0, .934267, 2.936267, 6.940267, 9.4094}, 11*time.Second+11*time.Millisecond)
	g := NewRKMPPKeyframeGrid(segs, 30)
	require.NotNil(t, g)
	require.Greater(t, g.GOPSize, 330)
	require.Equal(t, "2.936266000,6.940266000,9.409399000", g.forceTimes(2.936267))
	segs[0].Start = 42
	require.Zero(t, g.Segments[0].Start, "the shared plan owns an immutable copy")

	s := Spec{RKMPP: true, RKMPPOutputCodec: "hevc", HLS: true, Input: "/source.mp4",
		CodecName: "h264", PixelFormat: "yuv420p", FrameRate: 30, FrameRateExact: 30000.0 / 1001,
		Width: 854, Height: 480, ChunkSize: 3, StartAt: 2.936267, KeyframeGrid: g}
	args := SegmentArgs(s, 2, "/cache/video-%06d.m4s", "/cache/init.mp4")
	assertHasPair(t, args, "-ss", "2.936277000")
	assertHasPair(t, args, "-flags:v", "+low_delay")
	assertHasPair(t, args, "-hls_time", copyHLSTime)
	assertHasPair(t, args, "-force_key_frames", g.forceTimes(s.StartAt))
	require.Contains(t, strings.Join(args, " "), "trim=start=2.936266000")
	require.NotContains(t, strings.Join(args, " "), "fps=fps=", "fractional/VFR source PTS must survive")

	key := HWProbeKey(s)
	require.Nil(t, key.KeyframeGrid)
	cache := map[Spec]bool{key: true}
	require.True(t, cache[HWProbeKey(s)], "Spec must remain a valid hardware cache key")
}

func TestRKMPPKeyframeGridRejectsUnsuitablePlans(t *testing.T) {
	for _, segs := range [][]Segment{
		nil, {{Start: 0, Duration: 1}},
		{{Start: 0, Duration: 7}, {Start: 7, Duration: 1}},
		{{Start: 0, Duration: 1}, {Start: 2, Duration: 1}},
		{{Start: 0, Duration: 1}, {Start: 1, Duration: math.NaN()}},
	} {
		require.Nil(t, NewRKMPPKeyframeGrid(segs, 30))
	}
	dense := make([]Segment, 100)
	for i := range dense {
		dense[i] = Segment{Start: float64(i) / 60, Duration: 1.0 / 60}
	}
	require.Nil(t, NewRKMPPKeyframeGrid(dense, 60))
	large := make([]Segment, 6000)
	for i := range large {
		large[i] = Segment{Start: float64(i), Duration: 1}
	}
	require.Nil(t, NewRKMPPKeyframeGrid(large, 30), "the timestamp argument must stay within exec limits")
}
