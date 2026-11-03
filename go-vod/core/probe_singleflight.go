package core

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"log"
	"path/filepath"
	"time"

	"github.com/pulsejet/memories/go-vod/ffmpeg"
	"golang.org/x/sync/singleflight"
)

// Share immutable source analysis, not managers, credentials, temporary inputs,
// or rendition-specific segment grids. Results are retained only by the disk
// cache and individual managers after an in-flight call completes.
var sourceProbeFlights singleflight.Group
var sourceKeyframeFlights singleflight.Group

func shareSourceAnalysis(group *singleflight.Group, key string, load func() (any, error)) (any, error) {
	// Do executes the winning closure synchronously in its caller. This flag
	// belongs to that one call, so no other caller writes it and no lock is
	// needed. Do's Shared result cannot identify the leader: it is true for
	// both the leader and its waiters when a result was shared.
	executed := false
	v, err, _ := group.Do(key, func() (any, error) {
		executed = true
		return load()
	})
	if err != nil && !executed {
		// Successful source data is reusable, but an expired/invalid token is
		// specific to its caller. Give waiters a chance with their own token
		// before a keyframe failure becomes sticky in their manager.
		return load()
	}
	return v, err
}

func (m *Manager) sourceProbeKey() (string, bool) {
	// Without a version tag we cannot establish that simultaneous callers are
	// reading the same content. Preserve independent probing in that case.
	if m.etag == "" || m.url == "" || m.fileid <= 0 {
		return "", false
	}
	cacheDir := m.c.CacheDir()
	if cacheDir != "" {
		var err error
		cacheDir, err = filepath.Abs(cacheDir)
		if err != nil {
			return "", false
		}
	}
	identity, err := json.Marshal(struct {
		CacheDir string
		URL      string
		FileID   int64
		Etag     string
		FFprobe  string
		UsesTemp bool
	}{cacheDir, m.url, m.fileid, m.etag, m.c.FFprobe, m.usesTemp})
	if err != nil {
		return "", false
	}
	return fmt.Sprintf("%x", sha256.Sum256(identity)), true
}

func (m *Manager) probeVideo() (*ProbeVideoData, error) {
	if probe, ok := LoadCachedProbe(m.c.CacheDir(), m.fileid, m.etag); ok {
		log.Printf("%s: probe cache hit", m.id)
		return probe, nil
	}
	key, share := m.sourceProbeKey()
	if !share {
		return m.loadProbeVideo()
	}
	v, err := shareSourceAnalysis(&sourceProbeFlights, key, func() (any, error) {
		return m.loadProbeVideo()
	})
	if err != nil {
		return nil, err
	}
	// Keep a distinct value for each manager; browser-dependent eligibility is
	// derived by ffprobe() after this shared source analysis returns.
	probe := *v.(*ProbeVideoData)
	return &probe, nil
}

func (m *Manager) loadProbeVideo() (*ProbeVideoData, error) {
	// Recheck inside the flight: another completed call may have populated disk
	// between the outer cache miss and acquiring the singleflight entry.
	if probe, ok := LoadCachedProbe(m.c.CacheDir(), m.fileid, m.etag); ok {
		log.Printf("%s: probe cache hit", m.id)
		return probe, nil
	}
	log.Printf("%s: probe cache miss", m.id)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	info, err := ffmpeg.Probe(ctx, m.c.FFprobe, m.ffmpegInput(), m.inputHeaders())
	if err != nil {
		return nil, err
	}
	probe := &ProbeVideoData{
		Width: info.Width, Height: info.Height, Duration: info.Duration,
		FrameRate: info.FrameRate, FrameRateExact: info.FrameRateExact,
		PixelFormat: info.PixelFormat, CodecName: info.CodecName,
		BitRate: info.BitRate, Rotation: info.Rotation, HDR: info.HDR,
		BitDepth: info.BitDepth, Audio: info.Audio,
	}
	if err := StoreCachedProbe(m.c.CacheDir(), m.fileid, m.etag, probe); err != nil {
		log.Printf("%s: probe cache store failed: %v", m.id, err)
	}
	return probe, nil
}

func (m *Manager) probeKeyframes() ([]float64, error) {
	if keys, ok := LoadCachedKeyframes(m.c.CacheDir(), m.fileid, m.etag); ok {
		return keys, nil
	}
	key, share := m.sourceProbeKey()
	if !share {
		return m.loadProbeKeyframes()
	}
	v, err := shareSourceAnalysis(&sourceKeyframeFlights, key, func() (any, error) {
		return m.loadProbeKeyframes()
	})
	if err != nil {
		return nil, err
	}
	// Copy the decoded timestamps; every manager derives its own chunk grid.
	return append([]float64(nil), v.([]float64)...), nil
}

func (m *Manager) loadProbeKeyframes() ([]float64, error) {
	cachePath := KeyframeCachePath(m.c.CacheDir(), m.fileid)
	if keys, ok := LoadCachedKeyframes(m.c.CacheDir(), m.fileid, m.etag); ok {
		log.Printf("%s: keyframe cache hit %s", m.id, cachePath)
		return keys, nil
	}
	log.Printf("%s: keyframe cache miss %s", m.id, cachePath)
	keys, err := ffmpeg.Keyframes(context.Background(), m.c.FFprobe, m.ffmpegInput(), m.inputHeaders())
	if err != nil {
		return nil, err
	}
	if err := StoreCachedKeyframes(m.c.CacheDir(), m.fileid, m.etag, keys); err != nil {
		log.Printf("%s: keyframe cache store failed: %v", m.id, err)
	}
	return keys, nil
}
