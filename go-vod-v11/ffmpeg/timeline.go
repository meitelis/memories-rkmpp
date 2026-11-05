package ffmpeg

import (
	"math"
	"strconv"
	"strings"
	"time"
)

// Keyframe separates the decoder entry point from the pictures in its GOP.
// Open GOPs can contain leading pictures presented before the keyframe itself.
type Keyframe struct {
	PTS   float64 `json:"pts"`
	Start float64 `json:"start"`
}

// ParseTimeline reads the same packet pass used for the copy index. No second
// source scan is needed to retain each GOP's earliest presentation timestamp.
func ParseTimeline(data []byte) []Keyframe {
	var frames []Keyframe
	for line := range strings.SplitSeq(string(data), "\n") {
		pts, flags, _ := strings.Cut(strings.TrimSpace(line), ",")
		ts, err := strconv.ParseFloat(pts, 64)
		if err != nil || math.IsNaN(ts) || math.IsInf(ts, 0) {
			continue
		}
		if strings.Contains(flags, "K") {
			if len(frames) > 0 && ts <= frames[len(frames)-1].PTS {
				return nil
			}
			frames = append(frames, Keyframe{PTS: ts, Start: ts})
		} else if len(frames) > 0 {
			f := &frames[len(frames)-1]
			f.Start = min(f.Start, ts)
		}
	}
	return frames
}

// SourceSegments is the single presentation plan for copy and hardware video.
// Copy seeks use KeyframeAt; encoders trim/force IDRs at Start. Audio retains
// its independent sample clock.
func SourceSegments(frames []Keyframe, duration time.Duration) []Segment {
	if len(frames) == 0 || duration <= 0 {
		return nil
	}
	starts := make([]float64, len(frames))
	for i, f := range frames {
		if math.IsNaN(f.PTS) || math.IsInf(f.PTS, 0) || math.IsNaN(f.Start) || math.IsInf(f.Start, 0) ||
			f.Start > f.PTS || (i > 0 && (f.Start <= starts[i-1] || f.PTS <= frames[i-1].PTS)) {
			return nil
		}
		starts[i] = max(0, f.Start)
	}
	segments := CopySegments(starts, duration)
	if len(segments) != len(frames) {
		return nil
	}
	for i := range segments {
		if frames[i].PTS != segments[i].Start {
			segments[i].KeyframeAt = frames[i].PTS
		}
	}
	return segments
}
