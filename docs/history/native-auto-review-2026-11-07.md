> Historical snapshot. Version numbers, acceptance gates and deployment statements below describe that stage of development. Use the [current deployment](../deployment.md), [playback](../playback.md) and [testing](../testing/README.md) guides for main.

# PR #14: native hls.js Auto — review checklist

Date: 2026-11-07. This is a *draft* browser-player change. The following are thirty focused source/CI checks, not thirty real-device playback trials.

| # | Review aspect | Verified by |
|---|---|---|
| 1 | Native Auto starts with startLevel=-1 and loadLevel=-1 | Source and test |
| 2 | Manual resolution uses hls.loadLevel=index | Source and test |
| 3 | Manual-to-Auto restores hls.loadLevel=-1 | Source and test |
| 4 | No second PlaybackPolicy quality controller | Source |
| 5 | No loadLevel assignments in 500ms update loop | Source |
| 6 | Connection API change event supported | Source |
| 7 | Browser online event triggers recovery | Source |
| 8 | Visibility and pageshow trigger recovery | Source |
| 9 | Network event handlers removed on detach | Source |
| 10 | Recovery rechecks rate limited to 20s | Source and test |
| 11 | Startup/recovery probes abort after 2.2s | Source |
| 12 | Failed probes cannot invent high throughput | Source and test |
| 13 | Stale/aborted sessions cannot change new HLS state | Source and test |
| 14 | Switching modes clears stale fragment samples | Source |
| 15 | Original preflight has a bounded timeout | Source |
| 16 | Original playlist 409 handled by preflight | Source |
| 17 | Network transfer excludes RKMPP pre-first-byte delay | Source and test |
| 18 | Two coherent transfers required for EWMA correction | Source and test |
| 19 | EWMA correction requires 3s video buffer | Source |
| 20 | Public hls.js bandwidthEstimate setter exists in v1.7.4 | Upstream code |
| 21 | Faster switch asks native hls.js for Auto, never pins rung | Source and test |
| 22 | Quality changes leave shared AAC track untouched | Source and test |
| 23 | Native FPS-drop decoder capping remains enabled | Source |
| 24 | Buffer and memory bounds are 18s/8s/96MiB | Source and test |
| 25 | Network-error retry count is bounded | Source |
| 26 | Go stream.clear signals pending chunk waiters | Source and test |
| 27 | Go race/vet/build checks pass | GitHub Actions |
| 28 | Obsolete custom ABR tests removed | Source and CI |
| 29 | Manual 480p-to-Auto and mobile-to-WiFi scenario tests | Source and CI |
| 30 | Isolated ARM64 Docker image build passes | GitHub Actions |

There are 28 Node regression test cases covering the player and helper modules; the Source checks workflow also runs the Go tests, vet, race detector and build.

## Not yet verified

Actual mobile-data-to-Wi-Fi recovery time, downshift timing, startup reliability, Original-to-encoded timestamp continuity, AAC audible continuity, HDR appearance, hardware source/codec acceptance, native Android ExoPlayer and Safari native HLS.

Do not merge to main until the ROCK 5B+ and phone-browser tests establish acceptable quality, stall, seek, and audio behavior. The existing running deployment is unchanged by these GitHub commits.
