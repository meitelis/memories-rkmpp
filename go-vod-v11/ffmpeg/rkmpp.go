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

// RKMPPFrameRate returns a stable integer GOP cadence without guessing
// an unsupported high frame rate.
func RKMPPFrameRate(s Spec) int {
	if s.FrameRate <= 0 || s.FrameRate > 240 {
		return 30
	}
	return s.FrameRate
}

func usesRKMPPFrames(s Spec) bool {
	if !s.RKMPP || (s.HDR && !s.RKMPPOpenCL) || s.BitDepth > 10 ||
		(s.ForceSwTranspose && s.Rotation != 0) {
		return false
	}
	if s.CodecName != "mjpeg" && s.PixelFormat != "" &&
		!strings.HasPrefix(s.PixelFormat, "yuv420p") && s.PixelFormat != "yuvj420p" &&
		s.PixelFormat != "nv12" && s.PixelFormat != "nv15" && !strings.HasPrefix(s.PixelFormat, "p010") {
		return false
	}
	return slices.Contains([]string{
		"h264", "hevc", "vp8", "vp9", "av1", "h263", "mpeg1video",
		"mpeg2video", "mpeg4", "mjpeg",
	}, s.CodecName)
}

// Build the v11 encoder prefix only; SegmentArgs remains the official
// go-vod 0.7.0 fMP4 muxer, so init and timeline semantics are unchanged.
// This path is not enabled by the v11 server until runtime integration,
// hardware probing and real-device tests have been added.
func buildRKMPPArgs(s Spec) []string {
	args := []string{"-hide_banner", "-loglevel", "warning"}
	if s.StartAt > 0 {
		args = append(args, "-ss", fmt.Sprintf("%.6f", s.StartAt))
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
	rotation := ((s.Rotation % 360) + 360) % 360
	if rotation != 0 {
		args = append(args, "-noautorotate")
	}
	args = append(args, remoteInputArgs(s.Headers)...)
	args = append(args, "-i", s.Input, "-copyts", "-fflags", "+genpts")

	filters := []string{fmt.Sprintf("fps=fps=%d:round=near", RKMPPFrameRate(s))}
	if s.HLS && s.StartAt > 0 {
		filters = append(filters, fmt.Sprintf("trim=start=%.6f", s.StartAt))
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
			filters = append(filters,
				"hwmap=derive_device=opencl:mode=read",
				"tonemap_opencl=tonemap=hable:desat=0:format=nv12:primaries=bt709:transfer=bt709:matrix=bt709:range=tv",
				"hwmap=derive_device=rkmpp:mode=write:reverse=1",
				"format=drm_prime",
			)
		}
	} else {
		filters = append(filters, "scale=force_divisible_by=2"+dims)
		if s.HDR {
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
	case 270:
		transpose = "1"
	case 180:
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
		args = append(args, "-profile:v", "main", "-tier", "main", "-tag:v", "hvc1")
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
		audioRate := 0
		if s.Audio.CodecName != "" {
			audioRate = 128000
			if s.Audio.CodecName == "aac" && s.Audio.Channels >= 1 && s.Audio.Channels <= 2 && s.Audio.BitRate > 0 {
				audioRate = s.Audio.BitRate
			}
		}
		videoRate := max(128000, s.Bitrate*9/10-audioRate)
		args = append(args, "-rc_mode", "VBR", "-b:v", strconv.Itoa(videoRate),
			"-maxrate", strconv.Itoa(videoRate), "-bufsize", strconv.Itoa(videoRate*2),
			"-qp_init", strconv.Itoa(qp))
	} else {
		args = append(args, "-rc_mode", "CQP", "-qp_init", strconv.Itoa(qp))
	}
	if s.Audio.CodecName != "" {
		args = append(args, "-map", "0:a:0?")
		if s.Audio.CodecName == "aac" && s.Audio.Channels >= 1 && s.Audio.Channels <= 2 {
			args = append(args, "-c:a", "copy")
			if s.HLS && s.StartAt > 0 {
				args = append(args, "-copypriorss:a", "0")
			}
		} else {
			args = append(args, "-c:a", "aac", "-ac", "2", "-ar", "48000", "-b:a", "128k")
			if s.HLS && s.StartAt > 0 {
				args = append(args, "-af", fmt.Sprintf("atrim=start=%.6f,aresample=async=1", s.StartAt))
			}
		}
	} else {
		args = append(args, "-an")
	}
	return args
}

// The initial bitrate estimate is a policy floor, not an encoder guarantee.
// Leave an audio/muxing allowance when choosing the lowest rendition.
func RKMPPMinBitrate(audio AudioInfo) int {
	audioRate := 0
	if audio.CodecName != "" {
		audioRate = 128000
		if audio.CodecName == "aac" && audio.Channels >= 1 && audio.Channels <= 2 && audio.BitRate > 0 {
			audioRate = int(math.Min(float64(audio.BitRate), 256000))
		}
	}
	return (128000 + audioRate) * 10 / 9
}
