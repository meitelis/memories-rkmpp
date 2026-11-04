# Verification: Memories 10.2.0 / go-vod 0.6.3

## R9 candidate / helper 0.3.5

Source review: 4 November 2026. All 53 player/settings tests pass, including nine queued-source handoff and cancellation cases in addition to R8's 44 checks. The engine source is unchanged from R7. JavaScript syntax is checked separately. These source checks do not establish successful native playback in a real browser.

Vidstack 1.15.7's [source selection](https://github.com/vidstack/player/blob/0133da67e4f84a5aaad59c63853b12c6cda0a6a9/packages/vidstack/src/components/provider/source-select.ts) emits `source-change` before committing the selected provider loader. The helper now queues its original-source assignment until that selection turn finishes. The ordering regression models this event/loader sequence: the prior immediate replacement leaves the HLS loader selected, whereas the queued replacement finishes with the native video loader. Pending work checks session identity, connection state, format preference and the still-configured source before writing anything. Another asset, removal or an explicit format selection cancels it. An error from the old HLS source before that queued assignment does not abort the trial. Readiness restoration and monitoring begin only when the original is assigned.

R8's HLS fallback remained usable during live sampling, but successful original playback was not observed. A diagnostic-only replacement under the same helper version was retained in an immutable browser asset cache, so its error details were not available. R9 advances the actual helper manifest and script version to 0.3.5, with a matching R9 release label and Compose image. This permits a normal app update and a new asset-cache identity.

The candidate temporarily logs one diagnostic record on a direct-mode error: bounded numeric event/native error codes, native codec-support answers, and allowlisted provider/source categories. It never logs URL values, access tokens or freeform error messages. These records are for confirming the source handoff and distinguishing an old provider error from an actual unsupported original.

Live checks remain pending: confirm helper 0.3.5 loads, observe an authenticated original request and advancing native video, exercise direct-to-HLS fallback with pause/seek preservation, and verify shared links and target browsers. The exact live cause of R8's failed original trial is not yet established. Do not merge this candidate based only on its source tests or present R7's browser/hardware results as R9 original-playback validation.

## R8 candidate / helper 0.3.4

Source review: 4 November 2026. This candidate changes the player helper and its release packaging; the R7 Go engine is unchanged. The completed R7 hardware checks below describe that existing engine, not live validation of the new direct-play path.

All 44 player/settings tests pass, including eighteen new direct-play lifecycle and preference cases. They cover monitoring after can-play/playing, pause/resume with fresh samples, seek cancellation, a fully buffered ending, sustained stalls, one-time fallback with position restoration, another asset, unrelated source replacement and removal. They also cover explicit HEVC/H.264 preferences, early pause requests, delayed autoplay and original-to-HLS format changes. Seven selected regressions fail against the original experimental PR #5 helper (`531d807`). Seven further selected cases fail before the explicit-format/early-pause correction (`a2026d9`), confirming the defects rather than only checking the new implementation. JavaScript syntax validation also passes.

The original-playback monitor now survives healthy playback events. Pausing and ending stop its work; resuming starts one monitor. Seeking cancels a stale stall deadline and discards old buffer samples. Source changes and removed players clear timers and the previous fallback target. A fully downloaded tail can drain naturally without spawning an HLS encoder. Early pause requests suppress both public autoplay flags through the player's delayed ready callback, retaining the R7 hold until deliberate play. A four-second HLS buffer uses a 60% delivery budget; the corresponding rendition assertion now matches that policy. Original URLs, which may contain access tokens, are no longer logged.

The helper version is 0.3.4 in its Nextcloud manifest and script; the combined release label and Compose image tag advance to R8. The builder reads that manifest version for the bundled-helper label, so a 0.3.3 installation is eligible for an update. The engine-only Dockerfile retains its R7 version because no engine source changed.

Auto's original-first playback is an optimistic attempt with the real media element. The HLS URL does not expose enough codec/audio/bitrate metadata for a verified compatibility decision before playback. This can avoid re-encoding a playable original, but it does not reduce the original's network bitrate or guarantee hardware client decoding. A six-second sustained-stall deadline remains a recovery bound, not a promise of seamless switching. Explicit HEVC and H.264 preferences bypass the trial. A mid-playback explicit selection loads the negotiated HLS master with the saved position and pause state; returning to Auto does not restart the original trial for that asset.

Real Memories source-change/error event ordering, shared-link authentication, pause/seek restoration through direct-to-HLS replacement, Windows Chrome, Android and Safari playback remain unverified for this candidate. The new source tests do not establish actual decoder behavior, frame-drop rates or smooth transitions on those clients. Keep the candidate under review until the required live checks pass; historical R7 observations must not be presented as R8 browser results.

## R7 / helper 0.3.3

The R7 source passed the full Linux ARM64 Go race suite, go vet, formatting and image build on the ROCK 5B+. Its 40-case synthetic matrix passed across 480p, 720p, 1080p, 1440p and 2160p in HEVC and H.264, including startup, cold middle/end and eight concurrent requests for each cold startup. These tests use strict independent fragment decoding and leave the source unchanged.

