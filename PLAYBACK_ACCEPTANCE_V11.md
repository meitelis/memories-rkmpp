# Playback acceptance checkpoint: 5 November 2026

Do not merge while the reported Android startup/seek failures remain unverified.
Use actual library videos; keep filenames, file IDs, credentials and captures out of Git.

Android blocker: the user reports that the resolution menu is missing in the
native app. Upstream 11.0.2's ExoPlayer bridge exposes no quality list/selection
API, and this repository's adapter targets browser hls.js. See
`PLAYER_INTEGRATION_V11.md`; browser results do not establish native-app coverage.
The user deferred Android playback retesting while work continues.

Resolved reproduced blocker: copied AAC priming produced an invalid unsigned MP4
decode timestamp and a nearly 25-hour browser audio jump. The copy path now drops
negative priming packets without re-encoding audio. The raw-box startup/cold-seek
regression and expanded hardware matrix pass. The previously frozen real video
subsequently played to 290 seconds with a normal audio clock. This covers the
identified timestamp defect, not every possible cause of a two-second freeze.

## Deployment and checks

- Native adapter 1.1.13; runtime image memories-11.0.2-govod-0.7.0-r4.
- All 20 JavaScript regressions pass. Linux Go tests, vet, formatting and ARM64
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

The isolated repeat of the rotated 4K case reached its 23.9-second EOF with zero
recorded waits and zero dropped frames. Fast-network A/B/C/D started at Original
without recorded waits. The corrected Matroska master advertised 28.22 Mbps for
Original, which played rather than using the former 5.6 Mbps budget.

A 20 Mbps cold seek exposed a separate false-downshift defect: after playback
resumed, the old seek timer still counted as an outstanding stalled request.
Adapter 1.1.13 uses that fallback timer only while seeking or unable to play future
pictures. Actual in-flight request age remains active. The regression verifies
both resumed playback and a genuinely stuck seek. Repeating the same live case
kept 1080p, resumed in 1.696 seconds, then returned to normal Auto with zero waits.

## Required repeatable scenarios

| Scenario | Required outcome | Latest status |
| --- | --- | --- |
| Fast-network startup, A-E | Compatible Original selected; playback advances past two seconds | A/B/C/D and MKV selected Original without waits on r4 / 1.1.12; E previously played to 290 s. Final 1.1.13 change affects the seek watchdog. |
| Midpoint and backward cold seeks, A-E | Resume at requested clock without a false network downshift | r4 high-bitrate D retained Original: midpoint 1.219 s, backward 0.270 s, zero waits/quota errors. 1.1.13 fixed and repeated B's false downshift at 20 Mbps. Wider seek coverage remains open. |
| Pause beyond producer idle timeout, then resume | No dead stream or audio reset | E / 1.1.13: paused for over a minute, resumed for 25 s past the old buffer, retained Original/high audio and added no waits. Audible continuity still needs Android confirmation. |
| Original / 1440p / 1080p / all three 480p rates | Retain buffered pictures and shared audio; actual rendition display | E / 1.1.13 Original-to-1440p retained about 9 s of queued video and high/source audio, adding no waits or dropped frames; actual badge changed after queued Original. Full ladder/Android acceptance remains open. |
| Mobile-like delivery: fast -> 800 kbps -> 4 Mbps -> fast | Prompt useful downshift, sustained recovery, no flapping or buffer starvation | r4 / 1.1.12: Original to 480p and back to Original; zero recorded playback waits, including weak-link backward seek (2.623 s seek). Startup probe preceded shaping, so this run does not establish shaped-startup selection. |
| Sustained weak link and recovery | Appropriate independent audio rate, no audio flush on video changes | r4 / 1.1.12 selected reduced audio during restriction, then restored high/source audio; zero recorded playback waits. Audible Android acceptance remains open. |
| Startup with the weak limit already active | Conservative useful rendition without early starvation | Still open: A measured 0.717 Mbps, selected 480p/64 kbps audio and recorded one 275 ms wait. E measured 1.091 Mbps on the nominal 800 kbps link, initially chose a higher 480p rate/96 kbps audio, and recorded a 1.053 s startup wait; later total was two waits / 1.223 s. Do not call weak startup stall-free. |
| Rapid scrubbing / repeat navigation / EOF | No stale requests, stuck two-second playback or endless retries | Pending |
| Badge controls, touch and fullscreen | Compact corner placement; hidden with native controls | Fullscreen DOM bounds put it above controls at the lower right; visibility becomes hidden with the fading controls. Android touch acceptance remains open. |

Record measured waiting time, resolution, decoder cap, buffer, errors and hardware
execution. A zero waiting counter alone does not establish visual/audio acceptance.
Only merge after those failures are resolved; then recheck mainline and clean up branches.

Run `bash scripts/test-v11-network.sh nextcloud 443` on the board for the bounded
mobile profile. This affects that container's IPv4 HTTPS responses to the proxy,
including the speed probe. Internal HTTP bridge traffic remains unshaped. Verify
nonzero shaped-byte counters and actual transfer speeds; a nominal rate alone is
insufficient. The EXIT/INT/TERM handlers restore the original noqueue state.
