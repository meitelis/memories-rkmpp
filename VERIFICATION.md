# Verification: Memories 10.2.0 / go-vod 0.6.3 / player 0.2.5

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

Manual quality changes retain buffered video and apply to newly loaded fragments. A visible change can take up to the buffered duration, normally about 12 seconds.

## Limits

All 63 real library sources were SDR. HDR10/PQ and HLG coverage uses synthetic fixtures, not a real-camera HDR collection or a display-calibrated colour comparison. Dolby Vision rendering remains unvalidated. HDR is tone-mapped to SDR, not passed through as HDR.

Supported video uses MPP decode, RGA scale/rotation, Mali tone mapping when needed, and MPP encode. Unsupported profiles can require CPU decode and tone mapping; audio and preview generation still involve CPU work. There is no software video-encoder fallback. GPU tone mapping is skipped for SDR.

Independent HLS transport streams are decoded separately. Raw concatenation can produce misleading continuity/AAC-delay errors. A short final fragment may legitimately have one video frame and no audio when the audio has already ended. A damaged source was diagnosed separately and left untouched.

## Operations

The image contains the server, FFmpeg/FFprobe, libraries and licenses, with no shell or compiler. It retains a read-only root, unprivileged user, dropped capabilities and no published host ports. Only cache storage is writable; photos stay read-only in Nextcloud. Mali adds about 58 MB to the preceding 109 MB image.

A prior PHP-FPM SIGSEGV incident caused HTTP 502 responses. Restarting PHP-FPM restored service; the pattern also predated the player update. PHP tracing JIT was subsequently disabled while OPcache remained enabled. JIT is a suspected contributor, not a proven root cause.

The health check detects unexpected Memories app versions but cannot prevent manual app updates. Upgrade the app/backend as a tested pair and retain the previous image, helper and stack definition for rollback.

This is an experimental community project, not an official Memories release. Private filenames, deployment details and credentials are excluded.
