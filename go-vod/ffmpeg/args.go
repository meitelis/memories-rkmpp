package ffmpeg

import (
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
)

// Spec describes one transcode job: which input to read, which rendition to
// produce and which encoder backend to use. It is a flat bag of plain values
// (no live server state), so argument building stays pure: the same Spec
// always yields the same argv, reviewable and testable without binaries.
//
// The zero value selects software x264. Encoder precedence is copy,
// RKMPP, VAAPI, NVENC, then x264.
type Spec struct {
	// Bin is the ffmpeg executable. Informational only (callers prepend it
	// via exec.Command); kept so tests render complete command lines.
	Bin string
	// Input is the Nextcloud file URL handed to "-i".
	Input string
	// Headers is the ffmpeg "-headers" block.
	Headers string

	// StartAt seeks before decoding; <= 0 emits no "-ss".
	StartAt float64
	// HLS marks segment output (vs progressive file).
	HLS bool

	// Quality is the rendition label ("480p", …, QualityMax). Anything but
	// QualityMax enables the downscale filter.
	Quality string
	// Width is always the larger source dimension, scaled proportionally
	// (callers swap axes for portrait sources).
	Width, Height int
	// QF is the quality factor: CRF (x264), global_quality (VA-API), CQ (NVENC).
	QF             int
	RKMPP          bool
	Bitrate        int
	CodecName      string
	FrameRateExact float64
	PixelFormat    string
	// FrameRate is the integer source fps. Only sizes the
	// GOP when UseGopSize is set.
	FrameRate int
	// Rotation is the probed source rotation (-90, 90, ±180, 0), applied as
	// an explicit transpose filter when UseTranspose is set.
	Rotation int
	// HDR marks sources needing SDR tonemapping.
	HDR bool
	// BitDepth is the source sample depth, 8 when unknown.
	BitDepth int
	// Audio is the first audio stream; empty when silent.
	Audio AudioInfo
	// ChunkSize is the target segment length in whole seconds. Drives
	// -hls_time and the forced-keyframe interval.
	ChunkSize int

	// VAAPI selects h264_vaapi on VAAPIDevice; VAAPILowPower adds
	// "-low_power 1" for fixed-function encode blocks.
	VAAPI, VAAPILowPower bool
	// VAAPIDevice is the VA-API render node; empty selects /dev/dri/renderD128.
	VAAPIDevice string
	// VAAPIOpenCL enables GPU HDR tonemapping after a successful interop probe.
	VAAPIOpenCL bool
	// NVENC selects h264_nvenc with CUDA offload. NVENCScale picks the scaler
	// ("cuda" or "npp"); NVENCTemporalAQ enables temporal AQ.
	NVENC, NVENCTemporalAQ bool
	NVENCScale             string

	// UseTranspose disables ffmpeg autorotation (-noautorotate) and rotates
	// manually instead. Autorotation fails silently on some hardware paths
	// and never applies to HLS segments; see
	// https://trac.ffmpeg.org/ticket/8329.
	UseTranspose bool
	// ForceSwTranspose rotates on the CPU (hwdownload → transpose → hwupload)
	// to dodge broken hardware transpose filters. Always on for
	// transpose_cuda, which is not trusted at all.
	ForceSwTranspose bool
	// UseGopSize uses a fixed GOP (ChunkSize*FrameRate) instead of forced
	// keyframes, for encoders whose forced keyframes drift (notably NVENC).
	UseGopSize bool
	// Copy stream-copies the video (-c:v copy) instead of re-encoding it,
	// for copy-eligible sources.
	Copy bool
}

// Encoder resolves the video encoder: stream copy, then RKMPP, VAAPI,
// NVENC, then software x264. The only other stream-copy fast path (original h264
// served as-is for progressive download) bypasses argument building entirely.
