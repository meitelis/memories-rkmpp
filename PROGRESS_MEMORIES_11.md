# Memories 11.0.2 RK3588 status

The mainline release contains the go-vod 0.7.0 server and browser integration only. Native Android is explicitly deferred and its unmerged work remains on `import/laptop-2026-11-04`.

## Implementation

- MPP decoding/encoding, RGA scaling/rotation, Mali PQ/HLG mapping and explicit failure for unsupported hardware video.
- Compatible Original stream copy; one codec and presentation/decode plan across the adaptive video ladder.
- Copied AAC priming correction, independent high/96/64/32 kbps profiles and shared sample clocks.
- Input pacing instead of hardware-process suspension; raw MP4 clock and 50 fps packet-cadence regressions.
- A measured network budget gates startup and runtime quality. Buffer warmup, encoder wait time and proxy bursts cannot raise that budget. Healthy lower renditions trigger bounded remeasurement and a scheduled hls.js auto selection.
- Network budget, Original availability and decoder limits remain separate. Manual video choices and cold seeks retain shared audio and the playing media source.

## Evidence

The fresh mainline r9 board matrix passes all ten input codecs to both hardware encoders, PQ/HLG, RGA, cadence, full/cold clocks, core serving and API checks. Browser adapter 1.1.25 passes 24 regressions. Mainline race tests, vet, formatting, build and ARM64 image checks pass.

A real 0.66 Mbps startup selected 480p/64 kbps. After restoring fast delivery, presented Original returned in 33.9 seconds and high audio followed, with zero recorded waits through the measured run. A fresh fast-network AVC case selected Original; backward/forward cold seeks reported 517/609 ms without waits, dropped frames or a quality downshift. Earlier Original-to-1440p repeats took 3.047/5.976 seconds without added waits/drops.

Mainline commit `674a4ee195f9bc7e3303e362ac7e234de3d3253b` was deployed from a fresh checkout on 5 November 2026. Runtime r9 is healthy, the real Nextcloud go-vod 0.7.0 handshake passes, and a post-deployment HEVC Original check advanced past twelve seconds with zero recorded waits. No network shaping remains active.

PR #9 is merged. The merged integration and old optimization branches were deleted. The obsolete 10.2 draft PR #5 was closed; its unique historical commits remain on its branch. Native Android work is preserved separately. See [playback acceptance](PLAYBACK_ACCEPTANCE_V11.md) for limits and [hardware tests](HARDWARE_TEST_V11.md) for reproduction.

## Separate work

The Android companion compiled and exposed its quality menu, but the user reported that video did not play. It is not included in this merge. Audible continuity, real HDR appearance, Safari/native HLS and public-share coverage remain separately documented limits; browser counters alone cannot prove perceptual acceptance.
