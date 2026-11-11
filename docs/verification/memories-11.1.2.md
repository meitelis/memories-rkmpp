# Memories 11.1.2 compatibility

This integration targets the official [Memories 11.1.2 release](https://github.com/pulsejet/memories/releases/tag/v11.1.2), commit `d5830c939e1c819479e397b837ec3830e9af797b`, with go-vod **0.7.1** and helper **1.1.28**.

## Changes required by this release

- Memories' `BinExt::GOVOD_VER` advances from 0.7.0 to 0.7.1. Its external-engine handshake checks that version, so updating only the browser helper is insufficient.
- Apply the complete upstream go-vod 0.7.1 hotfix: detect supported HTTP reconnect options once at startup, use the filtered options for authenticated input and storyboards, and retain its regression test. Older FFmpeg versions otherwise reject unsupported options.
- Permit 11.1.2 in the browser helper listener. The installers target 11.1.2; version guards, health checks, hardware checks, workflow expectations and image labels advance together.
- PR #23 / `local/memories-rkmpp:memories-11.1.2-govod-0.7.1-r11` is the owner-tested 11.1.2 baseline. The follow-up image `local/memories-rkmpp:memories-11.1.2-govod-0.7.1-r12` bounds startup HTTP detection and checks both configured binaries. It retains only the options supported by both, so a newer ffprobe cannot enable unsupported options for an older FFmpeg. Exact option tokens are recognized, including tab-separated help.

The [upstream 11.1.1-to-11.1.2 comparison](https://github.com/pulsejet/memories/compare/v11.1.1...v11.1.2) leaves `PsVideo.ts`, `PsVideoQuality.ts`, `VideoControls.vue` and the video API service unchanged. The viewer's UI visibility fix remains part of the official app. RKMPP/RGA/OpenCL paths, native Auto, Original selection, shared audio, buffers and 3.5x catch-up retain the fork's existing behavior.

## Validation scope

Source validation covers the existing browser/controller suite, Go race tests/vet/build, the upstream HTTP-option regression, template-listener compatibility and installer version/ownership guards. The template listener retains its previously checked 11.0.2/11.1.1 hooks; those official app versions require their matching older engine, and the new installers reject them.

On 11 November 2026, the owner reported that the PR #23 update works on the ROCK 5B+ and authorized merging it. This is an owner report; no new playback trace, exhaustive hardware matrix or perceptual assessment was supplied. The follow-up HTTP-detection cleanup has source/CI coverage and has not been separately exercised on the board.

The existing [live playback record](auto-original-2026-11-10.md) is for **11.1.1**. It is not a live 11.1.2 result. Hardware and browser validation of this revision remain necessary after deployment; CI image construction does not exercise a VPU.

## Deployment

Follow [the existing Portainer procedure](../deployment.md#existing-portainer-stack): update the official Memories app normally, build this revision's engine, change the image in the current stack and install the matching helper. Preserve the existing project, cache, devices and network. Repository changes do not deploy to a server.
