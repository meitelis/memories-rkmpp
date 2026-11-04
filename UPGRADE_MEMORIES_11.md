# Memories 11.0.2 RK3588 rebase

**Status: baseline staged, hardware port NOT IMPLEMENTED. Do not deploy this branch.**

This branch contains two independent Go modules:
- `go-vod/`: existing custom Memories 10.2.0 / go-vod 0.6.3 RKMPP engine, unchanged.
- `go-vod-v11/`: a version-pinned starting copy of upstream [Memories v11.0.2 go-vod](https://github.com/pulsejet/memories/tree/v11.0.2/go-vod), protocol **0.7.0**.
- `upstream-v11/go-vod/`: immutable reference snapshot of that upstream source. Do not edit it when implementing RKMPP.

This is not yet a working RK3588 release. The v11 module is stock upstream without Rockchip acceleration. The existing `compose.yml`, player app, Docker release/build scripts, and `preflight.py` still target Memories **10.2.0** and **must not** be used as a v11 deployment plan. An old container may pass a Docker health check but still fail Memories 11's required 0.7.0 handshake.

## Verified from upstream source

- [BinExt.php](https://github.com/pulsejet/memories/blob/v11.0.2/lib/Service/BinExt.php): `GOVOD_VER = '0.7.0'`.
- [go-vod API server](https://github.com/pulsejet/memories/blob/v11.0.2/go-vod/api/server.go): `/bridge` support, bridge file callbacks, init-segment profiles, new request `goVodAddress`.
- [go-vod manager](https://github.com/pulsejet/memories/blob/v11.0.2/go-vod/core/manager.go): new direct HLS/fMP4 codec copy and per-file persistent-reading hooks.
- [PsVideo.ts](https://github.com/pulsejet/memories/blob/v11.0.2/src/components/viewer/PsVideo.ts): native `HTMLVideoElement`, native HLS on Safari, otherwise hls.js and bitrate-aware ABR. **No Vidstack `media-player`**. The existing helper must be rewritten, not injected unchanged.
- [codec.ts](https://github.com/pulsejet/memories/blob/v11.0.2/src/services/video/codec.ts): browser codec probing for h264/hevc/vp9/av1.
- Upstream 11 provides initial-load direct↔HLS failure recovery but intentionally does **not** switch sources after playback has started. Avoid claiming our experimental mid-playback fallback works in v11.

## Porting sequence (keep separate commits/PRs)

1. Run `cd go-vod-v11 && go test ./... && go vet ./... && go build ./...` with Go 1.27. The v11 baseline workflow added in this branch should do this automatically.
2. Port RKMPP FFmpeg backend: encoder selection, RKMpp decode, RGA scaling/rotation, GOP/keyframes, bitrate limits, per-rendition frame probe, and clean fallback on unsupported hardware/pixel formats. **Preserve upstream fMP4 init-segment and timestamp behavior**. Port actual code/tests from the older module incrementally; don't wholesale replace v11 sources.
3. Port HDR10/PQ & HLG Mali OpenCL tone mapping with strict hardware-frame probes. Explicitly test 10-bit HEVC NV15, Dolby Vision unsupported, audio-only streams, and failed encoder paths.
4. Reassess custom continuous AAC audio: upstream 0.7.0 changed container formats. HLS must use a stable audio timeline independent of quality switches. Don't assume muxed AAC with equal bitrates is glitch-free.
5. Update Nextcloud client integration for `PsVideo.ts` / `PsVideoQuality.ts`; prefer contributing upstream patches or version-pinned UI patches over fragile DOM events. Preserve upstream HEVC/AV1/VP9 direct HLS where possible.
6. Integrate v11 image packaging, set `MEMORIES_EXPECTED_APP_VERSION=11.0.2` **only after** compatibility is proven, and publish a separate release tag/Compose file. Keep the original 10.2 service working as rollback.
7. Run test matrix: independent HLS segments & fMP4 init, cold seeks, 4K HEVC SDR/HDR, portrait rotation, audio continuity over 100+ switches, multiple viewers, abrupt network drops, Chrome/Firefox/Safari/mobile, auth tokens and share links.

## Deployment safety

Do **not** edit, build, or deploy the 10.2 release scripts as though they produce 11 support. `go-vod-v11/` is reference source until RKMPP and player work is validated. Keep the production Nextcloud Memories 10.2 app and transcoder unchanged until a coordinated upgrade; do not run an unversioned/latest image.

## Codex handoff

Begin at `go-vod-v11/ffmpeg/args.go`, `filter.go`, `core/manager.go`, `core/stream.go`, and `api/server.go`; compare the existing `go-vod/ffmpeg/rkmpp.go`, `go-vod/ffmpeg/rkmpp_bandwidth_test.go`, `go-vod/core/tonemap.go`, and audio tests. Keep small testable commits. See `go-vod-v11/go.mod` for the required Go toolchain.
