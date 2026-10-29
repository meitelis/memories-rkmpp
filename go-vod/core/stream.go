package core

import (
	"bufio"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/pulsejet/memories/go-vod/config"
	"github.com/pulsejet/memories/go-vod/ffmpeg"
)

// CODEC_H264 matches ffprobe's codec_name for H.264 streams.
const CODEC_H264 = "h264"

// copySeekEpsilon nudges copy seeks past timestamp rounding, so -ss lands
// on the grid keyframe instead of the one before it.
const copySeekEpsilon = 0.001

// chunkWait caps per-request chunk waits; the transcode continues.
var chunkWait = 10 * time.Second

type Stream struct {
	c       *config.Config
	m       *Manager
	quality string
	order   int
	height  int
	width   int
	bitrate int

	goal int

	// mutex guards supervision state only: chunks map, goal, coder,
	// inactive. Serving a file and waiting for completion never hold it.
	mutex  sync.Mutex
	chunks map[int]*Chunk

	coder        *exec.Cmd
	coderDone    chan struct{}
	backpressure bool
	resumed      *sync.Cond

	tonemapOnce sync.Once
	vaapiOpenCL bool

	inactive int
	stop     chan bool
}

func (s *Stream) init() {
	s.chunks = make(map[int]*Chunk)
	s.stop = make(chan bool, 1)
	s.resumed = sync.NewCond(&s.mutex)
}

func (s *Stream) Run() {
	// run every 5s
	t := time.NewTicker(5 * time.Second)
	defer t.Stop()

	for {
		select {
		case <-t.C:
			s.mutex.Lock()
			// Prune chunks
			for id := range s.chunks {
				if id < s.goal-s.c.GoalBufferMax {
					s.pruneChunk(id)
				}
			}

			s.inactive++

			// Nothing done for 2 minutes
			if s.inactive >= s.c.StreamIdleTime/5 && s.coder != nil {
				s.clear()
			}
			s.mutex.Unlock()

		case <-s.stop:
			t.Stop()
			s.mutex.Lock()
			s.clear()
			s.mutex.Unlock()
			return
		}
	}
}

func (s *Stream) clear() {
	log.Printf("%s-%s: stopping stream", s.m.id, s.quality)
	coder, done := s.coder, s.coderDone
	s.coder, s.coderDone = nil, nil
	s.resumed.Broadcast()
	if coder != nil && coder.Process != nil {
		coder.Process.Kill()
		if done != nil {
			<-done
		}
	}
	for _, chunk := range s.chunks {
		chunk.signal(false)
		os.Remove(s.getTsPath(chunk.id))
	}
	s.chunks = make(map[int]*Chunk)
	s.goal = 0
}

func (s *Stream) Stop() {
	select {
	case s.stop <- true:
	default:
	}
}

func (s *Stream) ServeChunk(w http.ResponseWriter, id int) error {
	s.mutex.Lock()
	s.inactive = 0
	s.checkGoal(id)

	chunk, ok := s.chunks[id]
	if !ok {
		// Restart unless a nearby chunk shows the transcode is close
		restart := true
		for i := id - 1; i >= id-s.c.LookBehind && i >= 0; i-- {
			if _, ok := s.chunks[i]; ok {
				restart = false
				break
			}
		}
		if restart {
			s.mutex.Unlock()
			s.restartAtChunk(w, id)
			return nil
		}
		chunk = s.createChunk(id)
	}
	s.mutex.Unlock()

	s.waitForChunk(w, chunk)
	return nil
}

