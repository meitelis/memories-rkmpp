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

func buildRKMPPArgs(s Spec) []string {
	s.Rotation = NormalizeRotation(s.Rotation)
	args := []string{"-hide_banner", "-loglevel", "warning"}
	seek := s.HLS && s.StartAt > 0
	if s.StartAt > 0 {
		args = append(args, "-ss", fmt.Sprintf("%.6f", s.StartAt))
	}
	if seek {
		args = append(args, "-noaccurate_seek")
	}
	hw := usesRKMPPFrames(s)
	tonemap := hw && s.HDR && s.RKMPPOpenCL
	if tonemap {
		args = append(args,
			"-init_hw_device", "rkmpp=memories",
			"-init_hw_device", "opencl=memories_opencl@memories",
			"-filter_hw_device", "memories_opencl",
		)
	}
	if hw {
		args = append(args, "-hwaccel", "rkmpp", "-hwaccel_output_format", "drm_prime")
	}
	if s.Rotation != 0 {
		args = append(args, "-noautorotate")
	}
	if s.Headers != "" {
		args = append(args, "-multiple_requests", "1", "-seekable", "1")
		args = append(args, reconnectArgs()...)
		args = append(args, "-headers", s.Headers)
	}
	args = append(args, "-i", s.Input, "-copyts", "-fflags", "+genpts")
	filters := []string{fmt.Sprintf("fps=fps=%d:round=near", RKMPPFrameRate(s))}
	if seek {
		filters = append(filters, fmt.Sprintf("trim=start=%.6f", s.StartAt))
	}
	dims := ""
	if s.Width > 0 && s.Height > 0 {
		dims = fmt.Sprintf(":w=%d:h=%d", s.Width, s.Height)
	}
	if hw {
		format := "nv12"
		if tonemap {
			format = "p010"
		}
		filters = append(filters, "scale_rkrga=force_divisible_by=2:format="+format+dims)
		if tonemap {
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
			filters = append(filters, "zscale=t=linear:npl=100", "format=gbrpf32le", "zscale=p=bt709", "tonemap=hable:desat=0", "zscale=t=bt709:m=bt709:range=tv")
		}
		filters = append(filters, "format=nv12")
	}
	transpose := ""
	switch s.Rotation {
	case 90:
		transpose = "2"
	case -90:
		transpose = "1"
	case 180, -180:
		transpose = "4"
	}
	if transpose != "" {
		if hw {
			filters = append(filters, "vpp_rkrga=transpose="+transpose)
		} else if transpose == "4" {
			filters = append(filters, "transpose=1", "transpose=1")
		} else {
			filters = append(filters, "transpose="+transpose)
		}
	}
	// RGA transpose can leave an invalid SAR (1/0). Square pixels match the
	// dimensions advertised by our rendition ladder.
	filters = append(filters, "setsar=1")
	args = append(args, "-vf", strings.Join(filters, ","), "-map", "0:v:0", "-c:v", Encoder(s))
	if s.OutputCodec == "hevc" {
		level := HEVCLevel(s.Width, s.Height, RKMPPFrameRate(s))
		args = append(args, "-profile:v", "main", "-tier", "main", "-level:v", level.Name, "-tag:v", "hvc1")
	}
	if s.HDR {
		args = append(args, "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv")
	}
	qp := s.QF
	if qp <= 0 || qp > 51 {
		qp = 24
	}
	if s.HLS && s.Bitrate > 0 {
		audio := 0
		if s.Audio.CodecName != "" {
			audio = 128000
		}
		rate := max(128000, s.Bitrate*9/10-audio)
		args = append(args, "-rc_mode", "VBR", "-b:v", strconv.Itoa(rate), "-maxrate", strconv.Itoa(rate), "-bufsize", strconv.Itoa(rate*2), "-qp_init", strconv.Itoa(qp))
	} else {
		args = append(args, "-rc_mode", "CQP", "-qp_init", strconv.Itoa(qp))
	}
	args = append(args, "-fps_mode", "passthrough")
	if s.Audio.CodecName != "" {
		af := "aresample=async=1"
		if seek {
			af = fmt.Sprintf("atrim=start=%.6f,", s.StartAt) + af
		}
		args = append(args, "-map", "0:a:0?", "-c:a", "aac", "-ac", "2", "-ar", "48000", "-b:a", "128k", "-af", af)
	} else {
		args = append(args, "-an")
	}
	return args
}
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
	if !s.RKMPP || (s.HDR && !s.RKMPPOpenCL) || s.BitDepth > 10 || (s.ForceSwTranspose && s.Rotation != 0) {
		return false
	}
	// The video decoders support 4:2:0; MJPEG also supports other chroma layouts.
	// Keep unsupported profiles on CPU decode while retaining MPP encoding.
	if s.CodecName != "mjpeg" && s.PixelFormat != "" &&
		!strings.HasPrefix(s.PixelFormat, "yuv420p") && s.PixelFormat != "yuvj420p" &&
		s.PixelFormat != "nv12" && s.PixelFormat != "nv15" && !strings.HasPrefix(s.PixelFormat, "p010") {
		return false
	}
	return slices.Contains([]string{"h264", "hevc", "vp8", "vp9", "av1", "h263", "mpeg1video", "mpeg2video", "mpeg4", "mjpeg"}, s.CodecName)
}
