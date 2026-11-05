# Memories 11.0.2 RK3588 — active checkpoint

Latest deployment/results are tracked in [PLAYBACK_ACCEPTANCE_V11.md](PLAYBACK_ACCEPTANCE_V11.md).
Earlier sections below retain the investigation history.

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

## Delivery-aware adaptation (1.0.7)

- Replaced body-only completed-fragment samples with full request delivery time. Slow responses buffered by a proxy no longer create inflated bandwidth estimates.
- Added protection when a request makes no body progress for two seconds while buffered playback falls below twelve seconds. Recovery estimates rise gradually instead of jumping from one fast burst.
- Seven JavaScript regressions pass, including delayed-response bandwidth/audio selection. Deployed 1.0.7; a fresh 800 kbps live test is in progress.

- Adapter 1.0.9 subtracts a bounded minimum observed request latency from delivery samples so short fragments can demonstrate recovery without ignoring proxy delays. It avoids the no-progress watchdog during the initial three seconds. Local DOM diagnostics now count actual post-start waiting events and duration separately from seeks. Seven JS regressions pass; the new measured Original-to-800 kbps acceptance run is starting.

## Fresh policy replacement (1.1.0)

- User explicitly requested a clean replacement instead of accumulating overrides. Removed the overlapping adaptation heuristics from player.js and added policy.js: a pure PlaybackPolicy with startup, normal and recovering states. hls.js owns ordinary ABR; the policy gates initial quality, rescues a threatened buffer once, and allows recovery one level at a time after sustained healthy buffering.
- Added replay-style regressions for startup versus congestion, delayed proxy bursts, one-shot rescue, slow recovery, pause/seeking/manual selection, encoded-only ladders and decoder limits. All 12 player/policy tests pass; CI now runs both suites.
- The replacement adapter 1.1.0 is installed; live acceptance is underway. Do not claim completion from the policy tests alone.
- Hardware profiling during a transition confirmed both MPP decoder cores active (about 80-88% in sampled bursts), both encoder cores active, and RGA3 schedulers active (sampled about 53-70%). Transcoder CPU use was modest relative to total cores. These driver loads confirm hardware execution; cold-start latency and end-to-end delivery still require measurement. Private raw profiling logs include process headers and must stay outside Git.
- Temporary network shaping and MPP sampling were restored to noqueue and load_interval=0 after the profiling run.

- Live 1.1.0 baseline held Original 1800p with zero waiting events. The 800 kbps run selected 480p/64 kbps audio but recorded one 1.27-second wait. Source review identified that the adapter selected runtime audio with hls.audioTrack (immediate switching), despite hls.js 1.7.4 providing nextAudioTrack for a non-interrupting scheduled switch.
- Adapter 1.1.1 now uses nextAudioTrack during playback, preserving direct audioTrack selection only for startup. A regression rejects immediate runtime audio flushing. All 13 tests pass; live recheck is underway.

## Live result and separate 480p jitter investigation

- With 1.1.1, the settled Original baseline and abrupt 800 kbps run recorded zero playback-wait events. The player selected hardware 480p, scheduled reduced-bitrate audio and retained roughly 17 seconds of buffer. Temporary shaping was automatically removed and noqueue verified. Recovery resumed higher resolutions. This addresses buffer stalls in that test, not every visual defect.
- User reports occasional tiny backward-looking jumps/stutters at 480p. It persisted with Auto disabled at both fixed 400 kbps and fixed 1.3 Mbps. Do not attribute it solely to same-resolution bitrate switching or declare smoothness complete.
- Inspected three actual 480p stream segments: 450 decoded frames, all unique; 449 timestamp deltas exactly 20 ms; keyframes at the expected 3-second boundaries. No repeated frames or backward packet PTS in this captured interval.
- Added opt-in cadence.js diagnostics, enabled by rkmpp_debug in the page query, to record presented-frame backsteps, late frames and seeks locally in DOM data. No pixels, private URLs or tokens are captured. Adapter 1.1.2 is installed for this investigation. The normal player remains free of frame-callback diagnostics unless explicitly enabled.
- Visual 480p jitter remains unaccepted. Mainline merge, post-merge checks and branch cleanup remain pending.

