package core

import (
	"github.com/pulsejet/memories/go-vod/config"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestRKMPPSessionScopeAndTokenRefresh(t *testing.T) {
	t.Setenv("MEMORIES_RKMPP", "1")
	c := config.Defaults("test")
	c.TempDir = t.TempDir()
	c.FFprobe = stubProbe(t)
	r := NewRegistry(c, make(chan IdleEvent, 16))
	p := ManagerParams{URL: "http://nextcloud/stream/7", StreamID: "0123456789abcdef", FileID: 7, Etag: "a", ServiceToken: "first", TConfig: config.TCfg{ChunkSize: 3}}
	first, err := r.GetOrCreate(p)
	require.NoError(t, err)
	defer first.Destroy()
	p.ServiceToken = "renewed"
	again, err := r.GetOrCreate(p)
	require.NoError(t, err)
	require.Same(t, first, again)
	require.Equal(t, "renewed", again.getServiceToken())
	p.FileID = 8
	p.URL = "http://nextcloud/stream/8"
	other, err := r.GetOrCreate(p)
	require.NoError(t, err)
	defer other.Destroy()
	require.NotSame(t, first, other)
	p.FileID = 7
	p.URL = "http://nextcloud/stream/7"
	p.TConfig.ChunkSize = 6
	changed, err := r.GetOrCreate(p)
	require.NoError(t, err)
	defer changed.Destroy()
	require.NotSame(t, first, changed)
	p.TConfig.ChunkSize = 3
	restored, err := r.GetOrCreate(p)
	require.NoError(t, err)
	require.Same(t, first, restored)
}
