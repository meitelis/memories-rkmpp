package api

import (
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/pulsejet/memories/go-vod/config"
	"github.com/pulsejet/memories/go-vod/core"
	"github.com/pulsejet/memories/go-vod/ffmpeg"
	"github.com/stretchr/testify/require"
)

func TestMasterPlaylist(t *testing.T) {
	got, err := MasterPlaylist([]core.Rendition{
		{Quality: "1080p", Width: 1920, Height: 1080, Bitrate: 1000},
		{Quality: "max", Width: 1920, Height: 1080, Bitrate: 5000000, Order: 1},
		{Quality: "480p", Width: 854, Height: 480, Bitrate: 400},
	}, 30, "?t=123")
	require.NoError(t, err)
	require.Less(t, strings.Index(got, "480p.m3u8"), strings.Index(got, "1080p.m3u8"))
	require.Less(t, strings.Index(got, "1080p.m3u8"), strings.Index(got, "max.m3u8"))
	require.Contains(t, got, "BANDWIDTH=400,RESOLUTION=854x480")
	require.Contains(t, got, "480p.m3u8?t=123")
	require.Contains(t, got, "#EXT-X-INDEPENDENT-SEGMENTS")
}

func TestCopyPlaylistPreservesFractionalBoundaries(t *testing.T) {
	// 4.133333 s GOPs lose a third of a second after 1000 segments when
	// rounded to milliseconds; exact grid starts must survive serialization.
	keys := make([]float64, 1000)
	for i := range keys {
		keys[i] = math.Round(float64(i)*124/30*1e6) / 1e6
	}
	end := keys[len(keys)-1] + 124.0/30
	segments := ffmpeg.CopySegments(keys, time.Duration(end*float64(time.Second)))
	text, err := CopyVariantPlaylist("direct", segments, "")
	require.NoError(t, err)
	var start float64
	var id int
	for _, line := range strings.Split(text, "\n") {
		if !strings.HasPrefix(line, "#EXTINF:") {
			continue
		}
		require.InDelta(t, segments[id].Start, start, 0.000001, "boundary %d", id)
		duration, err := strconv.ParseFloat(strings.SplitN(strings.TrimPrefix(line, "#EXTINF:"), ",", 2)[0], 64)
		require.NoError(t, err)
		start += duration
		id++
	}
	require.Equal(t, len(segments), id)
}

func TestTranscodeVariantPlaylist(t *testing.T) {
	got, err := TranscodeVariantPlaylist("720p", 62*time.Second+500*time.Millisecond, 3, "?t=123")
	require.NoError(t, err)
	require.Equal(t, 21, strings.Count(got, "#EXTINF"))
	require.Contains(t, got, "#EXTINF:2.500,nodesc\n720p-000020.m4s?t=123")
	require.Contains(t, got, "#EXT-X-TARGETDURATION:3")
	require.Contains(t, got, "#EXT-X-PLAYLIST-TYPE:VOD")
	require.Contains(t, got, "#EXT-X-VERSION:7")
	require.Contains(t, got, `#EXT-X-MAP:URI="720p-init.m4s?t=123"`)
	require.True(t, strings.HasSuffix(strings.TrimSpace(got), "#EXT-X-ENDLIST"))
}

func TestTranscodeVariantPlaylistEmpty(t *testing.T) {
	got, err := TranscodeVariantPlaylist("720p", 0, 3, "")
	require.NoError(t, err)
	require.NotContains(t, got, "#EXTINF")
	require.Contains(t, got, "#EXT-X-ENDLIST")
}

func TestCopyVariantPlaylist(t *testing.T) {
	got, err := CopyVariantPlaylist("direct", []ffmpeg.Segment{
		{Start: 0, Duration: 6},
		{Start: 6, Duration: 8.5},
		{Start: 14.5, Duration: 2.25},
	}, "?t=123")
	require.NoError(t, err)
	require.Equal(t, 3, strings.Count(got, "#EXTINF"))
	require.Contains(t, got, "6")
	require.Contains(t, got, "8.5")
	require.Contains(t, got, "2.25")
	require.Contains(t, got, "#EXT-X-TARGETDURATION:9")
	require.Contains(t, got, "direct-000000.m4s?t=123")
	require.Contains(t, got, "direct-000002.m4s?t=123")
	require.Contains(t, got, `#EXT-X-MAP:URI="direct-init.m4s?t=123"`)
	require.True(t, strings.HasSuffix(strings.TrimSpace(got), "#EXT-X-ENDLIST"))
}

