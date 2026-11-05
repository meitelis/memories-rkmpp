# Memories 11.0.2 on RK3588

This branch runs **go-vod 0.7.0** for **Nextcloud Memories 11.0.2** on a ROCK 5B+ with the Armbian 6.1 vendor kernel, Rockchip MPP/RGA and Mali OpenCL. Adaptive player work is in progress; see [PROGRESS_MEMORIES_11.md](PROGRESS_MEMORIES_11.md) for the verified state and remaining checks. Mainline has not yet been merged.

Video uses MPP decoding/encoding, RGA scaling/rotation and Mali OpenCL HDR-to-SDR mapping. Strict hardware mode rejects unsupported sources or failed HDR probes instead of silently running video filters on the CPU. Compatible SDR H.264/HEVC originals can be stream-copied without generational loss. AAC audio processing is independent of video hardware.

The version-pinned `memories_rkmpp_v11` app extends the native Memories player: startup throughput measurement through Nextcloud, buffer-aware quality limits, shared audio across video qualities, lower audio bitrate tracks for sustained weak links, and an actual-resolution/codec badge. hls.js playback is the current integration target; Safari native HLS and public shares require separate validation.

## Deploy on the ROCK 5B+

Requirements: Docker/Compose, the device nodes in `compose.yml`, Nextcloud container `nextcloud` using the LinuxServer paths, and its existing Docker network. Override `NEXTCLOUD_CONTAINER`, `NEXTCLOUD_NETWORK`, `NEXTCLOUD_HOST`, `VIDEO_GID` and `RENDER_GID` for another installation. No host port is exposed.

```sh
git switch import/laptop-2026-11-04
git pull --ff-only
sh scripts/deploy-v11.sh
```

The script checks the installed Memories version, runs Linux Go tests/vet/formatting while building the ARM64 image, builds the production runtime, starts the health-checked Compose service, connects Memories to `memories-rkmpp:47788`, disables the obsolete player helper, installs the v11 adapter and checks the real 0.7.0 handshake. Reload Memories after deployment. Keep personal media, credentials, URLs with tokens and private diagnostic logs outside Git.

## Reproduce validation

```sh
node --test memories_rkmpp_v11/js/player.test.cjs
bash scripts/test-v11-rkmpp.sh --matrix
```

The hardware matrix runs in a separate container, tests real H.264/HEVC encoding, RGA rotation/scaling, Mali PQ/HLG tone mapping, seek timestamps and cached fMP4 init reuse. It does not change Nextcloud configuration. See [HARDWARE_TEST_V11.md](HARDWARE_TEST_V11.md). Real browser playback, weak-link adaptation, audio continuity and seeking must also be measured before accepting a release.

`go-vod-v11/` contains the active server; `upstream-v11/go-vod/` is its immutable reference. The older `go-vod/`, `memories_rkmpp_player/`, `compose.10.2.yml` and release scripts are retained as historical source; see [LEGACY_MEMORIES_10.2.md](LEGACY_MEMORIES_10.2.md). Use `deploy-v11.sh` and the root Compose for Memories 11.
