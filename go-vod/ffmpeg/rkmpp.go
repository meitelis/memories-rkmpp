package ffmpeg

import (
	"fmt"
	"math"
	"slices"
	"strconv"
	"strings"
)

const (
	EncoderRKMPP     = "h264_rkmpp"
	EncoderRKMPPHEVC = "hevc_rkmpp"
)

func IsRKMPPEncoder(encoder string) bool {
	return encoder == EncoderRKMPP || encoder == EncoderRKMPPHEVC
}

// Keep one source packet clock across adaptive renditions when the original
// audio already matches the supported AAC-LC configuration. Unknown profiles
// and bitrates retain normalization rather than guessing compatibility/budget.
func copyRKMPPAudio(audio AudioInfo) bool {
	return strings.EqualFold(audio.CodecName, "aac") && strings.EqualFold(audio.Profile, "LC") &&
		(audio.Channels == 1 || audio.Channels == 2) && (audio.SampleRate == 44100 || audio.SampleRate == 48000) &&
		audio.BitRate > 0 && audio.BitRate <= 320000
}

func NormalizeRKMPPAudio(audio AudioInfo) bool {
	return audio.CodecName != "" && !copyRKMPPAudio(audio)
}

// One audio encoder is shared by the HLS video qualities. It never opens a
// hardware video decoder or encoder, and uses the same source timestamp clock.
func buildRKMPPAudioArgs(s Spec) []string {
	args := []string{"-hide_banner", "-loglevel", "warning"}
	rate := s.AudioBitrate
	if rate <= 0 {
		rate = 192000
	}
	// A complete compatible AAC source can keep its original packets. It
	// still has one separate audio playlist shared by every video quality.
	if rate >= 192000 && copyRKMPPAudio(s.Audio) && s.Audio.SampleRate == 48000 && s.Audio.Channels == 2 &&
		s.Audio.DurationSeconds > 0 && s.Audio.DurationSeconds >= s.EndAt-0.03 {
		if s.StartAt > 0 {
			args = append(args, "-ss", fmt.Sprintf("%.9f", s.StartAt))
		}
		args = append(args, remoteInputArgs(s.Headers)...)
		args = append(args, "-i", s.Input, "-copyts", "-fflags", "+genpts", "-vn", "-map", "0:a:0", "-c:a", "copy")
		if s.HLS {
			// AAC priming can have negative DTS/PTS even when the MP4's
			// presentation starts at zero. tfdt is unsigned: retaining that
			// packet wraps browser audio timing and stalls after segment 0.
			// Drop preroll packets without decoding/re-encoding source audio.
			args = append(args, "-bsf:a", "noise=amount=0:drop='lt(pts,0)'")
		}
		if s.StartAt > 0 {
			args = append(args, "-copypriorss:a", "0")
		}
		if s.EndAt > s.StartAt {
			args = append(args, "-to", fmt.Sprintf("%.6f", s.EndAt))
		}
		return args
	}
	// AAC encodes 1024 samples per frame. Restart every profile on the same
	// global frame grid with one warm-up frame for the encoder delay, rather
	// than rebasing each cold seek on an arbitrary sample.
	start := 0.0
	if s.StartAt > 0 {
		start = max(0, (math.Floor(s.StartAt*48000/1024)-1)*1024/48000)
		args = append(args, "-ss", fmt.Sprintf("%.9f", start))
	}
	args = append(args, remoteInputArgs(s.Headers)...)
	filter := fmt.Sprintf("aresample=async=1:first_pts=%d", int64(math.Round(start*48000)))
	if remaining := s.EndAt - start; remaining > 0 {
		// A shorter audio source must not make HLS wait for nonexistent tail
		// fragments. Silence is cheap to encode and keeps the video playable.
		filter += fmt.Sprintf(",apad=whole_dur=%.6f", remaining)
	}
	filter += fmt.Sprintf(",asetpts=N/SR/TB+%.9f/TB", start)
	args = append(args, "-i", s.Input, "-copyts", "-fflags", "+genpts", "-vn", "-map", "0:a:0",
		"-c:a", "aac", "-ac", "2", "-ar", "48000", "-b:a", strconv.Itoa(rate), "-af", filter)
	if s.HLS {
		// Encode the preroll for a settled AAC window, but do not publish its
		// packets as the requested segment. Keep the first packet on the same
		// global 1024-sample clock as a run that started at zero.
		cut := int64(math.Ceil(s.StartAt*48000/1024)) * 1024
		args = append(args, "-bsf:a", fmt.Sprintf("noise=amount=0:drop='lt(pts,%d)'", cut))
	}
	if s.EndAt > s.StartAt {
		// copyts preserves absolute source timestamps, including on cold seeks.
		args = append(args, "-to", fmt.Sprintf("%.6f", s.EndAt))
	}
	return args
}

