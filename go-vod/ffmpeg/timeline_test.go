package ffmpeg

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestOpenGOPPresentationPlan(t *testing.T) {
	frames := ParseTimeline([]byte("0,K__\n0.08,___\n0.96,K__\n0.90,___\n0.94,___\n1.92,K__\n1.86,___\n"))
	require.Equal(t, []Keyframe{{PTS: 0, Start: 0}, {PTS: .96, Start: .9}, {PTS: 1.92, Start: 1.86}}, frames)
	segments := SourceSegments(frames, 2820*time.Millisecond)
	require.Len(t, segments, 3)
	require.InDelta(t, .9, segments[0].Duration, .000001)
	require.Equal(t, .9, segments[1].Start)
	require.Equal(t, .96, segments[1].KeyframeAt, "copy must seek to the actual keyframe")
	grid := NewRKMPPKeyframeGrid(segments, 50)
	require.NotNil(t, grid)
	require.Equal(t, "0.899999000,1.859999000", grid.forceTimes(.9), "encoded IDRs cover the leading pictures")
}

func TestTimelineRejectsInvalidPresentationOrder(t *testing.T) {
	require.Nil(t, ParseTimeline([]byte("1,K__\n0.5,K__\n")))
	require.Nil(t, SourceSegments([]Keyframe{{PTS: 0, Start: 0}, {PTS: 1, Start: 0}}, 2*time.Second))
	require.Nil(t, SourceSegments([]Keyframe{{PTS: 0, Start: 1}}, 2*time.Second))
}
