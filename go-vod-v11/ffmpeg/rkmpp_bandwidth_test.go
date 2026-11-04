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