func rkmppAudioBitrate(audio AudioInfo) int {
	if audio.CodecName == "" {
		return 0
	}
	if copyRKMPPAudio(audio) {
		return max(192000, audio.BitRate)
	}
	return 192000
}

// RKMPPMinBitrate is the minimum advertised bandwidth for a hardware encode:
// the encoder's 128kbps video floor, the chosen audio, and muxing headroom.
// Stream-copy video does not use this allocation.
func RKMPPMinBitrate(audio AudioInfo) int {
	return ((128000+rkmppAudioBitrate(audio))*10 + 8) / 9
}

// RKMPPFrameRate returns a stable integer GOP cadence without guessing
// an unsupported high frame rate.
func RKMPPFrameRate(s Spec) int {
	fps := s.FrameRateExact
	if fps <= 0 || math.IsNaN(fps) || math.IsInf(fps, 0) {
		fps = float64(s.FrameRate)
	}
	if fps <= 0 || fps > 240 {
		return 30
	}
	return max(1, int(math.Round(fps)))
}

func usesRKMPPFrames(s Spec) bool {
	if !s.RKMPP || (s.HDR && !s.RKMPPOpenCL) || s.BitDepth > 10 ||
		(s.ForceSwTranspose && s.Rotation != 0) {
		return false
	}
	if s.CodecName != "mjpeg" && s.PixelFormat != "" &&
		!slices.Contains([]string{"yuv420p", "yuv420p10le", "yuvj420p", "nv12", "nv15", "p010le"}, s.PixelFormat) {
		return false
	}
	return slices.Contains([]string{
		"h264", "hevc", "vp8", "vp9", "av1", "h263", "mpeg1video",
		"mpeg2video", "mpeg4", "mjpeg",
	}, s.CodecName)
}

// SupportsRKMPPDecode checks source support independently of HDR mapping.
func SupportsRKMPPDecode(s Spec) bool {
	s.RKMPP, s.HDR = true, false
	return usesRKMPPFrames(s)
}

// RKMPPInputPaced keeps asynchronous hardware workers running while FFmpeg
// throttles input. Suspending the whole process can lose an in-flight frame.
func RKMPPInputPaced(s Spec) bool {
	return s.RKMPP && s.HLS && !s.Copy && !s.AudioOnly
}

