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

## Adaptive implementation checkpoint

- Implemented bounded startup throughput probing through Nextcloud, bandwidth/headroom selection, buffer exhaustion prediction and delayed quality recovery in the native adapter (1.0.1).
- Added independently selected 192/high, 96, 64 and 32 kbps shared audio profiles; complete compatible stereo 48 kHz AAC may keep source packets. Normalized profiles restart on the global AAC frame grid.
- Added 240p/360p hardware renditions and an encoded fallback for small originals while their copy grid is pending.
- Linux ARM64 Go tests, vet, formatting and server/test-image builds passed for the first adaptive backend iteration. Five focused JavaScript regression tests pass. The subsequent small fallback/profile-test changes still need the next Linux build.
- Production runtime build succeeded. Hardware matrix and live adaptive-player validation are in progress; this checkpoint is not acceptance of smooth playback.
- Replaced stale default documentation with the v11 deployment path; removed the duplicate v11 Compose file. No merge or branch cleanup yet.

## 5 November checkpoint: AAC clock corrected, 480p minimum

- Saved the adaptive WIP as GitHub commit 8f6e1f3. All three GitHub workflows passed for that checkpoint; its hardware AAC failure was recorded rather than hidden.
- Corrected normalized AAC cold seeks: retain encoder preroll internally, discard its packets before publishing the requested global AAC frame boundary. The complete board hardware matrix passed after this correction, including all four audio profiles on the same sample clock.
- User clarified that 480p is the minimum desired video resolution. Removed 240p/360p. Added lower-bitrate 480p variants for weak links, retaining the independent 96/64/32 kbps audio options.
- Added an auto codec policy to preserve compatible SDR AVC originals and keep their encoded ladder on AVC. HEVC originals remain HEVC when the browser supports them; forced AVC/HEVC options remain available.
- The 480p-minimum build passed Linux tests/vet/formatting and the video/HDR/shared-audio hardware checks; final API testing and deployment are running. Real browser acceptance is still pending. No mainline merge or branch deletion.

## Live integration fixes after 82534ff

- The 480p-minimum backend and adapter were deployed successfully, including the persisted Nextcloud app upgrade and real 0.7.0 handshake.
- Live startup exposed an ordering bug: do not abort an in-flight manifest while holding fragments for the speed probe. Added a regression test that parses the manifest and resumes loading.
- Prevent buffer-driven Auto downshifts while paused. Fixed audio URI matching. Renamed low-rate video profiles to alphanumeric labels accepted by upstream segment/init parsers; the hardware API test now fetches both profiles explicitly. The expanded board matrix passed and the corrected backend was deployed.
- Existing real video reached Original HEVC 3200×1800 with about 18 seconds buffered and source audio copied once. This verifies the no-generational-video-loss path, not final smoothness acceptance.
- A backend replacement during the live manual-switch test interrupted requests; the native player stayed stopped after a fatal network error. Added bounded retries that resume from the current clock without replacing the media source or flushing shared audio. Adapter 1.0.4 is being installed for stable-server and constrained-link validation.
- Mainline merge and branch cleanup remain pending real playback acceptance.

## Constrained-link acceptance test

- Stable-server manual Original-to-1080p switching continued with shared audio and a full buffer. Original video remained stream-copy; hardware renditions use MPP/RGA.
- A 50-second 800 kbps limit was applied only inside the transcoder container network namespace, then automatically removed. The player downshifted to 480p but stalled during the gradual descent. This is a failed acceptance case, not smooth-playback completion.
- Adapter 1.0.5 adds faster emergency descent (halving the level cap when the buffer is draining, minimum level when under three seconds) and samples in-flight transfer progress instead of waiting for a complete large fragment. Six JS regressions pass; live retesting is ongoing.
- Network shaping was removed and the original noqueue configuration verified. Main is still unmerged.

- The second 800 kbps test still stalled with the cap already at minimum: a large old-quality fragment remained in flight. Added emergency loader cancellation/resume using the existing media buffers (adapter 1.0.6). This change is awaiting live verification; do not mark smooth bandwidth adaptation complete or merge yet. Both temporary network limits were automatically removed and noqueue verified.

## Latest live result: adapter 1.0.6 / cd524b4

- Third 800 kbps test reached hardware 480p and automatically recovered to Original 3200x1800 HEVC after bandwidth returned. Buffer starvation was still observed during the drop, so constrained-link smoothness is NOT accepted.
- Temporary shaping was automatically removed; verify noqueue before further tests. Backend remains healthy. Native adapter installed version: 1.0.6.
- Next investigation: body-only transfer estimates stay unrealistically high when a proxy delays the response. Include effective request delivery time/progress in adaptation, with deliberate handling of cold-transcode latency. Confirm real audio bitrate changes on a sustained weak link; the observed audio remained the high/source track.
- Stable Original-to-hardware-1080p switching worked with shared audio retained. Audible clicks, long repeated switching, cold seeks in the live browser, mobile/Safari/public-share coverage, and HDR picture quality still need acceptance. Do not merge or delete working branches before this is resolved.
