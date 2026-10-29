package core

import (
	"io"
	"os/exec"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestProcessExitPreservesUnreadFinalOutput(t *testing.T) {
	for i := 0; i < 25; i++ {
		cmd := exec.Command("sh", "-c", "printf '720p-000011.ts\\n'; printf 'final diagnostic\\n' >&2")
		stdout, stderr, err := startCommandPipes(cmd)
		require.NoError(t, err)
		require.NoError(t, cmd.Wait())
		out, err := io.ReadAll(stdout)
		require.NoError(t, err)
		stdout.Close()
		diagnostic, err := io.ReadAll(stderr)
		require.NoError(t, err)
		stderr.Close()
		require.Equal(t, "720p-000011.ts\n", string(out))
		require.Equal(t, "final diagnostic\n", string(diagnostic))
	}
}
func TestProcessStartFailure(t *testing.T) {
	out, diagnostic, err := startCommandPipes(exec.Command("/does-not-exist"))
	require.Error(t, err)
	require.Nil(t, out)
	require.Nil(t, diagnostic)
}
