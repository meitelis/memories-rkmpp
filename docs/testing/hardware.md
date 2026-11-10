# RK3588 hardware validation

This is a separate development image and runner. It does not change Nextcloud,
Portainer, the running transcoder, production Compose or the old player helper.
Both the Go builder and the MPP/RGA/Mali multimedia image are pinned by digest.
The original multimedia runtime's MPP source is pinned to
`a9380ef333102ac318628f83b5f7a460d377749e`. The image builds it with one local
backport: an absent optional VP8 control callback returns success rather than
`MPP_ERR_NULL_PTR`. This preserves the pinned ABI; no wholesale SDK upgrade is
included. The production image reuses this tested library exactly.

## Generated hardware matrix

On the ROCK 5B+, from a checkout containing these changes:

```bash
RKMPP_SMOKE_OUTPUT="$PWD/hardware-results" bash scripts/test-v11-rkmpp.sh --matrix
```

This builds the ARM64 image and generates disposable fixtures inside its cache.
No original media or Nextcloud credentials are needed. It runs:

- `ffmpeg.test`: H.264/HEVC hardware output at two resolutions from a 29.97 fps
  source, cold restarts at 6 seconds, byte-identical init segments, independent
  segment decoding and exact 3-second video packet boundaries. Generated 4K PQ
  and HLG HEVC Main10 sources exercise the full MPP/RGA/Mali/MPP path and check
  8-bit BT.709 output. The upstream software fMP4 restart regression also runs.
  A 30-second 50 fps test checks every packet timestamp/duration and independent
  decoding beyond the initial input-pacing burst, for both hardware encoders.
  The source-grid regression uses irregular fractional GOPs, VBR hardware output
  at two sizes, exact first/last packet timestamps and byte-identical cold init.
  Copied AVC/HEVC B-frame fixtures check raw MP4 presentation timestamps (decode
  time plus signed composition offset), cold init stability and fragment decoding.
- `core.test`: real manager/stream publication, cached init use, cold video and
  shared AAC seeks, and video-quality requests that leave the audio encoder
  running. The upstream HTTP copy/transcode restart regression also runs.
  Source-aligned serving also tests a segment ID that would be out of range on
  the old three-second grid, a cold restart and unchanged shared-audio workers.
- `api.test`: go-vod 0.7.0 ping and Memories 11 POST envelope, authenticated
  Range callbacks to a local fixture server, codec negotiation, a single audio
  group, token propagation and decoding of served init/seek segments. The
  callback server is inside the isolated test process, not your Nextcloud.

Tests return a nonzero status on failure. Hardware tests skip during ordinary
`go test ./...`; the matrix explicitly enables them with
`MEMORIES_RKMPP_HW_TEST=1`. Feature listings alone cannot pass this gate.

The input-format suite generates AVC, HEVC, VP8, VP9, AV1, H.263, MPEG-1,
MPEG-2, MPEG-4 and MJPEG sources and tests both output codecs. In the pinned
runtime VP8 failed MPP decoder initialization before the optional-control fix.
All ten input codecs now pass to both output encoders with the patched library.
The recorded 5 November 2026 hardware matrix, including HDR, core and API suites, passed. Re-run the matrix to establish coverage for a later source revision. Open-GOP AVC/HEVC
tests compare raw presentation ranges with the server plan and verify full/cold
hardware output against the same ranges. Do not confuse these synthetic codec
checks with real-browser/mobile playback acceptance.

`environment.txt` records UTC time, kernel, Git revision, a hash of source files
(including untracked changes), image ID, architecture and protocol version.
Each suite retains its own log. Keep these with any failure report.

## Test an existing sample

Use a disposable sample outside the production Nextcloud data directory:

```bash
bash scripts/test-v11-rkmpp.sh /absolute/path/to/test-video.mp4
bash scripts/test-v11-rkmpp.sh /absolute/path/to/test-video.mp4 -start 6
bash scripts/test-v11-rkmpp.sh /absolute/path/to/hdr10-video.mkv -opencl
```

The default output is `~/memories-v11-smoke`; override it with
`RKMPP_SMOKE_OUTPUT`. `-codec h264` or `-codec hevc` selects one output codec.
The helper creates a new run directory, preserves the server's stdout HLS
settings, stores the final playlist and decodes the entire output, including
audio. Seek cutoffs use the absolute source clock required by `-copyts`.

If it prints `source needs CPU decode`, only hardware encoding has been tested.
Use SDR AVC 4:2:0 for the first full MPP decode gate. Unsupported surfaces use
CPU decoding; `-opencl` explicitly selects the experimental Mali graph for HDR.
Dolby Vision is rejected by this port rather than treated as ordinary HDR10.

To reuse an image you just built, set `RKMPP_SMOKE_SKIP_BUILD=1`. Leave this
unset after changing any source or Dockerfile.

## Docker runtime requirements

The runner uses no network, read-only rootfs and sample mounts, dropped
capabilities, no-new-privileges and the invoking user's UID/GID. Only a dedicated
cache is writable. It passes the MPP, RGA, DMA heap, DRM and optional Mali
devices, adding their **numeric** group IDs for the scratch image.

It also uses `--security-opt systempaths=unconfined`. Docker's normal mask hides
`/sys/firmware`, which is the target of `/proc/device-tree`. MPP then identifies
the SoC as `unknown` and HEVC initialization fails. Read-only bind mounts under
the masked path alone did not resolve this on the tested Docker daemon. This
setting follows the [Jellyfin Rockchip runtime guidance](https://jellyfin.org/docs/general/post-install/transcoding/hardware-acceleration/rockchip/).
It does not grant privileged mode or add capabilities.

## What remains outside this gate

The API fixture checks the v11 protocol, not a live PHP/bridge deployment.
It does not prove real share-link authentication, Safari/native HLS, hls.js ABR
or audible quality switching in a browser. Generated HDR patterns validate
execution and metadata, not perceptual tone-map quality. See
the [playback guide](../playback.md) before planning a staging deployment.