## Finer cadence and stream inspection (1.1.4)

- Added opt-in five-second presentation summaries: display/media intervals, decoder timing, presentation-clock skew and missed callbacks. Reset frame comparisons on play/pause and detect shorter holds. Normal playback still does not enable frame callbacks without rkmpp_debug.
- Fixed 480p / 1.3 Mbps maintained about 18 seconds of buffer with zero playback waits. The finer trace shows mostly regular 20 ms media intervals, with occasional short presentation holds. This does not explain or dismiss the user's reported frequent visual stutters.
- Compared all 450 decoded frames from the earlier low-rate capture against nearby original frames: no reverse frame matches; one ambiguous near-adjacent match. This limited capture is not proof that the entire stream is clean.
- A longer normal-rate 480p capture revealed a missing packet at 168.10 seconds, followed by decoder reference errors. A second capture excluding the newest cache file found another completed segment with 149 rather than 150 frames and a 40 ms sample duration near its beginning. The missing-frame defect requires investigation independently of browser buffering.
- An isolated same-source hardware experiment comparing continuous encoding with repeated process STOP/CONT is running to test whether the server's producer throttling contributes. Do not assume that cause before the comparison completes. Private media and raw diagnostic captures remain outside Git.
- User is comparing the same video on Android to distinguish client presentation from stream defects. No acceptance, mainline merge or branch cleanup yet. All 13 player/policy regressions pass.

## Multi-video regressions and hardware suspension fix

- Android played all three fixed 480p rates smoothly, including switches. Laptop jitter also appeared at 1440p. Do not treat this as proof that all source streams are clean.
- Reproduced frame loss with repeated hardware-process STOP/CONT; the same uninterrupted encode retained all frames. Added FFmpeg input pacing and disabled process suspension for encoded RKMPP HLS video. Copy and audio retain their existing throttling. A new 30-second 50 fps hardware test checks every frame interval and independent segment decoding in both output codecs.
- Linux tests/vet/formatting, ARM64 builds and the complete updated hardware matrix passed. Runtime r2 is deployed, healthy, and passes the real 0.7.0 Nextcloud handshake.
- Replaced manual nextLevel selection with loadLevel: the former discarded future video, reducing about 18 seconds of buffer to under three. The corrected desktop Original-to-1440p handoff retained the buffer with zero waits.
- User reported broader Android failures: unnecessary startup transcoding on fast home Wi-Fi, false 480p drops on seeks, and some clips stuck at two seconds. Exercised four additional real AVC/HEVC videos, including 4K/60 and 44.1 kHz audio. Desktop startup/cold seeks worked, but high-bitrate AVC exposed a buffer quota error and another HEVC clip recorded a short wait. Android acceptance remains open.
- Adapter 1.1.7 adds bounded Original preflight, explicit cold-seek protection, byte-aware buffer settings and proportional policy thresholds. Runtime audio remains independent in manual video mode. The badge now lives above the native controls and inherits their fade. All 17 JS regressions pass; real-media and changing-network retests are underway.
- No mainline merge or branch deletion. See the acceptance matrix for outstanding scenarios, rather than assuming the earlier single-video buffer result covers them.

## Exact two-second freeze reproduced: copied AAC priming

