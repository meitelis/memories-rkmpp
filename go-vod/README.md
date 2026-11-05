# go-vod 0.7.0 for RK3588

The Memories 11.0.2 transcoding service. Build and deploy through `../scripts/deploy-v11.sh`; use `Dockerfile.rkmpp-test` for isolated board validation and `Dockerfile.rkmpp` for the production runtime.

- `api/`: the authenticated 0.7.0 request envelope, HLS playlists and bridge routes.
- `core/`: source probes, immutable segment plans, lazy rendition workers, shared audio and cache/idle management.
- `ffmpeg/`: MPP/RGA/OpenCL arguments, packet clocks, source-grid analysis and regression tests.
- `config/`: service and per-request configuration.
- `cmd/`: offline hardware runner and runtime health check.

Hardware video workers use FFmpeg input pacing. They are never suspended with SIGSTOP, which can lose asynchronous MPP frames. Copy and audio workers retain upstream producer throttling. Strict hardware mode rejects unsupported video rather than silently falling back to CPU video processing; audio processing and fixture generation can use the CPU.

Upstream: [Memories 11.0.2](https://github.com/pulsejet/memories/tree/e156f850ec5514433f1cfac9d4f1dbd461500c8d/go-vod), Apache-2.0. See the root hardware and playback documentation for validated behavior and limits.
