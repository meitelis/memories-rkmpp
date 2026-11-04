package ffmpeg

import "testing"

// TestRKMPPMinBitrateCoversAudio checks that RKMPPMinBitrate accounts for
// the audio track overhead, so low-resolution renditions are still advertised
// with enough bandwidth to include both the video floor and the audio.
func TestRKMPPMinBitrateCoversAudio(t *testing.T) {
	for _, tc := range []struct {
		name    string
		audio   AudioInfo
		wantMin int // must be strictly above audio-only
	}{
		{
			name:    "no audio",
			audio:   AudioInfo{},
			wantMin: 128000, // just video floor * headroom
		},
		{
			name:    "copyable AAC-LC 128k",
			audio:   AudioInfo{CodecName: "aac", Profile: "LC", Channels: 2, SampleRate: 48000, BitRate: 128000},
			wantMin: 128000 + 128000, // video floor + audio
		},
		{
			name:    "normalized multi-channel (128k encoded)",
			audio:   AudioInfo{CodecName: "eac3", Channels: 6, SampleRate: 48000, BitRate: 384000},
			wantMin: 128000 + 128000, // video floor + 128k normalized
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := RKMPPMinBitrate(tc.audio)
			// The formula is ((128k + audioBitrate) * 10 + 8) / 9.
			// At minimum both terms must be represented.
			audioPart := rkmppAudioBitrate(tc.audio)
			plain := 128000 + audioPart
			if got <= 0 {
				t.Errorf("RKMPPMinBitrate(%+v) = %d, want > 0", tc.audio, got)
			}
			// The result must be >= the plain sum (10/9 mux headroom applied).
			if got < plain {
				t.Errorf("RKMPPMinBitrate(%+v) = %d, want >= %d", tc.audio, got, plain)
			}
		})
	}
}

// TestRKMPPMinBitrateIsStableForSilent ensures silent videos don't panic
// and return a sensible positive floor.
func TestRKMPPMinBitrateIsStableForSilent(t *testing.T) {
	got := RKMPPMinBitrate(AudioInfo{})
	if got <= 0 {
		t.Errorf("RKMPPMinBitrate(silent) = %d, want > 0", got)
	}
}

// TestBalancedRKMPPBitrateScalesWithResolution checks that larger resolutions
// get higher bitrate allocations, and that the floor of 256kbps is respected.
func TestBalancedRKMPPBitrateScalesWithResolution(t *testing.T) {
	b480 := balancedRKMPPBitrateExport(854, 480, 30)
	b720 := balancedRKMPPBitrateExport(1280, 720, 30)
	b1080 := balancedRKMPPBitrateExport(1920, 1080, 30)
	b4k := balancedRKMPPBitrateExport(3840, 2160, 30)

	if b480 <= 0 {
		t.Errorf("480p bitrate = %d, want > 0", b480)
	}
	if b720 <= b480 {
		t.Errorf("720p %d should exceed 480p %d", b720, b480)
	}
	if b1080 <= b720 {
		t.Errorf("1080p %d should exceed 720p %d", b1080, b720)
	}
	if b4k <= b1080 {
		t.Errorf("4K %d should exceed 1080p %d", b4k, b1080)
	}

	// Floor: even a 1x1 must yield >= 256k
	floor := balancedRKMPPBitrateExport(2, 2, 30)
	if floor < 256000 {
		t.Errorf("floor bitrate = %d, want >= 256000", floor)
	}
}

// TestBalancedRKMPPBitrateScalesWithFPS checks higher FPS yields higher budget.
func TestBalancedRKMPPBitrateScalesWithFPS(t *testing.T) {
	b30 := balancedRKMPPBitrateExport(1920, 1080, 30)
	b60 := balancedRKMPPBitrateExport(1920, 1080, 60)
	if b60 <= b30 {
		t.Errorf("60fps %d should exceed 30fps %d for 1080p", b60, b30)
	}
}

// balancedRKMPPBitrateExport exposes the unexported helper for unit testing
// within the same package.
func balancedRKMPPBitrateExport(width, height, fps int) int {
	return balancedRKMPPBitrate(width, height, fps)
}
