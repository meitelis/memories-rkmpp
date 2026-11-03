package core

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"testing/synctest"
	"time"

	"github.com/pulsejet/memories/go-vod/config"
	"github.com/pulsejet/memories/go-vod/ffmpeg"
	"github.com/stretchr/testify/require"
	"golang.org/x/sync/singleflight"
)

func sharedProbeStub(t *testing.T) (bin, counter, failFile string) {
	t.Helper()
	if runtime.GOOS != "linux" {
		t.Skip("ffprobe test executable requires Linux /bin/sh")
	}
	t.Setenv("CACHE_DIR", "")
	dir := t.TempDir()
	counter, failFile = filepath.Join(dir, "calls"), filepath.Join(dir, "fail")
	probe := stubCopyProbe(t, hevcProbeJSON, "0.000000,K__\n2.000000,K__\n4.000000,K__\n6.000000,K__\n8.000000,K__\n", false)
	bin = filepath.Join(dir, "ffprobe")
	script := fmt.Sprintf("#!/bin/sh\nprintf 'run\\n' >> %q\nsleep 0.2\nif [ -f %q ]; then exit 1; fi\nexec %q \"$@\"\n", counter, failFile, probe)
	require.NoError(t, os.WriteFile(bin, []byte(script), 0755))
	return bin, counter, failFile
}

func sourceProbeManager(bin string, index int) *Manager {
	return &Manager{
		c: &config.Config{FFprobe: bin}, url: "http://nextcloud/stream/7", fileid: 7, etag: "version-1",
		id: fmt.Sprintf("client-%d", index), serviceToken: fmt.Sprintf("token-%d", index),
		playableCodecs: []string{"hevc"}, tc: config.TCfg{ChunkSize: 2},
	}
}

func requireProbeCalls(t *testing.T, path string, count int) {
	t.Helper()
	data, err := os.ReadFile(path)
	require.NoError(t, err)
	require.Equal(t, count, strings.Count(string(data), "run\n"))
}

func TestSourceProbeKeyScopesSourceVersionAndExecutable(t *testing.T) {
	t.Setenv("CACHE_DIR", "")
	base := sourceProbeManager("ffprobe-a", 0)
	base.c.CacheDir_ = filepath.Join(t.TempDir(), "cache")
	key, ok := base.sourceProbeKey()
	require.True(t, ok)
	for _, change := range []struct {
		name  string
		apply func(*Manager)
	}{
		{"cache namespace", func(m *Manager) { m.c.CacheDir_ += "-other" }},
		{"source URL", func(m *Manager) { m.url += "?liveid=other" }},
		{"file ID", func(m *Manager) { m.fileid++ }},
		{"etag", func(m *Manager) { m.etag += "-other" }},
		{"probe executable", func(m *Manager) { m.c.FFprobe += "-other" }},
		{"input kind", func(m *Manager) { m.usesTemp = true }},
	} {
		t.Run(change.name, func(t *testing.T) {
			other := sourceProbeManager(base.c.FFprobe, 1)
			other.c.CacheDir_ = base.c.CacheDir_
			change.apply(other)
			otherKey, share := other.sourceProbeKey()
			require.True(t, share)
			require.NotEqual(t, key, otherKey)
		})
	}
	other := sourceProbeManager(base.c.FFprobe, 1)
	other.c.CacheDir_ = base.c.CacheDir_
	other.id, other.serviceToken, other.input = "another-client", "another-token", "/private/manager-input.mp4"
	other.tc.ChunkSize = 6
	otherKey, share := other.sourceProbeKey()
	require.True(t, share)
	require.Equal(t, key, otherKey, "client state, tokens and temporary paths are not shared identity")
	other.etag = ""
	_, share = other.sourceProbeKey()
	require.False(t, share)
}

func TestConcurrentSourceProbesShareAnalysisAndKeepClientState(t *testing.T) {
	bin, counter, _ := sharedProbeStub(t)
	const clients = 8
	managers := make([]*Manager, clients)
	errs := make(chan error, clients)
	start := make(chan struct{})
	var ready sync.WaitGroup
	ready.Add(clients)
	for i := range managers {
		m := sourceProbeManager(bin, i)
		if i%2 == 1 {
			m.playableCodecs = []string{"h264"}
		}
		managers[i] = m
		go func() { ready.Done(); <-start; errs <- m.ffprobe() }()
	}
	ready.Wait()
	close(start)
	for range managers {
		require.NoError(t, <-errs)
	}
	requireProbeCalls(t, counter, 1)
	for i, m := range managers {
		require.Equal(t, i%2 == 0, m.copyEligible)
		require.Equal(t, fmt.Sprintf("token-%d", i), m.getServiceToken())
		if i > 0 {
			require.NotSame(t, managers[0].probe, m.probe)
		}
	}
}

