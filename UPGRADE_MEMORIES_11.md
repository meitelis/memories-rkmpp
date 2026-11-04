# Memories 11.0.2 RK3588 rebase

**Status: experimental v11 RKMPP server wiring and isolated hardware tests are implemented. Production player validation and deployment are still pending.**

This branch contains two independent Go modules:
- `go-vod/`: existing custom Memories 10.2.0 / go-vod 0.6.3 RKMPP engine, unchanged.
- `go-vod-v11/`: a version-pinned development copy of upstream [Memories v11.0.2 go-vod](https://github.com/pulsejet/memories/tree/v11.0.2/go-vod), protocol **0.7.0**.
- `upstream-v11/go-vod/`: immutable reference snapshot of that upstream source. Do not edit it when implementing RKMPP.

The v11 server enables MPP/RGA with `MEMORIES_RKMPP=1`, negotiates H.264/HEVC from the client codec report, carries source colour metadata, and uses shared normalized AAC when needed. `Dockerfile.rkmpp-test` and `scripts/test-v11-rkmpp.sh` exercise this code in isolation. See `HARDWARE_TEST_V11.md` for reproducible tests and `PLAYER_INTEGRATION_V11.md` for the player boundary. The existing `compose.yml`, player app, Docker release/build scripts, and `preflight.py` still target Memories **10.2.0** and **must not** be used as a v11 deployment plan. An old container may pass a Docker health check but still fail Memories 11's required 0.7.0 handshake.

## Verified from upstream source

- [BinExt.php](https://github.com/pulsejet/memories/blob/v11.0.2/lib/Service/BinExt.php): `GOVOD_VER = '0.7.0'`.
- [go-vod API server](https://github.com/pulsejet/memories/blob/v11.0.2/go-vod/api/server.go): `/bridge` support, bridge file callbacks, init-segment profiles, new request `goVodAddress`.
- [go-vod manager](https://github.com/pulsejet/memories/blob/v11.0.2/go-vod/core/manager.go): new direct HLS/fMP4 codec copy and per-file persistent-reading hooks.
- [PsVideo.ts](https://github.com/pulsejet/memories/blob/v11.0.2/src/components/viewer/PsVideo.ts): native `HTMLVideoElement`, native HLS on Safari, otherwise hls.js and bitrate-aware ABR. **No Vidstack `media-player`**. The existing helper must be rewritten, not injected unchanged.
- [codec.ts](https://github.com/pulsejet/memories/blob/v11.0.2/src/services/video/codec.ts): browser codec probing for h264/hevc/vp9/av1.
- Upstream 11 provides initial-load direct↔HLS failure recovery but intentionally does **not** switch sources after playback has started. Avoid claiming our experimental mid-playback fallback works in v11.

## Porting sequence (keep separate commits/PRs)

1. Run `cd go-vod-v11 && go test ./... && go vet ./... && go build ./...` with Go 1.27. GitHub Actions runs baseline/argument tests automatically. These checks cannot prove FFmpeg RKMPP filters or hardware work.
2. RKMPP dispatch, server wiring, source metadata, pixel-format gating and CPU decode fallback are implemented. The hardware matrix checks fractional-rate GOP boundaries and cached fMP4 init reuse on cold seeks for both encoders. Bitrate limits still need measurements on representative media and concurrent viewers. **Preserve upstream fMP4 init-segment and timestamp behavior**. Do not wholesale replace v11 sources.
3. Mali HDR probes run on the actual source per stream. Container colour tags are reapplied after OpenCL import; otherwise valid PQ/HLG inputs can arrive with an unknown transfer function. The matrix generates PQ/HLG Main10 sources, checks real MPP/RGA/OpenCL encoding and verifies BT.709 8-bit output. Dolby Vision is explicitly rejected by this port, including cached probes. Picture quality and device/browser coverage remain separate checks.
4. Normalized audio uses one shared AAC rendition. The hardware manager test checks its seek clock and ensures video-quality requests do not restart it. Copyable AAC-LC remains muxed as source packet copies. Audible continuity over 100+ browser switches still requires player testing.
5. Update Nextcloud client integration for `PsVideo.ts` / `PsVideoQuality.ts`; prefer contributing upstream patches or version-pinned UI patches over fragile DOM events. Preserve upstream HEVC/AV1/VP9 direct HLS where possible.
6. Integrate v11 image packaging, set `MEMORIES_EXPECTED_APP_VERSION=11.0.2` **only after** compatibility is proven, and publish a separate release tag/Compose file. Keep the original 10.2 service working as rollback.
7. Run test matrix: independent HLS segments & fMP4 init, cold seeks, 4K HEVC SDR/HDR, portrait rotation, audio continuity over 100+ switches, multiple viewers, abrupt network drops, Chrome/Firefox/Safari/mobile, auth tokens and share links.

## Deployment safety

Do **not** edit, build, or deploy the 10.2 release scripts as though they produce 11 support. `go-vod-v11/` is reference source until RKMPP and player work is validated. Keep the production Nextcloud Memories 10.2 app and transcoder unchanged until a coordinated upgrade; do not run an unversioned/latest image.

## Codex handoff

Begin at `go-vod-v11/ffmpeg/args.go`, `filter.go`, `core/manager.go`, `core/stream.go`, and `api/server.go`; compare the existing `go-vod/ffmpeg/rkmpp.go`, `go-vod/ffmpeg/rkmpp_bandwidth_test.go`, `go-vod/core/tonemap.go`, and audio tests. Keep small testable commits. See `go-vod-v11/go.mod` for the required Go toolchain.
