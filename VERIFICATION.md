# Verification: Memories 10.2.0 / go-vod 0.6.3

## R7 / helper 0.3.3

The R7 source passed the full Linux ARM64 Go race suite, go vet, formatting and image build on the ROCK 5B+. Its 40-case synthetic matrix passed across 480p, 720p, 1080p, 1440p and 2160p in HEVC and H.264, including startup, cold middle/end and eight concurrent requests for each cold startup. These tests use strict independent fragment decoding and leave the source unchanged.

Compatible mono/stereo AAC-LC at 44.1/48 kHz and up to 256 kbps is preserved. Four R6 warm/cold audits, spanning both sample rates and video codecs, retained identical AAC packets and matching video clocks after explicit HLS child-muxer timestamp handling. Eighteen real-source fragments also passed strict decoding in that revision.

Real-video comparison found a 384 kbps AAC source that required normalization, unlike the approximately 160 kbps copied sources. R7 gives normalized audio one lazy HLS rendition per playback manager. All video qualities reference it and their FFmpeg jobs omit audio. It uses no video hardware context, follows existing backpressure/idle cleanup, and pads a shorter audio source only to the video end.

Four synthetic shared-audio scenarios passed: full-length and short PCM audio with both video codecs. Startup, middle, cold audio seeks, silent tails, strict decoding, unchanged audio across 480p/4K changes and eight concurrent audio requests were checked. A real high-bitrate AAC source also passed shared-track and strict-decoding checks across 480p/4K in both codecs. Authentication and codec queries remain on the audio playlist and its segments.

Twenty-four JavaScript regressions and six PHP connection-test contract checks pass. Twelve Linux mock-Docker deployment tests cover first install, updates, backups, cleanup, failures and locks. The updater also passed inspection against the running Nextcloud 35 API; real activation remains a deployment check.

Live R6/helper 0.3.2 browser checks reached every quality through true 3840×2160. In timed manual samples the media clock advanced normally and readyState stayed at 4. The connection test worked through the authenticated Nextcloud route. The top-right gear and closing the dialog were checked after correcting Nextcloud’s native-dialog style override.

Helper 0.3.3 additionally preserves a seek that has not yet reached reactive player state, suppresses delayed autoplay while retaining an intentionally paused asset, and restores upstream autoplay on user play or another asset. Muxed audio uses the non-flushing loadLevel policy; a separate audio track permits nextLevel video-only switching. Clocks/captions do not trigger the settings toolbar observer.

The release image bundles the connector and updater without adding a runtime process, Docker socket or Nextcloud write mount. Runtime test files are excluded. The one-command host deployment waits for engine health before installing the bundled connector. Log rotation bounds container logs to three 10 MB files. The connector uses persistent Nextcloud app storage and currently declares Nextcloud 35 compatibility.

R7 live rollout and audible Windows Chrome verification are still pending. The user reported intermittent clicks on Windows Chrome with laptop speakers in R6, especially 480p-to-4K, and almost none on Android. Packet/decoder tests do not establish an audible result on that laptop. Native HLS buffering remains controlled by the browser and upstream player. No universal click-free, zero-lag or 100% VPU-utilization claim is made.
## R5 performance and recovery checks

These completed checks refer to R5 revision `6c24d65d5108328dedc9cc141a72a635e0b95f03`, before the current audio/settings candidate.

The R5 source passed the full Go race suite, go vet, formatting checks and the ARM64 image build on the ROCK 5B+. The four player regression tests also passed.

Forty synthetic fragment cases passed across 480p, 720p, 1080p, 1440p and 2160p in both HEVC and AVC: startup, cold-middle, cold-end and concurrent startup. Each of ten concurrent groups requested the same cold fragment eight times and received identical valid output. Independently decoded fragments matched the playlist dimensions; the synthetic source stayed unchanged. The six-second startup fragment's first byte arrived in 0.91–1.91 seconds on this host and local test network.

Eighteen further startup/middle/end fragments from three real Nextcloud sources passed through Nextcloud's authenticated HTTP media input and independent strict decoding in both codecs. Private source names, identifiers and service tokens are excluded from the report.

See [the R5 report](verification/r5-summary.json) for the backend measurements and their limits; its browser observations include true 3840×2160 playback with helper 0.2.6. These are validation measurements, not a before/after throughput benchmark or a guarantee of zero rebuffering on every device or network. The R5 changes retain the existing video pipeline, bitrate limits, shared rendition clock, codec negotiation and idle limits.

