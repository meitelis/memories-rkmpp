# Playback acceptance checkpoint: 5 November 2026

Do not merge while the reported Android startup/seek failures remain unverified.
Use actual library videos; keep filenames, file IDs, credentials and captures out of Git.

Resolved reproduced blocker: copied AAC priming produced an invalid unsigned MP4
decode timestamp and a nearly 25-hour browser audio jump. The copy path now drops
negative priming packets without re-encoding audio. The raw-box startup/cold-seek
regression and expanded hardware matrix pass. The previously frozen real video
subsequently played to 290 seconds with a normal audio clock. This covers the
identified timestamp defect, not every possible cause of a two-second freeze.

## Deployment and checks

- Native adapter 1.1.12; runtime image memories-11.0.2-govod-0.7.0-r4.
- All 19 JavaScript regressions pass. Linux Go tests, vet, formatting and ARM64
  image build passed. The complete isolated hardware matrix passed, including
  both encoders, HDR, rotations, cold starts, shared audio and new 50 fps cadence checks.
- r4 uses measured container bitrate when Matroska omits stream bitrate. Probe
  cache version 5 refreshes that budget while preserving unchanged keyframe indexes.
- Initial audio selection now also works when hls.js discovers tracks after the
  speed probe; runtime changes remain scheduled rather than flushing current audio.
- Runtime health and the real Nextcloud go-vod 0.7.0 handshake pass.
- Reproduced an independent hardware defect: 75 seconds encoded continuously
  produced 25 complete 150-frame segments. The identical run with 11 STOP/CONT
  pauses lost a frame. Completed production-cache captures showed the same
  missing-frame pattern. r2 replaces hardware-process suspension with input pacing.

## Real-media baseline before 1.1.7

| Case | Video / audio | Observed desktop result |
| --- | --- | --- |
| A | HEVC 3200x1800, 50 fps; AAC 48 kHz | Original played; fixed 480p at both low and normal rates played with full buffer. User reported frequent laptop jitter but smooth Android playback at all three 480p rates. |
| B | AVC High 2560x1440, about 30 fps; AAC 44.1 kHz | Original played. Forward seek worked; backward cold seek completed in about 830 ms. No waiting events. |
| C | HEVC 3840x2160, 30 fps; AAC 44.1 kHz | Original played. Cold midpoint seek completed in about 1.06 s, preserving Original, with no waiting events. |
| D | AVC Baseline 3840x2160, 60 fps, about 66 Mbps; AAC 48 kHz | Original played and cold seek completed in about 715 ms. Browser bufferFullError occurred: previous seconds-only buffering was excessive for this bitrate. |
| E | HEVC 3840x2160, about 60 fps; AAC 48 kHz | Original played past one minute; one 333 ms wait and a levelLoadError were recorded. Repeat after the preflight/buffer fixes. |

Original-to-1440p manual selection previously cut roughly 18 buffered seconds to
under three. Changing selection to loadLevel preserved about 18 seconds through
the desktop switch, with zero waiting events. It takes effect after queued video.

The Android report is broader than these desktop results: some videos stalled at
two seconds, startup selected 1440p on a fast home link, and seeking caused an
unnecessary 480p drop. Those reports remain acceptance failures until retested.

## Broader real-library coverage after the AAC fix

Inventory covered 77 video entries: 63 were readable (41 AVC, 22 HEVC; 59 AAC,
one AC3 and three silent). Eleven paths were unreadable even from Nextcloud and
three tiny entries were invalid containers; these are separate source-access
issues, not evidence of an encoder freeze. No source files were modified.

Eleven additional real videos advanced beyond startup or reached their short EOF:
4K/60 AVC and HEVC, MOV, Matroska, full-range input, 10-bit SDR, portrait and rotated
sources, AC3 normalization, silent video, and small native dimensions. Several
had desktop startup frame drops. A rotated 4K case completed but recorded a
2.06-second wait while an offline hardware test was also running: repeat it in
isolation before accepting performance. These checks establish broader functional
coverage, not complete visual/audio acceptance. Real-library HDR acceptance is
still open; the generated hardware HDR checks passed.

## Required repeatable scenarios

| Scenario | Required outcome | Latest status |
| --- | --- | --- |
| Fast-network startup, A-E | Compatible Original selected; playback advances past two seconds | Fixed AAC case played to 290 s; repeat final build across baseline |
| Midpoint and backward cold seeks, A-E | Resume at requested clock without a false network downshift | Earlier B/C/D passed; repeat final build and weak-link seek |
| Pause beyond producer idle timeout, then resume | No dead stream or audio reset | Pending |
| Original / 1440p / 1080p / all three 480p rates | Retain buffered pictures and shared audio; actual rendition display | Partial desktop result above; repeat new build |
| Mobile-like delivery: fast -> 800 kbps -> 4 Mbps -> fast | Prompt useful downshift, sustained recovery, no flapping or buffer starvation | Repeat new build through the Nextcloud/probe path |
| Sustained weak link and recovery | Appropriate independent audio rate, no audio flush on video changes | Earlier 1.1.1 run passed waiting counters; repeat new build |
| Rapid scrubbing / repeat navigation / EOF | No stale requests, stuck two-second playback or endless retries | Pending |
| Badge controls, touch and fullscreen | Compact corner placement; hidden with native controls | DOM placement verified; final visual/fullscreen check pending |

Record measured waiting time, resolution, decoder cap, buffer, errors and hardware
execution. A zero waiting counter alone does not establish visual/audio acceptance.
Only merge after those failures are resolved; then recheck mainline and clean up branches.

Run `bash scripts/test-v11-network.sh nextcloud 443` on the board for the bounded
mobile profile. This affects that container's IPv4 HTTPS responses to the proxy,
including the speed probe. Internal HTTP bridge traffic remains unshaped. Verify
nonzero shaped-byte counters and actual transfer speeds; a nominal rate alone is
insufficient. The EXIT/INT/TERM handlers restore the original noqueue state.
