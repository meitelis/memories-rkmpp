# Playback acceptance checkpoint: 5 November 2026

Use real library videos as well as generated hardware tests. Keep private media, identifiers, paths, credentials and captures outside Git. Earlier implementation history is retained in prior commits.

## Current state

Runtime r8 / adapter 1.1.24 is deployed and healthy. The real Nextcloud go-vod 0.7.0 handshake passes. r8 changes only MPP packaging: the original pinned SDK receives a small optional VP8-control fix. All ten input codecs pass to both hardware encoders; the complete board matrix and Linux checks pass. The final runtime contains the byte-identical tested MPP library and independently passes VP8-to-H.264/HEVC checks without errors.

The browser uses hls.js's native nextLevel scheduler. There is no custom preparation/SourceBuffer-flush path or fast-switch preview flag. Twenty retained player/policy regressions pass. One server presentation/decode plan handles source alignment and open-GOP cold starts. The copy mux preserves B-frame composition timestamps; generated tests inspect raw MP4 boxes rather than trusting ffprobe's standalone fragment reorder offsets.

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

## Remaining release gates

| Scenario | Required outcome |
| --- | --- |
| Fast home-network startup across representative sources | Compatible Original selected; progress beyond two seconds; normal audio clock. |
| Weak startup; abrupt throughput drop and recovery | Useful >=480p selection, appropriate independent audio, bounded recovery, no oscillation or starvation. Run shaping before the initial probe. |
| Original, encoded resolutions and all three 480p rates | Actual presented quality displayed; bounded switches with continuous clocks/audio. Include AVC/HEVC output and source/container diversity. |
| Cold seeks, rapid scrubbing, repeat navigation and EOF | Requested clock resumes; no false downshift, stale request or endless retry. |
| Android native app | Restore Auto/manual quality controls and actual rendition display; native startup and adaptation must be tested through ExoPlayer. Browser tests do not cover it. |
| Audible/perceptual checks | No clicks, drift or picture jitter; real HDR colors acceptable. Hidden-browser drop counters alone cannot establish this. |
| Other clients/authentication | Native-HLS/Safari and public shares work with appropriate fallbacks. |
| Final integration | Review clean logic, merge only after acceptance, retest mainline, then remove obsolete branches while preserving unique work. |

Run `bash scripts/test-v11-rkmpp.sh --matrix` for the isolated hardware gate and `node --test memories_rkmpp_v11/js/*.test.cjs` for browser regressions.

`bash scripts/test-v11-network.sh nextcloud 443` runs a bounded mobile profile on the board. It shapes that container's IPv4 HTTPS responses, including the speed probe; internal bridge traffic stays unshaped. Verify shaped-byte counters and actual rates. EXIT/INT/TERM handlers restore the original noqueue state. No shaping is currently active.
