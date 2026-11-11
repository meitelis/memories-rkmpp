# Memories 11.1.2 compatibility — 11 November 2026

## Upstream audit

Target: [Memories v11.1.2](https://github.com/pulsejet/memories/releases/tag/v11.1.2), commit `d5830c939e1c819479e397b837ec3830e9af797b`.
Compared with [v11.1.1](https://github.com/pulsejet/memories/compare/v11.1.1...v11.1.2):

- `BinExt::GOVOD_VER` changes from 0.7.0 to 0.7.1. Both the official external-engine handshake and this fork's health executable must use 0.7.1.
- The complete upstream engine delta is applied: extract HTTP options into `ffmpeg/args_http.go`, detect supported reconnect options once at startup, use the detected options for both regular and storyboard input, and bump the engine version. The upstream regression test is retained. This prevents older FFprobe builds from rejecting unsupported HTTP options.
- `PsVideo.ts`, `PsVideoQuality.ts`, `video-controls/VideoControls.vue`, `src/services/API.ts`, and `src/services/video/` are unchanged; upstream still requests hls.js `^1.7.4`. This repository continues testing against pinned hls.js 1.7.4.
- Other server, image-viewer and Android updates belong to the official Memories package. They are not duplicated in the helper.

The helper is 1.1.28 and explicitly permits 11.1.2 as well as its previously audited browser interfaces. The installer and standalone deployment target only 11.1.2. The default runtime tag is `local/memories-rkmpp:memories-11.1.2-govod-0.7.1-r11`.

## Upgrade

Plan a short playback interruption while app and engine versions differ. Back up the current helper and stack definition, and retain the old image. Build the new image before updating the official app:

```sh
sh scripts/build-v11.sh
```

Update the official Memories app to 11.1.2 through Nextcloud. In the existing Portainer stack, set the engine image to `local/memories-rkmpp:memories-11.1.2-govod-0.7.1-r11`, keep image re-pull disabled, and update the stack while retaining its current mounts/devices/network. Then install the matching helper:

```sh
NEXTCLOUD_CONTAINER=nextcloud sh scripts/install-player-v11.sh
```

The installer verifies the version before changing configuration and ends by checking the actual go-vod handshake. Reload Memories and check Auto, Original, manual selection, seeking and audio continuity using [the browser checklist](../testing/README.md#live-browser-checks).

## Source validation

- All 43 browser/controller tests pass against hls.js 1.7.4.
- `go test -race ./...`, `go vet ./...` and `go build ./...` pass on Linux amd64, including the upstream HTTP option detection regression.
- Linux ARM64 cross-builds of the server and health executable pass; the server reports `go-vod 0.7.1`.
- The PHP listener passes all 24 compatibility/route cases; all helper PHP files pass syntax checks.
- Shell syntax and mocked preflight pass for both deployment and helper installation. Unverified versions are rejected before any writes; foreign Compose project ownership remains protected; image defaults match.

## Validation limits

The previous live 11.1.1 playback evidence remains dated as originally recorded. Source checks and builds for this update do not establish live 11.1.2 playback, native Android behavior or HDR/audio quality. No ROCK 5B+ deployment is performed by this repository change.
