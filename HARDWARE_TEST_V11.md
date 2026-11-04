# Isolated RK3588 test: Memories 11.0.2 / go-vod 0.7.0

**NOT A DEPLOYMENT.** This tests the new 0.7.0 FFmpeg path against the pinned
MPP/RGA/Mali runtime that powered the tested 10.2 R7 image. The code on this
branch is experimental and must not replace the running 10.2 installation,
Nextcloud app, proxy or Docker Compose stack.

## What this stage proves

The image compiles the actual v11 Go server and an independent offline smoke
binary. The smoke binary reuses the **same** `ffmpeg.SegmentArgs` and RKMPP
argument builder used by the v11 server. It checks the expected FFmpeg encoders,
RGA filters, and `rkmpp` hwaccel, then runs real FFmpeg jobs and validates
the resulting fMP4 HLS playlist and init segments by decoding the output.

It does **not** establish Nextcloud 11 handshake/authentication, Memories 11
player compatibility, multi-quality ABR switching, clock continuity across
renditions, or a full HDR tone-map matrix. This is the first hardware gate.

## Run on your ROCK 5B+ only

Choose a disposable H.264 SDR or HEVC SDR sample video **outside** the production
Nextcloud data directory. Run the following in a clone of the GitHub
`import/laptop-2026-11-04` branch:

```bash
git fetch origin import/laptop-2026-11-04
git switch import/laptop-2026-11-04
bash scripts/test-v11-rkmpp.sh /absolute/path/to/test-video.mp4
```

The script builds **local/memories-rkmpp:v11-smoke**, mounts only the
specified sample read-only and a dedicated output folder, isolates networking,
drops capabilities, runs as your host UID, and never contacts Nextcloud.
It automatically adds the device groups for `/dev/mpp_service`, `/dev/rga`,
`/dev/dma_heap`, `/dev/dri`, and optionally `/dev/mali0`.

To test a seek, run the same command with `-start 6`. To exercise a single
encoder: add `-codec h264` or `-codec hevc`. The output folder is
`~/memories-v11-smoke` unless `RKMPP_SMOKE_OUTPUT` is set.

For 10-bit HEVC HDR samples, run **separately**, and opt into the experimental
Mali HDR path with `-opencl`. The SDR run is the first gate; HDR often needs
additional driver and pixel-format fixes.

## PASS / FAIL interpretation

A valid PASS has two independent results per selected output codec:

1. Rockchip encoder and RGA run to completion, creating a nonempty fMP4 init
   and one or more `.m4s` segments from the actual sample.
2. FFmpeg independently decodes the generated local `.m3u8` playlist.

If the helper prints `source needs CPU decode`, the test has **not** validated
MPP decoding even if hardware encoding succeeded. For the initial full
hardware gate, use an 8-bit 4:2:0 SDR H.264 input and confirm there is no
such warning. Stop and report the exact stderr if a test fails.

Share the command output and source format reported by the helper. Do not
send original private media; send only sanitized logs. A passing smoke check
does NOT authorize upgrading Memories, merging this PR or deployment.

## CI

GitHub Actions checks `go test ./...`, `go vet ./...`, formatting, image
build on ARM64, the go-vod 0.7.0 version and whether both FFmpeg RKMPP
encoders and RGA filters are available **in the image**. CI runners have
no Rockchip VPU or Mali; **only the ROCK 5B+ can validate hardware execution**.
