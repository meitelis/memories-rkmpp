//go:build !linux

package core

import "io"

func boundProgressPipe(reader io.ReadCloser) {}
