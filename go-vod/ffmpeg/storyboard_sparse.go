package ffmpeg

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/draw"
	"image/jpeg"
	"os"
	"os/exec"
)

// Sparse seeking avoids scanning every keyframe of long 4K clips for previews.
// Thumbnail decoding is deliberately bounded CPU work; video streaming stays MPP.
func buildSparseStoryboard(ctx context.Context, bin, input, headers string, p StoryboardPlan, pattern string) error {
	for sheet, first := 0, 0; first < p.Count; sheet, first = sheet+1, first+p.PerGrid {
		canvas := image.NewRGBA(image.Rect(0, 0, p.Cols*p.ThumbW, p.GridRows*p.ThumbH))
		for tile := 0; tile < p.PerGrid && first+tile < p.Count; tile++ {
			at := float64(first+tile) * p.Interval
			var data []byte
			var err error
			for _, keyframesOnly := range []bool{true, false} {
				args := []string{"-hide_banner", "-loglevel", "error", "-threads", "2", "-filter_threads", "1", "-ss", fmt.Sprintf("%.6f", at)}
				if keyframesOnly {
					args = append(args, "-noaccurate_seek", "-skip_frame", "nokey")
				}
				filter := fmt.Sprintf("scale=%d:%d:force_original_aspect_ratio=decrease,format=yuv420p,pad=%d:%d:(ow-iw)/2:(oh-ih)/2", p.ThumbW, p.ThumbH, p.ThumbW, p.ThumbH)
				if headers != "" {
					args = append(args, reconnectArgs()...)
					args = append(args, "-headers", headers, "-multiple_requests", "1", "-seekable", "1")
				}
				args = append(args, "-i", input, "-an", "-vf", filter, "-frames:v", "1", "-fps_mode", "passthrough", "-threads", "1", "-q:v", "4", "-f", "image2pipe", "-c:v", "mjpeg", "-")
				var stderr bytes.Buffer
				cmd := exec.CommandContext(ctx, bin, args...)
				cmd.Stderr = &stderr
				data, err = cmd.Output()
				if err == nil && len(data) > 0 {
					break
				}
				if ctx.Err() != nil {
					return ctx.Err()
				}
				err = fmt.Errorf("thumbnail at %.3fs: %v: %s", at, err, stderr.String())
			}
			if err != nil {
				return err
			}
			thumb, err := jpeg.Decode(bytes.NewReader(data))
			if err != nil {
				return fmt.Errorf("thumbnail at %.3fs: %w", at, err)
			}
			if thumb.Bounds().Dx() != p.ThumbW || thumb.Bounds().Dy() != p.ThumbH {
				return fmt.Errorf("unexpected thumbnail dimensions")
			}
			x, y := tile%p.Cols*p.ThumbW, tile/p.Cols*p.ThumbH
			draw.Draw(canvas, image.Rect(x, y, x+p.ThumbW, y+p.ThumbH), thumb, thumb.Bounds().Min, draw.Src)
		}
		f, err := os.Create(fmt.Sprintf(pattern, sheet))
		if err != nil {
			return err
		}
		err = jpeg.Encode(f, canvas, &jpeg.Options{Quality: 85})
		closeErr := f.Close()
		if err != nil {
			return err
		}
		if closeErr != nil {
			return closeErr
		}
	}
	return nil
}