Compatible mono/stereo AAC-LC at 44.1/48 kHz and up to 256 kbps is preserved. Four R6 warm/cold audits, spanning both sample rates and video codecs, retained identical AAC packets and matching video clocks after explicit HLS child-muxer timestamp handling. Eighteen real-source fragments also passed strict decoding in that revision.

Real-video comparison found a 384 kbps AAC source that required normalization, unlike the approximately 160 kbps copied sources. R7 gives normalized audio one lazy HLS rendition per playback manager. All video qualities reference it and their FFmpeg jobs omit audio. It uses no video hardware context, follows existing backpressure/idle cleanup, and pads a shorter audio source only to the video end.

Four synthetic shared-audio scenarios passed: full-length and short PCM audio with both video codecs. Startup, middle, cold audio seeks, silent tails, strict decoding, unchanged audio across 480p/4K changes and eight concurrent audio requests were checked. A real high-bitrate AAC source also passed shared-track and strict-decoding checks across 480p/4K in both codecs. Authentication and codec queries remain on the audio playlist and its segments.

Twenty-four JavaScript regressions and six PHP connection-test contract checks pass. Twelve Linux mock-Docker deployment tests cover first install, updates, backups, cleanup, failures and locks. GitHub's ARM64 source-check workflow also passed the complete Go, player, PHP and deployment checks. The updater passed inspection and real activation against the running Nextcloud 35 installation.

Live R6/helper 0.3.2 browser checks reached every quality through true 3840×2160. In timed manual samples the media clock advanced normally and readyState stayed at 4. The connection test worked through the authenticated Nextcloud route. The top-right gear and closing the dialog were checked after correcting Nextcloud’s native-dialog style override.

Helper 0.3.3 additionally preserves a seek that has not yet reached reactive player state, suppresses delayed autoplay while retaining an intentionally paused asset, and restores upstream autoplay on user play or another asset. Muxed audio uses the non-flushing loadLevel policy; a separate audio track permits nextLevel video-only switching. Clocks/captions do not trigger the settings toolbar observer.

The release image bundles the connector and updater without adding a runtime process, Docker socket or Nextcloud write mount. Runtime test files are excluded. The one-command host deployment waits for engine health before installing the bundled connector. Log rotation bounds container logs to three 10 MB files. The connector uses persistent Nextcloud app storage and currently declares Nextcloud 35 compatibility.

R7 and helper 0.3.3 are deployed and healthy. The host deployment installed the connector from the running image, with a retained backup; a subsequent preflight found both versions equal. The effective Compose configuration changed only the image, retaining existing log rotation, cache, devices and security settings. The transcoder retains a read-only root, dropped capabilities and only its cache volume.

Live R7 checks confirmed the gear at the top-right, closed dialog dimensions of zero, and Escape closing the panel without closing the video. A paused format change retained an in-flight seek at 20.001 seconds and remained paused; a playing format change resumed normally. A real high-bitrate AAC source exposed the shared audio track and reached both 480p and true 3840×2160 without a media error at the sampled points. These browser observations supplement the complete hardware rendition matrix; they are not frame-drop measurements.

After refreshing R7, the user explicitly reported no clicks on the Windows Chrome laptop test that previously clicked. This confirms that user's listening sample, not every device or video. Native HLS buffering remains controlled by the browser and upstream player. No universal click-free, zero-lag or 100% VPU-utilization claim is made.
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

With the 0.2.5 helper, manual quality changes retained buffered video and applied to newly loaded fragments. A visible change could take up to the buffered duration, normally about 12 seconds. The current helper chooses `loadLevel` for muxed audio and `nextLevel` for a separate audio track, with the configurable shorter buffer described above.

## Limits

All 63 real library sources were SDR. HDR10/PQ and HLG coverage uses synthetic fixtures, not a real-camera HDR collection or a display-calibrated colour comparison. Dolby Vision rendering remains unvalidated. HDR is tone-mapped to SDR, not passed through as HDR.

Supported video uses MPP decode, RGA scale/rotation, Mali tone mapping when needed, and MPP encode. Unsupported profiles can require CPU decode and tone mapping; audio and preview generation still involve CPU work. There is no software video-encoder fallback. GPU tone mapping is skipped for SDR.

Independent HLS transport streams are decoded separately. Raw concatenation can produce misleading continuity/AAC-delay errors. A short final fragment may legitimately have one video frame and no audio when the audio has already ended. A damaged source was diagnosed separately and left untouched.

## Operations

The image contains the server, FFmpeg/FFprobe, libraries and licenses, with no shell or compiler. It retains a read-only root, unprivileged user, dropped capabilities and no published host ports. Only cache storage is writable; photos stay read-only in Nextcloud. Mali adds about 58 MB to the preceding 109 MB image.

A prior PHP-FPM SIGSEGV incident caused HTTP 502 responses. Restarting PHP-FPM restored service; the pattern also predated the player update. PHP tracing JIT was subsequently disabled while OPcache remained enabled. JIT is a suspected contributor, not a proven root cause.

The health check detects unexpected Memories app versions but cannot prevent manual app updates. Upgrade the app/backend as a tested pair and retain the previous image, helper and stack definition for rollback.

This is an experimental community project, not an official Memories release. Private filenames, deployment details and credentials are excluded.
