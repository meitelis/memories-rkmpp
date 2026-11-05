# Memories 11.0.2 RK3588 — active checkpoint

See [PLAYBACK_ACCEPTANCE_V11.md](PLAYBACK_ACCEPTANCE_V11.md) for measured playback evidence and [HARDWARE_TEST_V11.md](HARDWARE_TEST_V11.md) for the reproducible board matrix. Earlier checkpoints remain in Git history.

## Required behaviour

- Measure delivery through Nextcloud before startup; prefer compatible Original when measured bandwidth has headroom.
- Follow throughput and buffer health as mobile connectivity changes. Recover quality cautiously, avoid false downshifts after seeks and keep video at 480p or higher.
- Keep audio independent of video resolution. Preserve reasonable compatible AAC; use high/96/64/32 kbps tracks as bandwidth warrants, retaining a shared sample clock.
- Require MPP video decode/encode, RGA scale/rotation and Mali OpenCL HDR mapping. Unsupported video must fail explicitly rather than silently use CPU video processing.
- Show the presented resolution and codec with the native controls; keep switches, seeks and audio continuous.
- Validate real playback before merging, simplify superseded logic before that merge, then test mainline again and remove obsolete branches while preserving unique work.
- Save progress to GitHub regularly. Never commit credentials, private media paths, identifiers or captures.

## Current deployment

- Working branch: `import/laptop-2026-11-04`. Main still contains the older 10.2 baseline; do not deploy that baseline into Memories 11.
- Memories 11.0.2 communicates with go-vod 0.7.0 through the existing internal transcoder address. Runtime r5 is healthy and its real Nextcloud handshake passes.
- Adapter 1.1.23 is installed. Ordinary URLs retain the conservative buffer-preserving quality switch. Faster manual switching remains restricted to the explicit `rkmpp_fast_switch` preview flag.
- Nextcloud 35 gives JavaScript a server-version cache URL. Deployment now advances its template asset cache after copying the adapter so browsers receive the installed code.
- PRs 6 and 8 are closed, unmerged. No merge or branch deletion has been performed. The legacy direct-play branch contains unique work and must be preserved before any cleanup.

## Verified changes

- Fixed copied AAC negative priming wrapping the unsigned MP4 decode clock. The reproduced frozen real video played to 290 s afterward. This fixes the identified timestamp defect, not every possible freeze.
- Replaced SIGSTOP/CONT for hardware video with input pacing after reproducing lost in-flight frames. The 50 fps full-packet cadence regression passes for both hardware encoders.
- Added independently scheduled audio profiles, bounded startup probing and Original preflight, byte-limited buffers, source-bitrate fallback for Matroska and seek-specific congestion protection.
- Source-aligned RKMPP HLS uses one immutable cached keyframe plan, explicit IDRs and blocking packet retrieval. It preserves fractional source PTS, keeps AAC separate, never scans at playlist startup and keeps a stable fixed-grid fallback after a cache miss.
- Linux tests, vet, formatting, ARM64 packaging and the complete r5 board matrix pass. The published source-alignment checkpoint passed all three GitHub workflows. All 29 current JavaScript regressions pass.
- Fresh-code real tests: HEVC Original-to-1440p reported 4.079 s with no waits; AVC 1440p-to-1080p changed presented dimensions in 3.775 s with no added waits/drops. Aligned AVC backward/forward cold seeks took 785/801 ms and retained the selected resolution.

## Active investigation

The 50 fps HEVC source exposes an Original-copy composition-timestamp offset. The preview guard refuses an unsafe early cut and falls back, preserving playback but leaving a slow switch. An isolated raw-MP4 check identifies MOV's DASH/sidx continuity handling as rewriting later fragment PTS. A minimal `skip_sidx` change for copied video and generated AVC/HEVC B-frame startup/cold regressions are being validated; this change is not deployed yet. Do not compensate for this in the player.

## Remaining acceptance and integration

1. Finish the copy B-frame timestamp regression, repeat real source-aligned Original/encoded switches and confirm presented dimensions and audio continuity rather than only loader events.
2. Repeat weak-startup tests: previous nominal 800 kbps runs included 275 ms and 1.053 s waits and are not accepted as stall-free. Keep network limits temporary and verify their removal.
3. Validate native Android playback and controls. The browser adapter does not control ExoPlayer; upstream exposes no quality-list/selection bridge. A compatible Android/web bridge is required. The user deferred handset QA while server/browser testing continues.
4. Complete real-library HDR perceptual checks, native-HLS/Safari and public-share coverage, repeated switching, long pause/resume and audio continuity checks.
5. Remove superseded experiments and review the final pipeline/controller as coherent logic before merging. Re-run affected checks, merge only after acceptance, then recheck mainline and clean up branches.
