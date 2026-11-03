package ffmpeg

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestProbeAndKeyframesAuthenticatedHTTPInputOptions(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("recording ffprobe executable requires Linux /bin/sh")
	}
	dir := t.TempDir()
	bin, argsPath := filepath.Join(dir, "ffprobe"), filepath.Join(dir, "args")
	t.Setenv("PROBE_HTTP_ARGS", argsPath)
	script := "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$PROBE_HTTP_ARGS\"\n" +
		"for arg in \"$@\"; do if [ \"$arg\" = 'packet=pts_time,flags' ]; then printf '0.000000,K__\\n'; exit 0; fi; done\n" +
		"printf '%s\\n' '{\"streams\":[{\"codec_type\":\"video\",\"codec_name\":\"h264\",\"width\":64,\"height\":64}]}'\n"
	require.NoError(t, os.WriteFile(bin, []byte(script), 0755))
	for _, tc := range []struct {
		name, input, headers string
	}{
		{"local", "/source/local.mp4", ""},
		{"authenticated HTTP", "http://nextcloud/stream/7", "X-Memories-Service-Token: test-only"},
	} {
		for _, keyframes := range []bool{false, true} {
			name := tc.name + "/video"
			if keyframes {
				name = tc.name + "/keyframes"
			}
			t.Run(name, func(t *testing.T) {
				if keyframes {
					keys, err := Keyframes(context.Background(), bin, tc.input, tc.headers)
					require.NoError(t, err)
					require.Equal(t, []float64{0}, keys)
				} else {
					_, err := Probe(context.Background(), bin, tc.input, tc.headers)
					require.NoError(t, err)
				}
				data, err := os.ReadFile(argsPath)
				require.NoError(t, err)
				args := strings.Split(strings.TrimSpace(string(data)), "\n")
				inputIndex := slices.Index(args, "-i")
				require.GreaterOrEqual(t, inputIndex, 0)
				require.Equal(t, tc.input, args[inputIndex+1])
				for _, flag := range []string{"-multiple_requests", "-seekable", "-headers"} {
					index := slices.Index(args, flag)
					if tc.headers == "" {
						require.Equal(t, -1, index, "local probes must not receive HTTP-only input options")
					} else {
						require.GreaterOrEqual(t, index, 0)
						require.Less(t, index, inputIndex, "HTTP options must apply to the input")
						if flag == "-headers" {
							require.Equal(t, tc.headers, args[index+1])
						} else {
							require.Equal(t, "1", args[index+1])
						}
					}
				}
			})
		}
	}
}
