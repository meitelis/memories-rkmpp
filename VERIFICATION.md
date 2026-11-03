# Verification: Memories 10.2.0 / go-vod 0.6.3

## Current candidate: R6 / helper 0.3.0

R6 extends R5 with compatible AAC-LC copying, explicit timestamp handling in the HLS child muxer and helper 0.3.0's playback-settings dialog. The full Go race suite, go vet and ARM64 image build passed on the server. R6/helper 0.3.0 has not yet replaced the live deployment. The completed R5 measurements below predate these additions and do not establish the candidate's audio-switch behavior or live GUI/connection-test integration.

The candidate preserves mono/stereo 44.1/48 kHz AAC-LC packets when the source has a known positive bitrate no greater than 256 kbps. Other audio retains stereo 48 kHz AAC normalization. Older probe-cache entries are refreshed to include the audio profile and bitrate. Argument and metadata handling are covered by source regressions.

An initial 48 kHz audio audit reproduced a 21.333 ms difference between warm and cold fragment timestamps. Setting `avoid_negative_ts=disabled` on the child HLS muxer through `-hls_segment_options`, in addition to the outer output option, eliminated that shift in the audited case. All 140 compared AAC packets then matched in both presentation timestamp and payload. This is a focused packet audit, not completion of the 44.1 kHz tests, full hardware fragment matrix or audible up/down quality-transition checks; those remain pending.

The settings dialog provides format Auto/HEVC/H.264, Auto/Responsive/Smooth/custom buffering, browser-local persistence, and a same-origin connection test with recommendations. The test uses a 128 KiB warm-up and two timed 1 MiB downloads. The PHP route requires a signed-in session, bounds response sizes and rate-limits requests; actual Nextcloud middleware, proxy and browser behavior still need live verification.

The playback preferences integrate with hls.js. Native HLS buffering continues to use the browser and upstream player's behavior; these hls.js settings do not override it.

Eighteen JavaScript tests passed locally. These cover corrupt and blocked storage, validated preferences, connection recommendations and request bounds, buffer adaptation and the video byte budget, unsupported HEVC and one-time AVC recovery, and live settings changes that preserve position and pause state. Codec replacements start loading at the saved playhead; quick repeated preference changes retain the original resume position.

The local browser preview passed first-click dialog opening, backdrop dismissal, saving format/Custom settings across reload, and Reset to Auto. These checks exercised the settings UI and browser persistence, not the live Nextcloud connection-test route or real video playback.

Manual switches use `nextLevel`, retaining the current fragment and fetch-time padding while replacing future buffered fragments. Live Nextcloud integration, connection-test errors and rate limits, actual format changes, the full audio/fragment matrix and audible up/down quality transitions remain pending. The current labels are R6 and helper 0.3.0; live release status and final measured results will be recorded after those checks.

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