- Checkpoint 2dd18c6 passed all three GitHub workflows. It is not final playback acceptance.
- Reproduced a permanent stop around 2.925 seconds with encoded video while the server had already produced subsequent fragments. Opt-in pipeline diagnostics showed audio's next position near 89,484 seconds, while video's next position was 21 seconds.
- The compatible source AAC copy path retained a priming packet at -1024 samples. With edit lists disabled, FFmpeg wrote unsigned tfdt=18446744073709550592. ffprobe treated it as signed and earlier decode tests missed the browser wrap. Raw box inspection explains the almost-25-hour audio jump.
- Added a copy-path bitstream filter dropping negative priming packets. It keeps source AAC compressed packets unchanged. A real-source check produced tfdt 0, 144384, 288768 for the first three segments; all 421 nonnegative packets matched the source SHA-256 hashes exactly.
- Added a regression checking raw unsigned tfdt as well as ffprobe timestamps, at startup and cold seek. The r3 build and expanded matrix are running; r3 is not deployed yet at this checkpoint.
- The changing-network test also exposed a seek holding buffered Original after the controller had already capped bandwidth. Adapter 1.1.9 fixes that and bounds recovery even while HTMLVideoElement.seeking stays true. Adapter 1.1.10 adds opt-in loader-state diagnostics. All 18 JS tests pass.
- Removed the tiny-probe early exit: the 64 KiB request only warms the connection; the larger samples share the existing 2.2-second/2 MiB bound. Original started in a calibrated 20 Mbps test; a subsequent mixed-network run failed on the AAC wrap above.
- First network attempts had invalid test routing/jitter assumptions and are excluded from acceptance. Verified HTTPS response shaping using source port 443, sufficiently sized token bursts, fixed 80 ms latency and measured byte counters. Independent per-packet jitter reordered TCP and reduced actual delivery far below the nominal cap; it was removed. All completed profiles restored noqueue.
- Added scripts/test-v11-network.sh for a bounded, automatically cleaned-up 20 Mbps / 800 kbps / 4 Mbps / 80 Mbps repeat. It refuses existing traffic control and excludes internal HTTP bridge/database traffic. Final browser and Android acceptance remain pending.

## AAC fix deployed; wider source coverage and bitrate correction

- r3 passed the complete expanded hardware matrix and was deployed. The previously frozen real video played to 290 seconds with normal audio loading; its original failure stopped around 2.925 seconds. The fix applies generally to copied AAC negative priming, not to every possible freeze with similar symptoms.
- Tested eleven additional real library videos covering AVC/HEVC 4K/60, MOV, Matroska, 10-bit SDR, full range, rotation/portrait, AC3 normalization, silence and small native dimensions. All advanced or reached short EOF. A rotated 4K case recorded a 2.06-second wait during concurrent offline testing and needs an isolated repeat; desktop startup drops also remain observations, not proof of smoothness.
- Metadata audit: 77 entries, 63 readable, eleven unreadable source paths and three tiny invalid containers. No media was changed. Actual readable library sources contained no PQ/HLG example; generated HDR checks do not replace real-picture acceptance.
- Found a separate Matroska bandwidth error: absent stream bitrate fell back to 5 Mbps despite measured container bitrate around 25.5 Mbps. r4 now uses positive measured container bitrate before the fallback. Probe cache version 5 refreshes this metadata without discarding unchanged keyframe indexes or storyboards. Added parser/cache regressions.
- r4 passed Linux Go tests, vet, formatting, ARM64 build and the complete isolated hardware matrix; it is deployed healthy and passes the real go-vod 0.7.0 handshake.
- Adapter 1.1.12 makes the first measured audio choice immediately even when tracks are discovered after the probe. Subsequent independent audio switches stay scheduled. All 19 JavaScript regressions pass.
- Changing-network, final desktop scenarios and Android confirmation remain open. No merge or branch deletion until those acceptance failures are resolved.
- A final r4 / 1.1.12 changing-network run downshifted Original to 480p, resumed a backward seek on the restricted link in 2.623 seconds, and recovered Original plus high/source audio. Recorded zero playback waits and one dropped frame over more than four minutes of playback including the seek. The probe ran before shaping; do not count this as shaped-startup verification. Shaped-byte counters were nonzero and cleanup restored noqueue. Counter results do not replace audible/visual Android acceptance.
