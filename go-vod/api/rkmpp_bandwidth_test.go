package api

import (
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/pulsejet/memories/go-vod/config"
	"github.com/pulsejet/memories/go-vod/core"
	"github.com/pulsejet/memories/go-vod/ffmpeg"
	"github.com/stretchr/testify/require"
)

func TestRKMPPMasterBandwidthCoversCopiedAudioOnSmallAndScaledRenditions(t *testing.T) {
	for _, size := range [][2]int{{320, 240}, {1920, 1080}} {
		for _, codec := range []string{"h264", "hevc"} {
			t.Run(fmt.Sprintf("%dx%d/%s", size[0], size[1], codec), func(t *testing.T) {
				cfg := config.Defaults("test")
				cfg.RKMPP, cfg.RKMPPOutputCodec = true, codec
				cfg.TempDir = t.TempDir()
				t.Setenv("CACHE_DIR", t.TempDir())
				audio := ffmpeg.AudioInfo{CodecName: "aac", Profile: "LC", Channels: 2, SampleRate: 48000, BitRate: 256000}
				probe := &core.ProbeVideoData{Width: size[0], Height: size[1], Duration: 12 * time.Second,
					FrameRate: 30, FrameRateExact: 30, CodecName: "hevc", BitRate: 384000, Audio: audio}
				require.NoError(t, core.StoreCachedProbe(cfg.CacheDir(), 7, "bandwidth-fixture", probe))
				m, err := core.NewManager(core.NewManagerArgs{C: cfg, ManagerParams: core.ManagerParams{
					StreamID: "bandwidth", URL: "http://unused.invalid/fixture", FileID: 7, Etag: "bandwidth-fixture",
					PlayableCodecs: []string{codec}, TConfig: config.TCfg{ChunkSize: 3}}, Idle: make(chan core.IdleEvent, 1)})
				require.NoError(t, err)
				t.Cleanup(m.Destroy)
				renditions := m.Renditions()
				require.True(t, m.HasStream(core.QUALITY_MAX))
				master, err := MasterPlaylist(renditions, m.FrameRate(), "")
				require.NoError(t, err)
				for _, rendition := range renditions {
					require.GreaterOrEqual(t, rendition.Bitrate, 426667)
					args := ffmpeg.BuildArgs(ffmpeg.Spec{RKMPP: true, HLS: true, Bitrate: rendition.Bitrate,
						Width: rendition.Width, Height: rendition.Height, Audio: audio, OutputCodec: codec})
					videoRate, err := strconv.Atoi(args[slices.Index(args, "-b:v")+1])
					require.NoError(t, err)
					pattern := `BANDWIDTH=(\d+)[^\n]*\n` + regexp.QuoteMeta(rendition.Quality+".m3u8")
					match := regexp.MustCompile(pattern).FindStringSubmatch(master)
					require.Len(t, match, 2)
					advertised, err := strconv.Atoi(match[1])
					require.NoError(t, err)
					require.GreaterOrEqual(t, advertised*9/10, videoRate+256000)
					require.Contains(t, strings.Join(args, " "), "-c:a copy")
				}
			})
		}
	}
}