## Earlier R4 verification

The R4 build was tested on a ROCK 5B+ with Armbian's vendor 6.1 kernel. See [the R4 report](verification/r4-summary.json) for sanitized results. The R3 report retains the earlier browser, ladder and transition measurements.

## R4 checks

- Formatting, Go race tests, go vet and the ARM64 container build passed. Four player regression tests and PHP syntax checks passed.
- All 63 library videos passed 180 independently decoded HEVC startup, cold-middle and cold-end fragments. Actual dimensions matched the HLS declarations. Source sizes and modification times stayed unchanged.
- Twenty-four synthetic HDR10/PQ and HLG cases passed through go-vod's automatic Mali OpenCL selection: landscape and 90-degree portrait, HEVC and AVC, and startup/middle/end cold requests. Four further original-size HDR rendition checks passed. Outputs were 8-bit BT709 SDR, matched advertised dimensions and decoded strictly without errors.
- Both an explicitly disabled GPU path and a deliberately unavailable OpenCL runtime produced valid fallback output with MPP video encoding. A real one-frame probe selects GPU tone mapping per rendition, rather than trusting device/filter listings.
- A synthetic H.264 High 10 source decoded with MPP, scaled with RGA and encoded with MPP: 60 frames, zero decode errors.
- New regressions reproduced and cover repeated shutdown blocking, a version-guard race, overlapping scratch/cache paths, partial cache publication, failed encoder recovery, failed-probe scratch leaks, destroyed-manager reuse, missing lower renditions on unusual aspect ratios and invalid chunk requests.

## Earlier playback checks

R3 passed eight AVC/HEVC ladder scenarios with 72 fragments and ten synthetic orientation cases including 0, 90, -90, 180 and the 270 alias. Colored quadrants matched FFmpeg autorotation after asserting the fixture rotation.

In a real browser, portrait quality labels showed 1080p, 720p and 480p. Displayed frames changed from 1080×1920 to 720×1280 and back. Returning to Auto continued playback and reached the end without a persistent freeze or fatal media error. The browser recorded nonfatal bufferSeekOverHole and bufferStalledError events and recovered; this does not establish zero brief rebuffering on every browser or network.

R3 transition checks measured video boundaries within 21.333 ms and audio boundaries within -58.666/+24 ms. A 25-second pause followed by a cold encoder restart resumed in 1.443 seconds. These are historical R3 measurements, not R4 performance benchmarks.

The 0.2.4 player removed an artificial display-density ceiling. Android playback was confirmed above 720p after reloading. The 0.2.5 helper retains that behavior and fixes URL-path matching when query strings are present.

With the 0.2.5 helper, manual quality changes retained buffered video and applied to newly loaded fragments. A visible change could take up to the buffered duration, normally about 12 seconds. This describes the earlier `loadLevel` policy; the current helper uses the fragment-preserving `nextLevel` policy described above.

## Limits

All 63 real library sources were SDR. HDR10/PQ and HLG coverage uses synthetic fixtures, not a real-camera HDR collection or a display-calibrated colour comparison. Dolby Vision rendering remains unvalidated. HDR is tone-mapped to SDR, not passed through as HDR.

Supported video uses MPP decode, RGA scale/rotation, Mali tone mapping when needed, and MPP encode. Unsupported profiles can require CPU decode and tone mapping; audio and preview generation still involve CPU work. There is no software video-encoder fallback. GPU tone mapping is skipped for SDR.

Independent HLS transport streams are decoded separately. Raw concatenation can produce misleading continuity/AAC-delay errors. A short final fragment may legitimately have one video frame and no audio when the audio has already ended. A damaged source was diagnosed separately and left untouched.

## Operations

The image contains the server, FFmpeg/FFprobe, libraries and licenses, with no shell or compiler. It retains a read-only root, unprivileged user, dropped capabilities and no published host ports. Only cache storage is writable; photos stay read-only in Nextcloud. Mali adds about 58 MB to the preceding 109 MB image.

A prior PHP-FPM SIGSEGV incident caused HTTP 502 responses. Restarting PHP-FPM restored service; the pattern also predated the player update. PHP tracing JIT was subsequently disabled while OPcache remained enabled. JIT is a suspected contributor, not a proven root cause.

The health check detects unexpected Memories app versions but cannot prevent manual app updates. Upgrade the app/backend as a tested pair and retain the previous image, helper and stack definition for rollback.

This is an experimental community project, not an official Memories release. Private filenames, deployment details and credentials are excluded.