func TestConcurrentKeyframeProbesDeriveIndependentChunkGrids(t *testing.T) {
	bin, counter, _ := sharedProbeStub(t)
	const clients = 8
	type result struct {
		index    int
		segments []ffmpeg.Segment
		err      error
	}
	results := make(chan result, clients)
	start := make(chan struct{})
	var ready sync.WaitGroup
	ready.Add(clients)
	for i := range clients {
		m := sourceProbeManager(bin, i)
		m.probe = &ProbeVideoData{Duration: 10 * time.Second}
		if i%2 == 1 {
			m.tc.ChunkSize = 4
		}
		go func() {
			ready.Done()
			<-start
			segments, err := m.probeCopy()
			results <- result{i, segments, err}
		}()
	}
	ready.Wait()
	close(start)
	for range clients {
		result := <-results
		require.NoError(t, result.err)
		if result.index%2 == 0 {
			require.Len(t, result.segments, 5)
		} else {
			require.Len(t, result.segments, 3)
		}
	}
	requireProbeCalls(t, counter, 1)
}

func TestSharedProbeFailuresCanBeRetried(t *testing.T) {
	for _, keyframes := range []bool{false, true} {
		t.Run(fmt.Sprintf("keyframes=%t", keyframes), func(t *testing.T) {
			bin, counter, failFile := sharedProbeStub(t)
			require.NoError(t, os.WriteFile(failFile, nil, 0600))
			probe := func(m *Manager) error {
				if keyframes {
					_, err := m.probeKeyframes()
					return err
				}
				_, err := m.probeVideo()
				return err
			}
			require.Error(t, probe(sourceProbeManager(bin, 0)))
			require.NoError(t, os.Remove(failFile))
			require.NoError(t, probe(sourceProbeManager(bin, 1)))
			requireProbeCalls(t, counter, 2)
		})
	}
}

func TestSharedAnalysisWaiterRetriesWithOwnCredentials(t *testing.T) {
	for _, analysis := range []struct {
		name  string
		value any
	}{
		{"base probe", &ProbeVideoData{Width: 640, Height: 480, Duration: time.Second}},
		{"keyframes", []float64{0, 2, 4}},
	} {
		t.Run(analysis.name, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				var group singleflight.Group
				started, release := make(chan struct{}), make(chan struct{})
				type outcome struct {
					value any
					err   error
				}
				leaderResult, waiterResult := make(chan outcome, 1), make(chan outcome, 1)
				leader, waiter := sourceProbeManager("unused", 0), sourceProbeManager("unused", 1)
				leader.serviceToken, waiter.serviceToken = "expired-token", "valid-token"
				leaderCalls, waiterCalls := 0, 0
				go func() {
					value, err := shareSourceAnalysis(&group, "same-source", func() (any, error) {
						leaderCalls++
						close(started)
						<-release
						return nil, fmt.Errorf("HTTP 401 for %s", leader.getServiceToken())
					})
					leaderResult <- outcome{value, err}
				}()
				<-started // The expired-token caller is definitely the leader.
				go func() {
					value, err := shareSourceAnalysis(&group, "same-source", func() (any, error) {
						waiterCalls++
						if waiter.getServiceToken() != "valid-token" {
							return nil, fmt.Errorf("waiter lost its own credentials")
						}
						return analysis.value, nil
					})
					waiterResult <- outcome{value, err}
				}()
				// Wait proves the waiter has joined the blocked singleflight call;
				// releasing the leader does not depend on a scheduling delay.
				synctest.Wait()
				require.Zero(t, waiterCalls)
				close(release)
				failed, recovered := <-leaderResult, <-waiterResult
				require.ErrorContains(t, failed.err, "HTTP 401")
				require.NoError(t, recovered.err)
				require.Equal(t, analysis.value, recovered.value)
				require.Equal(t, 1, leaderCalls, "leader should not repeat its own failing request")
				require.Equal(t, 1, waiterCalls, "waiter retries once with its own credentials")
			})
		})
	}
}

func TestUnversionedSourcesAreProbedIndependently(t *testing.T) {
	bin, counter, _ := sharedProbeStub(t)
	errs := make(chan error, 2)
	for i := range 2 {
		m := sourceProbeManager(bin, i)
		m.etag = ""
		go func() { errs <- m.ffprobe() }()
	}
	for range 2 {
		require.NoError(t, <-errs)
	}
	requireProbeCalls(t, counter, 2)
}

func TestSharedProbeLoadRechecksDiskCache(t *testing.T) {
	t.Setenv("CACHE_DIR", "")
	m := sourceProbeManager("missing-ffprobe", 0)
	m.c.CacheDir_ = t.TempDir()
	probe := &ProbeVideoData{Width: 640, Height: 480, Duration: time.Second}
	require.NoError(t, StoreCachedProbe(m.c.CacheDir(), m.fileid, m.etag, probe))
	got, err := m.loadProbeVideo()
	require.NoError(t, err)
	require.Equal(t, probe, got)
	keys := []float64{0, 2, 4}
	require.NoError(t, StoreCachedKeyframes(m.c.CacheDir(), m.fileid, m.etag, keys))
	gotKeys, err := m.loadProbeKeyframes()
	require.NoError(t, err)
	require.Equal(t, keys, gotKeys)
}
