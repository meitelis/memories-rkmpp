package ffmpeg

import (
	"context"
	"log"
	"strings"
	"time"
)

// remoteInputArgs are the options for an authenticated http input: one
// persistent seekable connection with bounded reconnects. Empty for local
// inputs (no headers).
func remoteInputArgs(headers string) []string {
	if headers == "" {
		return nil
	}
	args := []string{
		"-multiple_requests", "1",
		"-seekable", "1",
	}
	args = append(args, reconnectArgs...)
	return append(args, "-headers", headers)
}

// reconnectArgs are the http input reconnect flags shared by transcode and
// storyboard inputs: transient network/server failures are ridden out inside
// ffmpeg instead of failing the job. Retries stay bounded (count and total
// delay) so a dead upstream still surfaces as an error. Only 429 and 5xx
// reconnect; other 4xx (bad token, missing file) fail fast. No
// reconnect_at_eof: inputs are finite files, so clean EOF must end the job
// instead of looping reconnects at the last byte.
var reconnectArgs = []string{
	"-reconnect", "1",
	"-reconnect_on_network_error", "1",
	"-reconnect_on_http_error", "429,5xx",
	"-reconnect_streamed", "1",
	"-reconnect_delay_max", "5",
	"-reconnect_max_retries", "10",
	"-reconnect_delay_total_max", "30",
	"-respect_retry_after", "1",
}

// DetectHTTPOptions narrows the shared reconnect policy to options supported
// by bin. Call for both FFmpeg and ffprobe before starting workers: their
// intersection is safe for every caller, including mixed-version toolchains.
func DetectHTTPOptions(bin string) {
	ctx, cancel := context.WithTimeout(context.Background(), probeTimeout)
	defer cancel()
	cmd := Command(ctx, bin, "-hide_banner", "-h", "protocol=http")
	cmd.WaitDelay = time.Second
	out, err := cmd.Output()
	if err != nil {
		log.Printf("Failed to detect %s http options: %v", bin, err)
		return
	}
	options := make(map[string]bool)
	for line := range strings.SplitSeq(string(out), "\n") {
		if fields := strings.Fields(line); len(fields) > 0 {
			options[fields[0]] = true
		}
	}
	var supported []string
	for i := 0; i < len(reconnectArgs); i += 2 {
		if options[reconnectArgs[i]] {
			supported = append(supported, reconnectArgs[i], reconnectArgs[i+1])
		} else {
			log.Printf("%s does not support http option %s, skipping", bin, reconnectArgs[i])
		}
	}
	reconnectArgs = supported
	log.Printf("Using http reconnect args: %s", strings.Join(supported, " "))
}
