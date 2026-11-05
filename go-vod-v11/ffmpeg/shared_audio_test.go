package ffmpeg

import (
	"strings"
	"testing"
)

// TestSharedAudioArgsAreAudioOnly checks that an AudioOnly spec produces an
// audio-only ffmpeg command: no -c:v, no -vf, yes -c:a aac, yes -vn.
func TestSharedAudioArgsAreAudioOnly(t *testing.T) {
	s := Spec{
		RKMPP:     true,
		AudioOnly: true,
		Audio:     AudioInfo{CodecName: "eac3", Channels: 6, SampleRate: 48000, BitRate: 384000},
		StartAt:   0,
		EndAt:     120,
		Input:     "/tmp/test.mp4",
		ChunkSize: 4,
	}
	args := BuildArgs(s)
	joined := strings.Join(args, " ")

	for _, want := range []string{"-vn", "-c:a", "aac", "-ac", "2", "-ar", "48000", "-b:a", "192000", "-af"} {
		if !strings.Contains(joined, want) {
			t.Errorf("missing %q in audio-only args: %s", want, joined)
		}
	}
	for _, ban := range []string{"-c:v", "-vf", "h264_rkmpp", "hevc_rkmpp"} {
		if strings.Contains(joined, ban) {
			t.Errorf("unexpected %q in audio-only args: %s", ban, joined)
		}
	}
}

func TestSharedCopiedAACDoesNotPublishNegativePriming(t *testing.T) {
	s := Spec{RKMPP: true, HLS: true, AudioOnly: true, EndAt: 12,
		Audio: AudioInfo{CodecName: "aac", Profile: "LC", Channels: 2,
			SampleRate: 48000, BitRate: 160000, DurationSeconds: 12}}
	args := BuildArgs(s)
	assertHasPair(t, args, "-c:a", "copy")
	assertHasPair(t, args, "-bsf:a", "noise=amount=0:drop='lt(pts,0)'")
}

// TestSharedAudioArgsContainApad checks the apad filter is inserted when
// EndAt > StartAt, keeping audio duration equal to video duration.
func TestSharedAudioArgsContainApad(t *testing.T) {
	s := Spec{
		RKMPP:     true,
		AudioOnly: true,
		Audio:     AudioInfo{CodecName: "pcm_s16le", Channels: 2, SampleRate: 48000, BitRate: 1536000},
		StartAt:   10,
		EndAt:     120,
		Input:     "/tmp/test.mp4",
		ChunkSize: 4,
	}
	args := BuildArgs(s)
	joined := strings.Join(args, " ")

	if !strings.Contains(joined, "apad") {
		t.Errorf("apad missing from shared audio args with EndAt>StartAt: %s", joined)
	}
	if !strings.Contains(joined, "asetpts") {
		t.Errorf("asetpts missing from shared audio args: %s", joined)
	}
	if !strings.Contains(joined, "aresample") {
		t.Errorf("aresample missing from shared audio args: %s", joined)
	}
}

// TestSharedAudioVideoJobsMuteAudio confirms that a video-rendition spec with
// SeparateAudio=true appends -an and no audio encoder flags.
func TestSharedAudioVideoJobsMuteAudio(t *testing.T) {
	s := Spec{
		RKMPP:            true,
		RKMPPOutputCodec: "h264",
		SeparateAudio:    true,
		Audio:            AudioInfo{CodecName: "eac3", Channels: 6, SampleRate: 48000, BitRate: 384000},
		Quality:          "720p",
		Width:            1280,
		Height:           720,
		Bitrate:          2000000,
		ChunkSize:        4,
		Input:            "/tmp/test.mp4",
		CodecName:        "h264",
	}
	args := BuildArgs(s)
	joined := strings.Join(args, " ")

	if !strings.Contains(joined, "-an") {
		t.Errorf("expected -an in video args with SeparateAudio=true: %s", joined)
	}
	for _, ban := range []string{"-c:a", "-b:a", "-ac", "-ar"} {
		if strings.Contains(joined, ban) {
			t.Errorf("unexpected audio flag %q when SeparateAudio=true: %s", ban, joined)
		}
	}
}

// Compatible AAC can keep its source packets in the shared high track.
func TestSharedAudioCopyableAACDoesNotNeedNormalization(t *testing.T) {
	lcAudio := AudioInfo{
		CodecName:  "aac",
		Profile:    "LC",
		Channels:   2,
		SampleRate: 48000,
		BitRate:    128000,
	}
	if NormalizeRKMPPAudio(lcAudio) {
		t.Error("compatible AAC-LC can retain source packets")
	}
}

func TestSharedAudioProfilesUseTheSameSeekClock(t *testing.T) {
	for _, rate := range []int{192000, 96000, 64000, 32000} {
		s := Spec{AudioOnly: true, HLS: true, StartAt: 9, EndAt: 120, AudioBitrate: rate,
			Audio: AudioInfo{CodecName: "pcm_s16le", Channels: 2, SampleRate: 48000}, Input: "/tmp/source.mkv"}
		args := strings.Join(BuildArgs(s), " ")
		if !strings.Contains(args, "noise=amount=0:drop='lt(pts,432128)'") {
			t.Errorf("profile %d does not discard AAC preroll before the requested frame: %s", rate, args)
		}
	}
}

// TestSharedAudioNonAACNeedsNormalization confirms multi-channel non-AAC
// requires a separate normalized audio stream.
func TestSharedAudioNonAACNeedsNormalization(t *testing.T) {
	for _, audio := range []AudioInfo{
		{CodecName: "eac3", Channels: 6, SampleRate: 48000, BitRate: 384000},
		{CodecName: "dts", Channels: 6, SampleRate: 48000, BitRate: 1536000},
		{CodecName: "aac", Profile: "HE-AAC", Channels: 2, SampleRate: 48000, BitRate: 64000},
		{CodecName: "aac", Profile: "LC", Channels: 6, SampleRate: 48000, BitRate: 384000},
	} {
		if !NormalizeRKMPPAudio(audio) {
			t.Errorf("NormalizeRKMPPAudio should be true for %+v", audio)
		}
	}
}

// TestSharedAudioSegmentArgsUseFMP4 ensures the audio-only stream goes
// through SegmentArgs and comes out with fMP4 muxer flags.
func TestSharedAudioSegmentArgsUseFMP4(t *testing.T) {
	s := Spec{
		RKMPP:     true,
		AudioOnly: true,
		Audio:     AudioInfo{CodecName: "eac3", Channels: 6, SampleRate: 48000, BitRate: 384000},
		StartAt:   0,
		EndAt:     120,
		Input:     "/tmp/test.mp4",
		ChunkSize: 4,
		HLS:       true,
	}
	args := SegmentArgs(s, 0, "/tmp/audio-%06d.m4s", "/tmp/audio-init-1.m4s")
	joined := strings.Join(args, " ")

	for _, want := range []string{
		"-f", "hls",
		"-hls_segment_type", "fmp4",
		"-hls_fmp4_init_filename",
		"audio-init-1.m4s",
		"audio-%06d.m4s",
	} {
		if !strings.Contains(joined, want) {
			t.Errorf("missing %q in audio SegmentArgs: %s", want, joined)
		}
	}
	// -fps_mode and -bf must NOT appear for audio-only
	for _, ban := range []string{"-fps_mode", "-bf", "-g ", "-keyint_min"} {
		if strings.Contains(joined, ban) {
			t.Errorf("unexpected video flag %q in audio-only SegmentArgs: %s", ban, joined)
		}
	}
}
