package ffmpeg

import (
	"math"
	"slices"
	"strconv"
	"strings"
)

const rkmppKeyframeEpsilon = 0.000001

// RKMPPKeyframeGrid is an immutable plan shared by a file's video renditions.
// A pointer keeps Spec comparable for the hardware-probe cache.
type RKMPPKeyframeGrid struct {
	Segments []Segment
	GOPSize  int
}

// NewRKMPPKeyframeGrid accepts only bounded grids suitable for adaptive HLS.
// Dense, very long, or incomplete grids keep the existing fixed-GOP path.
func NewRKMPPKeyframeGrid(segments []Segment, fps int) *RKMPPKeyframeGrid {
	if len(segments) < 2 || fps < 1 || fps > 240 {
		return nil
	}
	end, bytes := 0.0, 0
	for _, s := range segments {
		if math.IsNaN(s.Start) || math.IsInf(s.Start, 0) || math.IsNaN(s.Duration) || math.IsInf(s.Duration, 0) ||
			math.Abs(s.Start-end) > 0.0001 || s.Duration <= 0 || s.Duration > 6.0001 {
			return nil
		}
		end = s.Start + s.Duration
		bytes += len(strconv.FormatFloat(math.Max(0, s.Start-rkmppKeyframeEpsilon), 'f', 9, 64)) + 1
		if bytes > 64*1024 {
			return nil
		}
	}
	if float64(len(segments)-2) > end*4 {
		return nil
	}
	return &RKMPPKeyframeGrid{Segments: slices.Clone(segments), GOPSize: int(math.Ceil(end*float64(fps))) + fps}
}

func (g *RKMPPKeyframeGrid) forceTimes(start float64) string {
	times := make([]string, 0, len(g.Segments))
	for _, s := range g.Segments {
		if s.Start >= start-rkmppKeyframeEpsilon {
			// ffprobe rounds to microseconds. Rounding upward must not move
			// an IDR to the following frame or create a one-frame head segment.
			times = append(times, strconv.FormatFloat(math.Max(0, s.Start-rkmppKeyframeEpsilon), 'f', 9, 64))
		}
	}
	return strings.Join(times, ",")
}

// Open-GOP leading pictures need the preceding random-access point. Seeking
// to their presentation time can land on the following CRA by decode time and
// silently discard those pictures. Trim still uses the requested StartAt.
func (g *RKMPPKeyframeGrid) decodeStart(start float64) float64 {
	for i, s := range g.Segments {
		if math.Abs(s.Start-start) < rkmppKeyframeEpsilon && s.KeyframeAt != 0 && i > 0 {
			previous := g.Segments[i-1]
			if previous.KeyframeAt != 0 {
				return previous.KeyframeAt
			}
			return previous.Start
		}
	}
	return start
}
