package core

import (
	"io"
	"os"
	"os/exec"
)

// Own the read ends: exec.Cmd.Wait must not close unread final segment notices.
func startCommandPipes(cmd *exec.Cmd) (io.ReadCloser, io.ReadCloser, error) {
	stdout, outWriter, err := os.Pipe()
	if err != nil {
		return nil, nil, err
	}
	stderr, errWriter, err := os.Pipe()
	if err != nil {
		stdout.Close()
		outWriter.Close()
		return nil, nil, err
	}
	cmd.Stdout, cmd.Stderr = outWriter, errWriter
	err = cmd.Start()
	outWriter.Close()
	errWriter.Close()
	if err != nil {
		stdout.Close()
		stderr.Close()
		return nil, nil, err
	}
	return stdout, stderr, nil
}
