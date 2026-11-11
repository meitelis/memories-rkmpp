# go-vod 0.7.1 for RK3588

The engine used by this repository's Memories 11.1.2 integration. The source baseline is [Memories 11.0.2](https://github.com/pulsejet/memories/tree/e156f850ec5514433f1cfac9d4f1dbd461500c8d/go-vod), with upstream 11.1.2 / go-vod 0.7.1 HTTP option detection and this fork's RKMPP and playback changes applied. The upstream Apache-2.0 license is retained.

- `api/`: authenticated request envelope, HLS playlists and bridge routes.
- `core/`: source probes, segment plans, lazy workers, shared audio and cache lifecycle.
- `ffmpeg/`: MPP/RGA/OpenCL arguments, packet clocks, source-grid analysis and regressions.
- `config/`: service and per-request configuration.
- `cmd/`: offline hardware runner and runtime health check.

Build with [scripts/build-v11.sh](../scripts/build-v11.sh). Follow the [deployment guide](../docs/deployment.md) for Portainer or standalone Compose, and the [testing guide](../docs/testing/README.md) for source and board checks.

Hardware video workers use FFmpeg input pacing rather than SIGSTOP suspension, which can lose asynchronous MPP frames. Copy and audio workers retain their separate producer throttling. Strict mode rejects unsupported hardware video; audio processing and fixture generation can use the CPU.