func (s *Stream) ServeFullVideo(w http.ResponseWriter, r *http.Request) error {
	if (s.quality == QUALITY_MAX || s.quality == QUALITY_DIRECT) &&
		IsCodecPlayable(s.m.probe.CodecName, s.m.playableCodecs) {
		// Already on disk, serve temp file directly.
		if s.m.usesTemp {
			log.Printf("%s-%s: serving temp file directly", s.m.id, s.quality)
			w.Header().Set("Content-Type", "video/mp4")
			http.ServeFile(w, r, s.m.ffmpegInput())
			return nil
		}

		// Full quality in a playable codec - signal PHP to download directly.
		log.Printf("%s-%s: playable, signalling direct stream", s.m.id, s.quality)
		w.Header().Set(StreamOriginalHeader, "1")
		w.WriteHeader(http.StatusNoContent)
		return nil
	}
	args := ffmpeg.MP4Args(s.transcodeSpec(0, false))

	coder := exec.Command(s.c.FFmpeg, args...)
	log.Printf("%s-%s: %s", s.m.id, s.quality, strings.Join(ffmpeg.RedactArgs(coder.Args), " "))

	cmdStdOut, cmdStdErr, err := startCommandPipes(coder)
	if err != nil {
		http.Error(w, "Could not start transcoder", http.StatusBadGateway)
		return err
	}

	defer func() {
		if coder.Process != nil {
			coder.Process.Kill()
		}
		coder.Wait()
	}()
	go s.monitorStderr(cmdStdErr)

	// Write to response
	defer cmdStdOut.Close()
	stdoutReader := bufio.NewReader(cmdStdOut)

	// Write mov headers
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Server does not support Flusher!",
			http.StatusInternalServerError)
		return nil
	}
	w.Header().Set("Content-Type", "video/mp4")
	w.WriteHeader(http.StatusOK)

	// Write data, flusing every 1MB
	buf := make([]byte, 1024*1024)
	for {
		n, readErr := stdoutReader.Read(buf)
		if n > 0 {
			if _, err := w.Write(buf[:n]); err != nil {
				break
			}
			flusher.Flush()
		}
		if readErr != nil {
			if readErr != io.EOF {
				log.Printf("transcoder output: %v", readErr)
			}
			break
		}
	}

	return nil
}

func (s *Stream) createChunk(id int) *Chunk {
	if c, ok := s.chunks[id]; ok {
		return c
	} else {
		s.chunks[id] = NewChunk(id)
		return s.chunks[id]
	}
}

func (s *Stream) pruneChunk(id int) {
	delete(s.chunks, id)

	// Remove file
	filename := s.getTsPath(id)
	os.Remove(filename)
}

