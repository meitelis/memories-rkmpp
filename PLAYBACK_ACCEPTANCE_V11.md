# Playback acceptance checkpoint: 5 November 2026

Use real library videos as well as generated hardware tests. Keep private media, identifiers, paths, credentials and captures outside Git. Earlier implementation history is retained in prior commits.

## Current state

Server/browser release: runtime r9 / adapter 1.1.25 is deployed and healthy from mainline commit `674a4ee195f9bc7e3303e362ac7e234de3d3253b`. The fresh mainline board run passes all three suites: FFmpeg, core and API, including all ten input codecs to both hardware encoders, HDR, cadence and cold clocks. The real Nextcloud go-vod 0.7.0 handshake passes. Mainline GitHub race/vet/build/formatting and ARM64 image checks pass. A post-deployment HEVC Original check advanced past twelve seconds with zero recorded waits; this is a functional playback check, not perceptual/audio acceptance.

The browser uses hls.js's native nextLevel scheduler. There is no custom preparation/SourceBuffer-flush path or fast-switch preview flag. Twenty-four retained player/policy regressions pass. One server presentation/decode plan handles source alignment and open-GOP cold starts. The copy mux preserves B-frame composition timestamps; generated tests inspect raw MP4 boxes rather than trusting ffprobe's standalone fragment reorder offsets.

## Current browser verification

Adapter 1.1.25 retains a measured network ceiling across startup and runtime. Producer waits and proxy bursts are used for congestion rescue, not as proof of faster capacity. Below the highest available rendition, at least six seconds of healthy buffer and ten seconds of stability permit a bounded 2.2-second / 2 MiB recheck, at most once per fifteen seconds. A fresh result schedules one affordable hls.js auto rendition; source, audio buffers and clock remain intact. Availability/decoder gates do not erase the measured budget.

A real 45-second nominal 800 kbps startup measured 0.66 Mbps and held 480p/64 kbps. At restored 80 Mbps shaping, Original dimensions returned after 33.9 seconds; high audio returned too. Zero waits were recorded through that run. This includes queued video: it is not a claim of an instant quality change.

A fast AVC case measured 359 Mbps and selected Original. Cold backward/forward seeks reported 517/609 ms and retained Original without recorded waits/dropped frames. All 24 browser regressions pass. The preceding prototype recorded one 408 ms wait and was superseded; do not combine its result with the final run.

Native Android is explicitly excluded from this server/browser merge. The separate companion APK shows its new controls but has a reported startup failure. Existing native-app behavior is not validated by these browser checks.

## Verified evidence

| Check | Result and limit |
| --- | --- |
| Linux source checks, r7 | Go tests, vet, formatting and ARM64 packaging pass. All three published GitHub workflows pass. |
| Hardware pipeline, r8 | All ten input codecs pass decoding/RGA and both hardware encoders. VP8 optional-control initialization is fixed in the pinned MPP source. PQ/HLG, cadence, full/cold clocks, shared audio, core serving and API checks pass. |
| Real Original to 1440p, r7 | The 50 fps open-GOP HEVC case changed presented dimensions in 3.047 s; the longer-GOP 4K case took 5.976 s. Neither measured switch added waits, drops or gap errors. Startup drops already present in the hidden browser are excluded from those switch counts. |
| Earlier AVC switching/seeks | 1440p to 1080p changed presented dimensions in 3.775 s; backward/forward cold seeks took 785/801 ms without added waits and retained the selection. Repeat broader coverage on final code. |
| Reproduced two-second freeze | Copied AAC priming wrapped unsigned MP4 decode time. The corrected raw-box regression passes; the previously frozen real video played to 290 s with a normal audio clock. This covers that defect, not every possible freeze. |
| Hardware suspension | SIGSTOP/CONT lost an in-flight frame in a reproduced 75 s run. Input pacing replaces suspension; both hardware encoders pass full 50 fps packet cadence beyond the startup burst. |
| Real-library coverage | Eleven additional real videos advanced past startup or reached EOF: AVC/HEVC, MOV/Matroska, 4K60, full-range/10-bit SDR, rotation/portrait, AC3 and silence. A rotated 4K isolated repeat reached EOF without recorded waits/drops. These are functional checks, not complete visual/audio acceptance. |
| Fast-network startup, earlier adapter | A/B/C/D and Matroska cases selected Original without recorded waits. High-bitrate Original cold seeks retained quality without quota errors. Current Android behavior still needs separate validation. |
| Earlier mobile trace | Fast to 800 kbps to 4 Mbps to fast downshifted/recovered video and independent audio without recorded waits. The speed probe preceded shaping; this does not establish weak-link startup. |
| Weak-link startup | One case measured 0.717 Mbps, selected 480p/64 kbps and had a 275 ms wait. Another measured 1.091 Mbps on nominal 800 kbps, selected a higher 480p rate/96 kbps and had a 1.053 s startup wait. Not accepted as stall-free. |
| Pause/resume, earlier adapter | A real Original resumed beyond a minute-long producer timeout and played 25 s beyond its old buffer without recorded waits or quality/audio resets. Audible continuity remains open. |
| Resolution badge | DOM dimensions/codec reflect presented output. Fullscreen placement is above the lower-right controls and fades with them. Native Android is a separate gap. |

## Additional coverage and deferred clients

| Scenario | Required outcome |
| --- | --- |
| Fast home-network startup across representative sources | Compatible Original selected; progress beyond two seconds; normal audio clock. |
| Weak startup; abrupt throughput drop and recovery | Useful >=480p selection, appropriate independent audio, bounded recovery, no oscillation or starvation. Run shaping before the initial probe. |
| Original, encoded resolutions and all three 480p rates | Actual presented quality displayed; bounded switches with continuous clocks/audio. Include AVC/HEVC output and source/container diversity. |
| Cold seeks, rapid scrubbing, repeat navigation and EOF | Requested clock resumes; no false downshift, stale request or endless retry. |
| Android native app | Explicitly deferred from this release. The companion exposes controls but has a reported startup failure; work remains on the separate branch. |
| Audible/perceptual checks | No clicks, drift or picture jitter; real HDR colors acceptable. Hidden-browser drop counters alone cannot establish this. |
| Other clients/authentication | Native-HLS/Safari and public shares work with appropriate fallbacks. |
| Final integration | Server/browser scope is merged separately; retest the mainline deployment and preserve unique work during branch cleanup. |

Run `bash scripts/test-v11-rkmpp.sh --matrix` for the isolated hardware gate and `node --test memories_rkmpp_v11/js/*.test.cjs` for browser regressions.

`bash scripts/test-v11-network.sh nextcloud 443` runs a bounded mobile profile on the board. It shapes that container's IPv4 HTTPS responses, including the speed probe; internal bridge traffic stays unshaped. Verify shaped-byte counters and actual rates. EXIT/INT/TERM handlers restore the original noqueue state. No shaping is currently active.