// Build the v11 encoder prefix only; SegmentArgs remains the official
// go-vod 0.7.0 fMP4 muxer, so init and timeline semantics are unchanged.
// The v11 server enables it only when MEMORIES_RKMPP=1.
func buildRKMPPArgs(s Spec) []string {
	args := []string{"-hide_banner", "-loglevel", "warning"}
	decodeStart := s.StartAt
	if s.HLS && s.KeyframeGrid != nil {
		decodeStart = s.KeyframeGrid.decodeStart(s.StartAt)
	}
	if decodeStart > 0 {
		seek := fmt.Sprintf("%.6f", decodeStart)
		if s.HLS && s.KeyframeGrid != nil {
			// Seek just past rounded keyframe metadata, but retain that frame
			// with noaccurate_seek and the trim threshold below.
			seek = fmt.Sprintf("%.9f", decodeStart+10*rkmppKeyframeEpsilon)
		}
		args = append(args, "-ss", seek)
		if s.HLS {
			args = append(args, "-noaccurate_seek")
		}
	}
	hardwareFrames := usesRKMPPFrames(s)
	maliHDR := hardwareFrames && s.HDR && s.RKMPPOpenCL
	if maliHDR {
		args = append(args, "-init_hw_device", "rkmpp=memories",
			"-init_hw_device", "opencl=memories_opencl@memories",
			"-filter_hw_device", "memories_opencl")
	}
	if hardwareFrames {
		args = append(args, "-hwaccel", "rkmpp", "-hwaccel_output_format", "drm_prime")
	}
	rotation := NormalizeRotation(s.Rotation)
	if rotation != 0 {
		args = append(args, "-noautorotate")
	}
	args = append(args, remoteInputArgs(s.Headers)...)
	if RKMPPInputPaced(s) {
		// Produce faster than playback to refill a depleted buffer after a
		// producer/network delay without suspending async MPP workers.
		args = append(args, "-readrate", "1.5", "-readrate_initial_burst", "24", "-readrate_catchup", "3")
	}
	args = append(args, "-i", s.Input, "-copyts", "-fflags", "+genpts")

	filters := []string{}
	if s.KeyframeGrid == nil {
		filters = append(filters, fmt.Sprintf("fps=fps=%d:round=near", RKMPPFrameRate(s)))
	}
	if s.HLS && s.StartAt > 0 {
		trim := fmt.Sprintf("trim=start=%.6f", s.StartAt)
		if s.KeyframeGrid != nil {
			trim = fmt.Sprintf("trim=start=%.9f", max(0, s.StartAt-rkmppKeyframeEpsilon))
		}
		filters = append(filters, trim)
	}
	dims := ""
	if s.Width > 0 && s.Height > 0 {
		dims = fmt.Sprintf(":w=%d:h=%d", s.Width, s.Height)
	}
	if hardwareFrames {
		format := "nv12"
		if maliHDR {
			format = "p010"
		}
		filters = append(filters, "scale_rkrga=force_divisible_by=2:format="+format+dims)
		if maliHDR {
			filters = append(filters, "hwmap=derive_device=opencl:mode=read")
			filters = append(filters, rkmppSourceColor(s)...)
			filters = append(filters,
				"tonemap_opencl=tonemap=hable:desat=0:format=nv12:primaries=bt709:transfer=bt709:matrix=bt709:range=tv",
				"hwmap=derive_device=rkmpp:mode=write:reverse=1",
				"format=drm_prime",
			)
		}
	} else {
		filters = append(filters, "scale=force_divisible_by=2"+dims)
		if s.HDR {
			filters = append(filters, rkmppSourceColor(s)...)
			filters = append(filters,
				"zscale=t=linear:npl=100", "format=gbrpf32le", "zscale=p=bt709",
				"tonemap=hable:desat=0", "zscale=t=bt709:m=bt709:range=tv")
		}
		filters = append(filters, "format=nv12")
	}
	transpose := ""
	switch rotation {
	case 90:
		transpose = "2"
	case -90, 270:
		transpose = "1"
	case 180, -180:
		transpose = "4"
	}
	if transpose != "" {
		if hardwareFrames {
			filters = append(filters, "vpp_rkrga=transpose="+transpose)
		} else if transpose == "4" {
			filters = append(filters, "transpose=1", "transpose=1")
		} else {
			filters = append(filters, "transpose="+transpose)
		}
	}
	filters = append(filters, "setsar=1")
	args = append(args, "-vf", strings.Join(filters, ","), "-map", "0:v:0", "-c:v", Encoder(s))
	if s.RKMPPOutputCodec == "hevc" {
		level := HEVCLevel(s.Width, s.Height, RKMPPFrameRate(s))
		args = append(args, "-profile:v", "main", "-tier", "main", "-level:v", level.Name, "-tag:v", "hvc1")
	}
	if s.HDR {
		args = append(args, "-color_primaries", "bt709", "-color_trc", "bt709",
			"-colorspace", "bt709", "-color_range", "tv")
	}
	qp := s.QF
	if qp <= 0 || qp > 51 {
		qp = 24
	}
	if s.HLS && s.Bitrate > 0 {
		audioRate := rkmppAudioBitrate(s.Audio)
		videoRate := max(128000, s.Bitrate*9/10-audioRate)
		args = append(args, "-rc_mode", "VBR", "-b:v", strconv.Itoa(videoRate),
			"-maxrate", strconv.Itoa(videoRate), "-bufsize", strconv.Itoa(videoRate*2),
			"-qp_init", strconv.Itoa(qp))
	} else {
		args = append(args, "-rc_mode", "CQP", "-qp_init", strconv.Itoa(qp))
	}
	if s.Audio.CodecName != "" && !s.SeparateAudio {
		args = append(args, "-map", "0:a:0?")
		if copyRKMPPAudio(s.Audio) {
			args = append(args, "-c:a", "copy")
			if s.HLS && s.StartAt > 0 {
				args = append(args, "-copypriorss:a", "0")
			}
		} else {
			af := "aresample=async=1"
			if s.HLS && s.StartAt > 0 {
				af = fmt.Sprintf("atrim=start=%.6f,", s.StartAt) + af
			}
			args = append(args, "-c:a", "aac", "-ac", "2", "-ar", "48000", "-b:a", "128k", "-af", af)
		}
	} else {
		args = append(args, "-an")
	}
	return args
}

// setparams changes metadata only; it keeps the imported OpenCL surfaces on
// the GPU. Do not invent PQ/HLG tags when the source does not identify them.
func rkmppSourceColor(s Spec) []string {
	var tags []string
	for _, field := range []struct{ key, value string }{
		{"color_trc", s.ColorTransfer}, {"color_primaries", s.ColorPrimaries},
		{"colorspace", s.ColorSpace}, {"range", s.ColorRange},
	} {
		if field.value != "" && field.value != "unknown" && field.value != "unspecified" {
			tags = append(tags, field.key+"="+field.value)
		}
	}
	if len(tags) == 0 {
		return nil
	}
	return []string{"setparams=" + strings.Join(tags, ":")}
}
