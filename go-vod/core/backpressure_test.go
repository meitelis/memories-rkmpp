package core

import (
	"io"
	"os/exec"
	"testing"
	"time"

	"github.com/pulsejet/memories/go-vod/config"
	"github.com/stretchr/testify/require"
)

func TestHardwareBackpressureResumesAndStops(t *testing.T) {
	for _, clear := range []bool{false, true} {
		t.Run(map[bool]string{false: "resume", true: "clear"}[clear], func(t *testing.T) {
			s := &Stream{c: config.Defaults("test"), m: &Manager{id: "backpressure", tempDir: t.TempDir()}, quality: "720p"}
			s.init()
			s.coder = exec.Command("not-started")
			s.backpressure = true
			first := s.createChunk(0)
			reader, writer := io.Pipe()
			done := make(chan struct{})
			go func() { s.monitorTranscodeOutput(reader, s.coder); close(done) }()
			_, err := io.WriteString(writer, "720p-000000.ts\n")
			require.NoError(t, err)
			select {
			case <-first.doneCh:
			case <-time.After(time.Second):
				t.Fatal("first chunk not signaled")
			}
			s.mutex.Lock()
			require.True(t, first.done)
			if clear {
				s.clear()
			} else {
				s.checkGoal(0)
			}
			s.mutex.Unlock()
			writer.Close()
			select {
			case <-done:
			case <-time.After(time.Second):
				t.Fatal("reader did not wake")
			}
		})
	}
}
