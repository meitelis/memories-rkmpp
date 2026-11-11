package ffmpeg

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestDetectHTTPOptions(t *testing.T) {
	orig := reconnectArgs
	defer func() { reconnectArgs = orig }()

	DetectHTTPOptions(filepath.Join(t.TempDir(), "missing"))
	require.Equal(t, orig, reconnectArgs)

	bin := filepath.Join(t.TempDir(), "ffprobe")
	help := "  -reconnect         <boolean>\n  -reconnect_at_eof  <boolean>\n  -reconnect_delay_max <int>\n"
	require.NoError(t, os.WriteFile(bin, []byte("#!/bin/sh\nprintf '"+help+"'\n"), 0o755))
	DetectHTTPOptions(bin)
	require.Equal(t, []string{"-reconnect", "1", "-reconnect_delay_max", "5"}, reconnectArgs)
}

func TestDetectHTTPOptionsMixedToolchains(t *testing.T) {
	orig := reconnectArgs
	t.Cleanup(func() { reconnectArgs = orig })
	for _, oldFirst := range []bool{false, true} {
		reconnectArgs = orig
		dir := t.TempDir()
		old := filepath.Join(dir, "old")
		newer := filepath.Join(dir, "new")
		// Tab-separated help and similarly named options must be parsed exactly.
		require.NoError(t, os.WriteFile(old, []byte("#!/bin/sh\nprintf '  -reconnect\\t<boolean>\\n  -reconnect_at_eof <boolean>\\n  -reconnect_delay_max <int>\\n  -no-reconnect_max_retries <int>\\n'\n"), 0o755))
		require.NoError(t, os.WriteFile(newer, []byte("#!/bin/sh\nprintf '  -reconnect <boolean>\\n  -reconnect_delay_max <int>\\n  -reconnect_max_retries <int>\\n'\n"), 0o755))
		bins := []string{newer, old}
		if oldFirst {
			bins = []string{old, newer}
		}
		for _, bin := range bins {
			DetectHTTPOptions(bin)
		}
		require.Equal(t, []string{"-reconnect", "1", "-reconnect_delay_max", "5"}, reconnectArgs)
		for _, args := range [][]string{
			remoteInputArgs("Authorization: test\r\n"),
			StoryboardArgs("http://nc/file/7", "", 5, 160, 90, 10, 2, 1, "storyboard-%d.jpg"),
		} {
			require.Contains(t, args, "-reconnect")
			require.NotContains(t, args, "-reconnect_max_retries")
		}
	}
}

func TestDetectHTTPOptionsTimeout(t *testing.T) {
	orig := reconnectArgs
	t.Cleanup(func() { reconnectArgs = orig })
	bin := filepath.Join(t.TempDir(), "ffprobe")
	require.NoError(t, os.WriteFile(bin, []byte("#!/bin/sh\nexec sleep 30\n"), 0o755))
	start := time.Now()
	DetectHTTPOptions(bin)
	require.Less(t, time.Since(start), probeTimeout+2*time.Second)
	require.Equal(t, orig, reconnectArgs, "a failed capability probe preserves the current policy")
}