func (s *Stream) returnChunk(w http.ResponseWriter, id int) {
	filename := s.getTsPath(id)
	f, err := os.Open(filename)
	if err != nil {
		log.Println(err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || info.Size() == 0 {
		w.WriteHeader(http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", "video/MP2T")
	io.Copy(w, f)
}

func (s *Stream) waitForChunk(w http.ResponseWriter, chunk *Chunk) {
	s.mutex.Lock()
	done := chunk.done
	doneCh := chunk.doneCh
	coder := s.coder
	s.mutex.Unlock()

	if done {
		s.returnChunk(w, chunk.id)
		return
	}

	select {
	case <-doneCh:
	case <-time.After(chunkWait):
	}

	// Re-fetch: a restart may have replaced the chunk object meanwhile.
	// A completed replacement is served instead of failing the request.
	s.mutex.Lock()
	current, ok := s.chunks[chunk.id]
	finished := ok && current.done
	restarted := coder != s.coder
	s.mutex.Unlock()

	if finished {
		s.returnChunk(w, chunk.id)
		return
	}

	// Check if coder was changed
	if restarted {
		w.WriteHeader(http.StatusConflict)
		return
	}

	// Return timeout error
	w.WriteHeader(http.StatusRequestTimeout)
}

func (s *Stream) restartAtChunk(w http.ResponseWriter, id int) {
	s.mutex.Lock()
	// Stop current transcoder
	s.clear()

	chunk := s.createChunk(id) // create first chunk

	// Start the transcoder
	s.goal = id + s.c.GoalBufferMax
	if err := s.transcode(id); err != nil {
		delete(s.chunks, id)
		chunk.signal(false)
		s.mutex.Unlock()
		http.Error(w, "Could not start transcoder", http.StatusBadGateway)
		return
	}
	s.mutex.Unlock()

	s.waitForChunk(w, chunk) // this is also a request
}

func (s *Stream) spec(startAt float64, isHls bool) ffmpeg.Spec {
	// Stream copy needs the keyframe grid for HLS segmentation. Without it
	// direct falls back to re-encoding (like max); progressive MP4 copies
	// fine without keyframes, so it always copies.
	_, grid := s.m.CopySegments()
	return ffmpeg.Spec{
		Bin:     s.c.FFmpeg,
		Input:   s.m.ffmpegInput(),
		Headers: s.m.inputHeaders(),
		StartAt: startAt,
		HLS:     isHls,

		RKMPP:          s.c.RKMPP,
		OutputCodec:    s.m.OutputCodec(),
		Bitrate:        s.bitrate,
		CodecName:      s.m.probe.CodecName,
		FrameRateExact: s.m.probe.FrameRateExact,
		PixelFormat:    s.m.probe.PixelFormat,
		Quality:        s.quality,
		Width:          s.width,
		Height:         s.height,
		QF:             s.m.tc.QF,
		FrameRate:      s.m.probe.FrameRate,
		Rotation:       s.m.probe.Rotation,
		HDR:            s.m.probe.HDR,
		BitDepth:       s.m.probe.BitDepth,
		Audio:          s.m.probe.Audio,
		ChunkSize:      s.m.tc.ChunkSize,
		Copy:           s.quality == QUALITY_DIRECT && (!isHls || grid),

		VAAPI:           s.m.tc.VAAPI,
		VAAPILowPower:   s.m.tc.VAAPILowPower,
		VAAPIDevice:     s.m.tc.VAAPIDevice,
		NVENC:           s.m.tc.NVENC,
		NVENCTemporalAQ: s.m.tc.NVENCTemporalAQ,
		NVENCScale:      s.m.tc.NVENCScale,

		UseTranspose:     s.m.tc.UseTranspose,
		ForceSwTranspose: s.m.tc.ForceSwTranspose,
		UseGopSize:       s.m.tc.UseGopSize,
	}
}

func (s *Stream) transcode(startId int) error {
	var startNumber int
	var startAt float64

	if segs, ok := s.m.CopySegments(); ok && s.quality == QUALITY_DIRECT {
		if startId >= len(segs) {
			startId = len(segs) - 1
		}
		startNumber = startId
		startAt = 0
		if startId > 0 {
			startAt = segs[startId].Start + copySeekEpsilon
		}
	} else if startId > 0 {
		// Start one frame before.
		// This ensures that the keyframes are aligned.
		startNumber = startId - 1
		if s.c.RKMPP {
			startNumber = startId
		}
		startAt = float64(startNumber * s.m.tc.ChunkSize)
	}

	spec := s.transcodeSpec(startAt, true)
	s.backpressure = ffmpeg.IsRKMPPEncoder(ffmpeg.Encoder(spec))
	args := ffmpeg.SegmentArgs(spec, startNumber, s.getTsPath(-1))

	// Start the process
	s.coder = exec.Command(s.c.FFmpeg, args...)

	// Log command, quoting the args as needed
	log.Printf("%s-%s: %s", s.m.id, s.quality, ffmpeg.QuoteForLog(ffmpeg.RedactArgs(s.coder.Args)))

	coder := s.coder
	cmdStdOut, cmdStdErr, err := startCommandPipes(coder)
	if err != nil {
		log.Printf("%s-%s: could not start transcoder: %v", s.m.id, s.quality, err)
		s.coder = nil
		return err
	}
	if s.backpressure {
		boundProgressPipe(cmdStdOut)
	}
	done := make(chan struct{})
	s.coderDone = done
	go s.monitorTranscodeOutput(cmdStdOut, coder)
	go s.monitorStderr(cmdStdErr)
	go s.monitorExit(coder, done)
	return nil
}

func (s *Stream) checkGoal(id int) {
	goal := id + s.c.GoalBufferMin
	if goal > s.goal {
		s.goal = id + s.c.GoalBufferMax

		// resume encoding
		if s.coder != nil {
			log.Printf("%s-%s: resuming transcoding", s.m.id, s.quality)
			if s.backpressure {
				s.resumed.Broadcast()
			} else {
				s.coder.Process.Signal(syscall.SIGCONT)
			}
		}
	}
}

func (s *Stream) getTsPath(id int) string {
	if id == -1 {
		return ffmpeg.SegmentPattern(s.m.tempDir, s.quality)
	}
	return ffmpeg.SegmentPath(s.m.tempDir, s.quality, id)
}

// Separate goroutine
func (s *Stream) monitorTranscodeOutput(cmdStdOut io.ReadCloser, coder *exec.Cmd) {

	defer cmdStdOut.Close()
	stdoutReader := bufio.NewReader(cmdStdOut)
	seen := make(map[int]bool)

	for {
		s.mutex.Lock()
		current := s.coder
		s.mutex.Unlock()
		if current != coder {
			break
		}

		line, err := stdoutReader.ReadBytes('\n')
		if err == io.EOF {
			if len(line) == 0 {
				break
			}
		} else if err != nil {
			log.Println(err)
			break
		} else {
			line = line[:(len(line) - 1)]
		}

		l := string(line)

		// Skip repeats: the muxer reprints the whole playlist per segment.
		if segQuality, id, ok := ffmpeg.ParseSegmentLine(l); ok && segQuality == s.quality {
			if seen[id] {
				continue
			}
			seen[id] = true

			// Debug
			log.Printf("%s-%s: recv %s", s.m.id, s.quality, l)

			s.mutex.Lock()
			// The coder has changed; do nothing
			if s.coder == coder {
				s.createChunk(id).signal(true)

				// Check goal satisfied
				if id >= s.goal {
					log.Printf("%s-%s: goal satisfied: %d", s.m.id, s.quality, s.goal)
					if s.backpressure {
						// Block the muxer pipe while asynchronous hardware workers finish.
						for s.coder == coder && id >= s.goal {
							s.resumed.Wait()
						}
					} else {
						s.coder.Process.Signal(syscall.SIGSTOP)
					}
				}
			}
			s.mutex.Unlock()
		}
	}
}

func (s *Stream) monitorStderr(cmdStdErr io.ReadCloser) {
	defer cmdStdErr.Close()
	stderrReader := bufio.NewReader(cmdStdErr)

	for {
		line, err := stderrReader.ReadBytes('\n')
		if err == io.EOF {
			if len(line) == 0 {
				break
			}
		} else if err != nil {
			log.Println(err)
			break
		} else {
			line = line[:(len(line) - 1)]
		}
		log.Println("ffmpeg-error:", string(line))
	}
}

func (s *Stream) monitorExit(coder *exec.Cmd, done chan struct{}) {
	err := coder.Wait()
	close(done)

	// Try to get exit status
	if exitError, ok := err.(*exec.ExitError); ok {
		exitcode := exitError.ExitCode()
		log.Printf("%s-%s: ffmpeg exited with status: %d", s.m.id, s.quality, exitcode)

		s.mutex.Lock()
		defer s.mutex.Unlock()

		// If error code is >0, there was an error in transcoding
		if exitcode > 0 && s.coder == coder {
			// Wake all outstanding chunks; they re-evaluate
			// (409 on coder change, else 408) instead of waiting out
			for _, chunk := range s.chunks {
				chunk.signal(false)
			}
		}
	}
}

// Readiness checks discard the body so no partial startup fragment is sent.
// Files stay on disk; the joined response is streamed without a video-sized buffer.
type readinessWriter struct {
	header http.Header
	status int
}

func (w *readinessWriter) Header() http.Header         { return w.header }
func (w *readinessWriter) WriteHeader(status int)      { w.status = status }
func (w *readinessWriter) Write(p []byte) (int, error) { return len(p), nil }

func (s *Stream) ServeStartupChunk(w http.ResponseWriter) {
	parts := 1
	if s.m.Duration().Seconds() > float64(s.m.tc.ChunkSize) {
		parts = 2
	}
	for i := 0; i < parts; i++ {
		ready := &readinessWriter{header: make(http.Header), status: http.StatusOK}
		s.ServeChunk(ready, i)
		if ready.status != http.StatusOK {
			w.WriteHeader(ready.status)
			return
		}
	}
	for i := 0; i < parts; i++ {
		s.returnChunk(w, i)
	}
}
