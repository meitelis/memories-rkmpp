# Memories 11.0.2 RK3588 — active checkpoint

## User's required behaviour

1. Measure actual download speed through Nextcloud before starting video.
2. Prefer the original compatible video when measured bandwidth has sufficient headroom. Otherwise select an appropriate hardware-transcoded rendition.
3. Continuously watch throughput and buffered playback time, adapting to changing mobile connectivity. Downshift promptly; upshift only after sustained recovery. Bound buffering and avoid oscillation.
4. Keep audio independent of video resolution. Preserve reasonable compatible audio or normalize it once. Normal links can use approximately 160–256 kbps (reasonable originals up to 320 kbps); severely constrained links should have 64/32 kbps options. These are adaptive bands, not arbitrary hard cutoffs. Video quality switches must not restart or flush the playing audio.
5. Display the resolution actually playing, including Auto, plus meaningful Original/codec status.
6. Require MPP video decoding/encoding, RGA scale/rotation and Mali OpenCL HDR mapping. No silent software-video fallback. CPU audio normalization is necessary and accepted.
7. Review efficiency, logic and code cleanliness; verify real smooth playback before merging. After merging, test mainline again and delete unnecessary branches. **Do not merge while playback is still poor.**
8. Push checkpoints regularly to preserve progress.

## Completed before this WIP checkpoint

- Hardware audit commits 3042c5d and 81a957e passed the board hardware matrix and all three GitHub workflows.
- Memories 11.0.2 is connected to an actual running go-vod 0.7.0 service at the existing internal `memories-rkmpp:47788` address.
- The obsolete Memories 10.2 player helper was disabled. A new version-pinned `memories_rkmpp_v11` native-player adapter is installed and enabled.
- Real Memories playback and PHP bridge reads work. However the user reported poor quality/jitter and missing resolution information: **this is not accepted as finished playback**.
- Added a production Dockerfile and health-check executable, v11 Compose definitions and a deployment script. The runtime image was built successfully, but the original bootstrap container is still running; new backend WIP changes have not yet been deployed.
- Added actual-resolution display and buffer-preserving manual selection to the native adapter. Three focused JavaScript tests pass. Its initial display-size Auto cap is only a temporary prototype and must be replaced by the user-requested bandwidth/buffer policy.
- Started restoring same-codec original HEVC/AVC HLS and making audio shared across all video renditions. Started strict hardware-only server checks.

## Work in progress / required next

- Finish the real startup speed probe and bandwidth/buffer controller; avoid relying only on the upstream default 8 Mbps estimate.
- Complete shared audio for Original and every encoded resolution, plus lower-bitrate audio profiles with matching AAC clocks. Test cold seeks and audio switches; do not introduce sample-rate/channel/priming discontinuities.
- Finish strict hardware handling, including clear failure when Mali HDR probes fail instead of CPU tone mapping.
- Update relevant Go tests for original-copy and always-shared audio; run full Linux tests, vet/build/formatting and the hardware matrix again.
- Deploy the updated backend and native adapter, inspect real browser resolution, buffers, dropped frames, startup, seeks and switching. Use existing media; do not generate another video demo instead of fixing real playback.
- Update the default README/deployment documentation: the root README currently still describes 10.2. A copy is retained as `LEGACY_MEMORIES_10.2.md`; the default Compose has been changed to v11, with the old Compose retained as `compose.10.2.yml`.
- The v11 deployment script must install the new adapter and disable only the old helper. Validate persistent app installation and Docker health.
- Merge only after smooth playback is established, recheck the deployed mainline, then clean up merged/obsolete branches. The legacy direct-play branch has unique old-player commits; preserve that work before removing its branch if it is considered obsolete.

## Working state

- Working branch: `import/laptop-2026-11-04`; `main` is still the older 10.2 baseline.
- Board checkout: `~/memories-v11-audit-20261104`.
- Live bootstrap container: `memories-rkmpp`, using the previously validated 81a957e server/runtime image, on the Nextcloud Docker network.
- Dedicated persistent cache: `memories-rkmpp-v11-cache`.
- Native adapter: `memories_rkmpp_v11` version 1.0.0; old `memories_rkmpp_player` is disabled.
- Live inspection found an SDR HEVC source at 3200×1800, 50 fps with compatible AAC; it was unnecessarily re-encoded and Auto selected full-size HEVC. The original must be available without generational video loss when bandwidth/decoder support allows.
- Existing PRs 6 and 8 were already closed/unmerged. PR 5 contains legacy 10.2 direct-play work. No mainline merge or branch deletion has been performed.

No credentials or private-media contents belong in this repository. Keep diagnostic logs containing private URLs/tokens outside Git.
