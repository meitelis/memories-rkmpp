# Memories 11.0.2 RK3588 — active checkpoint

See [PLAYBACK_ACCEPTANCE_V11.md](PLAYBACK_ACCEPTANCE_V11.md) for measured playback evidence and [HARDWARE_TEST_V11.md](HARDWARE_TEST_V11.md) for the reproducible board matrix. Earlier revisions and experiments remain in Git history.

## Required behaviour

- Measure delivery through Nextcloud before startup; prefer compatible Original when measured bandwidth has headroom.
- Adapt to changing throughput and buffer health, recover cautiously, protect cold seeks from false downshifts and keep video at 480p or higher.
- Keep audio independent of video resolution: compatible high/source AAC on normal links and 96/64/32 kbps profiles on weak links, with one sample clock.
- Require MPP video decode/encode, RGA scale/rotation and Mali OpenCL HDR mapping. Fail unsupported video explicitly rather than silently processing video on the CPU.
- Show presented resolution and codec beside the controls; preserve picture, audio and clocks through quality changes and seeks.
- Validate real playback before merging; simplify superseded logic, recheck mainline after merging and preserve unique work before deleting branches.
- Save verified implementation to GitHub. Never commit credentials, private media identifiers, paths or captures.

## Current implementation

Runtime r8 / adapter 1.1.24 is healthy and connected to Memories 11.0.2 through go-vod 0.7.0.

- Copied AAC drops negative priming packets, preventing unsigned MP4 timestamp wrap. The formerly frozen real video subsequently played to 290 seconds.
- Hardware workers use input pacing instead of SIGSTOP/CONT, which had lost in-flight frames. Both encoders pass the 50 fps packet-cadence regression.
- One immutable server plan distinguishes GOP presentation start from decoder keyframe. Copy seeks, hardware trims/IDRs and open-GOP cold starts use the appropriate boundary. The plan is cache-only at startup; a cache miss retains a stable fixed grid for that session.
- Copied B-frame fragments omit DASH sidx continuity rewriting. Playlists preserve fractional presentation durations. Regressions read raw MP4 decode times and composition offsets.
- hls.js owns manual scheduling through nextLevel. The custom prepared-switch/buffer-flush experiment and its feature flag have been removed.
- Startup uses a bounded same-origin speed probe and Original preflight. Forward buffering has a byte limit; cold-seek protection and independent audio adaptation remain active.
- r8 builds the original pinned Jellyfin MPP source with a three-line semantic fix for an absent optional VP8 control callback. All ten input codecs pass to both hardware encoders; the full hardware matrix, Linux checks and final packaging checks pass. No wholesale MPP SDK upgrade is included.

## Acceptance still required

1. Repeat shaped startup and changing mobile throughput on current code. Earlier weak-startup runs had short waits and are not accepted as stall-free.
2. Implement and validate Android native quality selection and startup policy. Its ExoPlayer path does not run the browser adapter; upstream has no quality-list/selection bridge. A native integration needs a compatible APK and web controls without replacing signed upstream assets.
3. Finish audible continuity, real HDR appearance, native-HLS/Safari, public shares, rapid scrubbing, repeated navigation and full-ladder checks. Browser telemetry cannot establish perceptual acceptance.
4. Review, merge and recheck mainline only after acceptance. PRs 6 and 8 are closed and unmerged. Main still contains the older 10.2 baseline; the legacy direct-play branch has unique work to preserve.
