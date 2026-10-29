//go:build linux

package core

import (
	"io"
	"os"
	"syscall"
)

// Limit queued progress output so a buffered job stops reading ahead promptly.
func boundProgressPipe(reader io.ReadCloser) {
	if file, ok := reader.(*os.File); ok {
		syscall.Syscall(syscall.SYS_FCNTL, file.Fd(), 1031, 4096) // F_SETPIPE_SZ
	}
}
