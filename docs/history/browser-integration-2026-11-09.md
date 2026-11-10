> Historical snapshot. Version numbers, acceptance gates and deployment statements below describe that stage of development. Use the [current deployment](../deployment.md), [playback](../playback.md) and [testing](../testing/README.md) guides for main.

# Memories 11.1.1 browser integration — native hls.js Auto

**11.1.1 compatibility scope:** Upstream `PsVideo.ts`, `PsVideoQuality.ts`, `VideoControls.vue`, the player API service and the entire `go-vod/` tree are unchanged from 11.0.2 to 11.1.1. The adapter now explicitly permits both 11.0.2 and 11.1.1; the deployment script accepts only 11.1.1. Server-side and Android upstream changes are maintained by the official Memories update, not copied into this separate adapter. Previous 11.0.2 player measurements are not proof of 11.1.1 hardware playback. This PR incorporates the browser bandwidth-probe correction and regression coverage from PR #17 (identical source and tests); the historical PR #17 remains available for reference.

## Historical native Auto implementation (PR #14)

`memories_rkmpp_v11` uses the unchanged upstream Memories 11.1.1 `PsVideoQuality.ts` hooks and hls.js 1.7.x; it does **not** replace the video tag or the shared audio playlist. This is a browser-only draft pending real-device testing.

## Auto and manual quality

- hls.js is the **only** ABR quality decision engine. `hls.loadLevel = -1` enables real Auto, `hls.loadLevel = index` selects a manual rendition without flushing existing pictures. There is no second controller that writes a pinned Auto resolution every 500 ms.
- Returning from manual 480p to Auto clears the manual pin immediately. A bounded connection measurement refreshes the native hls.js EWMA. When it verifies enough capacity for a higher rendition, `hls.nextLevel = -1` asks the built-in hls.js scheduler for an earlier Auto switch; future video may be rebuffered while the playhead and independent audio continue.
- The initial same-origin probe uses up to 2.2 seconds across at most 64 KiB, 384 KiB and 1.5 MiB sample sizes. Probe failure starts with a conservative bandwidth estimate; no invalid/failed measurement overwrites the current estimate after startup.
- Network changes (where `navigator.connection` is supported), `online`, foreground visibility and `pageshow` initiate recovery checks. Browsers without network-change events use a 20-second maximum recovery interval while playing below the top rendition. Each check downloads at most 128 KiB + 384 KiB. No continual 500 ms synthetic testing.
- hls.js can count RKMPP server-side segment creation before the first HTTP byte as low bandwidth. When **two** observed fragment transfers demonstrate greater link capacity, the helper conservatively updates the public `hls.bandwidthEstimate` EWMA seed. It does not manually select the video resolution.
- hls.js's existing emergency downshift, codec/level selection and FPS-drop capping remain active. An 18-second forward buffer (maximum 96 MiB) and 8-second back-buffer give on-demand producers margin; starvation/loading delay is capped at 6 seconds. These are tradeoffs, not guarantees against stalls.
- Compatible Original remains in the manifest. `direct.m3u8` can initially return 409 while go-vod creates the keyframe copy grid; a bounded background preflight warms that path. Playlist availability is **not** decoder compatibility validation.
- The shared AAC track remains independent of video quality. No automatic audio bitrate switching or audio source reload is introduced. The badge displays **presented** dimensions/codec rather than the requested level.
- Session-scoped aborts and change detection prevent a stale speed probe or Original preflight from modifying a replacement hls.js session. Debug diagnostics expose `hlsAuto`, `hlsManualLevel`, `hlsBandwidth`, `recoveryBandwidth`, fragment transfer, buffer and frame drops.

## Backend

The go-vod 0.7.0 RKMPP engine retains MPP decode/encode, RGA, Mali OpenCL and Original stream copy. Encoded HLS input pacing uses FFmpeg `-readrate 1 -readrate_initial_burst 18 -readrate_catchup 3`. PR #14 also wakes HTTP segment waiters when a stream is cleared instead of allowing them to block until the ten-second chunk timeout.

## Acceptance before merging

Run browser unit tests, Go race/vet/build and ARM64 image checks. Then test on the actual browser player: (1) Wi-Fi Original startup, (2) manual 480p → Auto return, (3) cellular 480p → Wi-Fi recovery, (4) Wi-Fi → cellular downshift without stalling, (5) cold seeking, pause/resume, playback to EOF, AAC continuity and repeated switches. Capture real buffer, throughput and hlsAuto diagnostics. **Green CI does not prove real device playback.**

## Android native player: separate from this release

The official Android app lacks the browser helper's quality hooks. A separate
companion APK now exposes quality choices but has a reported startup failure.
The user explicitly deferred that native app from the server/browser merge.
Its work remains on `import/laptop-2026-11-04`; do not treat it as released.

The pinned upstream 11.0.2 implementation has two distinct playback paths:

- [PsVideo.ts](https://github.com/pulsejet/memories/blob/v11.0.2/src/components/viewer/PsVideo.ts)
  creates `viewer-video-native-hole` when the native capability is available;
  only HTML video receives the hls.js quality hooks.
- [ViewerVideoNativeHole.vue](https://github.com/pulsejet/memories/blob/v11.0.2/src/components/viewer/ViewerVideoNativeHole.vue)
  mirrors position, dimensions, buffering and playback controls, but does not
  expose `qualityList` or `currentQuality` to the stock quality menu.
- [NativeHoleVideo.kt](https://github.com/pulsejet/memories/blob/v11.0.2/android/app/src/main/java/gallery/memories/ui/video/NativeHoleVideo.kt)
  uses ExoPlayer with HLS support. Its command bridge handles play, stop, pause,
  seek, volume, mute and rate; it has no quality-selection command or track list.
- The newer Android shell caches signed upstream web assets rather than the
  normal Nextcloud template. A BeforeTemplateRenderedEvent helper is therefore
  insufficient for that shell as well as for its native player.

The browser adapter deliberately attaches to HTMLVideoElement/hls.js. Do not
claim that its speed probe, policy, rendition badge or quality menu runs in the
native app. ExoPlayer still has its own automatic adaptation; server-side MPP/RGA,
AAC packet-clock and bitrate fixes apply to either client.

A complete native integration must expose ExoPlayer video tracks and Auto/manual
selection through the bridge, report the actually presented format, and change
track-selection parameters on the existing media item without replacing its URL
or resetting shared audio. Native startup bandwidth and buffer policy need their
own verification. Shipping that bridge requires a compatible Android build and
web controls, not a server-only JavaScript injection or an unsigned replacement
of the app's signed asset manifest. Server logs show a native 1.15 client;
the 11.0.2 source tag contains Android 1.17. Do not assume every handset's client
version or shell behavior from the Nextcloud application version alone.
