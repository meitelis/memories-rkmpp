package ffmpeg

import "fmt"

// HEVCLevelInfo describes a Main-tier level. Explicit encoder levels keep
// the RFC 6381 playlist declaration consistent with the generated bitstream.
type HEVCLevelInfo struct {
	Name string
	IDC  int
}

// HEVCLevel selects the lowest level covering the output picture and sample
// rate (ITU-T H.265, Table A.8). Bitrate is already capped by the RKMPP ladder.
func HEVCLevel(width, height, fps int) HEVCLevelInfo {
	picture := int64(width) * int64(height)
	rate := picture * int64(max(1, fps))
	for _, level := range []struct {
		name          string
		idc           int
		picture, rate int64
	}{
		{"3.1", 93, 983040, 33177600},
		{"4", 120, 2228224, 66846720},
		{"4.1", 123, 2228224, 133693440},
		{"5", 150, 8912896, 267386880},
		{"5.1", 153, 8912896, 534773760},
		{"5.2", 156, 8912896, 1069547520},
		{"6", 180, 35651584, 1069547520},
		{"6.1", 183, 35651584, 2139095040},
		{"6.2", 186, 35651584, 4278190080},
	} {
		if picture <= level.picture && rate <= level.rate {
			return HEVCLevelInfo{level.name, level.idc}
		}
	}
	return HEVCLevelInfo{"6.2", 186}
}

// HEVCCodecs matches RKMPP's 8-bit Main profile, compatibility flags 6,
// progressive constraint flag 80, and the explicit level used by the encoder.
func HEVCCodecs(width, height, fps int, audio bool) string {
	codecs := fmt.Sprintf("hvc1.1.6.L%d.80", HEVCLevel(width, height, fps).IDC)
	if audio {
		codecs += ",mp4a.40.2"
	}
	return codecs
}
