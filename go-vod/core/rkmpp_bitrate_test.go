package core

import "testing"

// Bitrate allocation is a manager policy, not an FFmpeg argument-builder API.
func TestBalancedRKMPPBitrateScalesWithResolution(t *testing.T) {
	b480 := balancedRKMPPBitrate(854, 480, 30)
	b720 := balancedRKMPPBitrate(1280, 720, 30)
	b1080 := balancedRKMPPBitrate(1920, 1080, 30)
	b4k := balancedRKMPPBitrate(3840, 2160, 30)
	if !(b480 < b720 && b720 < b1080 && b1080 < b4k) {
		t.Errorf("bitrate should increase with resolution: 480p=%d 720p=%d 1080p=%d 4K=%d", b480, b720, b1080, b4k)
	}
	if got := balancedRKMPPBitrate(2, 2, 30); got < 256000 {
		t.Errorf("bitrate floor = %d, want >= 256000", got)
	}
}

func TestBalancedRKMPPBitrateScalesWithFPS(t *testing.T) {
	b30 := balancedRKMPPBitrate(1920, 1080, 30)
	b60 := balancedRKMPPBitrate(1920, 1080, 60)
	if b60 <= b30 {
		t.Errorf("1080p at 60fps (%d) should exceed 30fps (%d)", b60, b30)
	}
}