func stubVariantManager(t *testing.T, keyFail bool, rkmpp ...bool) *core.Manager {
	t.Helper()
	dir := t.TempDir()
	probeJSON := `{"streams":[{"codec_type":"video","codec_name":"h264","width":1280,"height":720,"avg_frame_rate":"30/1","duration":"12","bit_rate":"1000000"}],"format":{}}`
	require.NoError(t, os.WriteFile(filepath.Join(dir, "out.json"), []byte(probeJSON), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "keys.txt"), []byte("0.000000,K__\n4.000000,K__\n8.000000,K__\n"), 0644))
	keyCmd := "cat " + filepath.Join(dir, "keys.txt") + "; exit 0"
	if keyFail {
		keyCmd = "echo boom >&2; exit 1"
	}
	script := "#!/bin/sh\nfor a in \"$@\"; do\n  if [ \"$a\" = \"packet=pts_time,flags\" ]; then\n    " +
		keyCmd + "\n  fi\ndone\ncat " + filepath.Join(dir, "out.json") + "\n"
	bin := filepath.Join(dir, "ffprobe")
	require.NoError(t, os.WriteFile(bin, []byte(script), 0755))

	cfg := config.Defaults("test")
	if len(rkmpp) > 0 && rkmpp[0] {
		cfg.RKMPP, cfg.RKMPPOutputCodec = true, "h264"
	}
	cfg.TempDir = t.TempDir()
	cfg.FFprobe = bin
	m, err := core.NewManager(core.NewManagerArgs{
		C: cfg,
		ManagerParams: core.ManagerParams{
			URL:      "http://localhost/input.mp4",
			StreamID: "id",
			TConfig:  config.TCfg{ChunkSize: 3},
		},
		Generation: 1,
		Idle:       make(chan core.IdleEvent, 1),
	})
	require.NoError(t, err)
	t.Cleanup(m.Destroy)
	return m
}

func TestVariantPlaylistAlignedHardwareGrid(t *testing.T) {
	m := stubVariantManager(t, false, true)
	_, ok := m.EnsureCopySegments()
	require.True(t, ok)
	for _, quality := range []string{"direct", "480p", core.QUALITY_MAX} {
		got, err := VariantPlaylist(m, quality, "?t=123")
		require.NoError(t, err)
		require.Contains(t, got, "#EXT-X-TARGETDURATION:4")
		require.Equal(t, 3, strings.Count(got, "#EXTINF:"))
		require.Contains(t, got, quality+"-000002.m4s?t=123")
	}
	audio, err := VariantPlaylist(m, core.QUALITY_AUDIO, "")
	require.NoError(t, err)
	require.Contains(t, audio, "#EXT-X-TARGETDURATION:3")
	require.Equal(t, 4, strings.Count(audio, "#EXTINF:"), "audio retains its independent timeline")
}

func TestVariantPlaylistLazyDirect(t *testing.T) {
	m := stubVariantManager(t, false)

	got, err := VariantPlaylist(m, "480p", "")
	require.NoError(t, err)
	require.Contains(t, got, "480p-000000.m4s")
	require.False(t, m.CopyProbed())
	_, ok := m.CopySegments()
	require.False(t, ok)

	_, ok = m.EnsureCopySegments()
	require.True(t, ok)
	got, err = VariantPlaylist(m, "direct", "")
	require.NoError(t, err)
	require.Contains(t, got, "direct-000000.m4s")
}

func TestVariantPlaylistDirectPending(t *testing.T) {
	m := stubVariantManager(t, false)

	_, err := VariantPlaylist(m, "direct", "")
	require.ErrorIs(t, err, core.ErrCopyPending)

	deadline := time.Now().Add(10 * time.Second)
	for {
		got, err := VariantPlaylist(m, "direct", "")
		if err == nil {
			require.Contains(t, got, "direct-000000.m4s")
			return
		}
		require.ErrorIs(t, err, core.ErrCopyPending)
		if time.Now().After(deadline) {
			t.Fatal("direct.m3u8 never warmed past 409")
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestVariantPlaylistDirectFallback(t *testing.T) {
	m := stubVariantManager(t, true)

	_, err := VariantPlaylist(m, "direct", "")
	require.ErrorIs(t, err, core.ErrCopyPending)

	deadline := time.Now().Add(10 * time.Second)
	for {
		got, err := VariantPlaylist(m, "direct", "")
		if err == nil {
			require.Contains(t, got, "direct-000000.m4s")
			require.NotContains(t, got, "max-")
			require.Contains(t, got, "#EXT-X-TARGETDURATION:3")
			break
		}
		require.ErrorIs(t, err, core.ErrCopyPending)
		if time.Now().After(deadline) {
			t.Fatal("direct.m3u8 never fell back past 409")
		}
		time.Sleep(20 * time.Millisecond)
	}

	// Lower renditions still serve.
	_, err = VariantPlaylist(m, "480p", "")
	require.NoError(t, err)
}
