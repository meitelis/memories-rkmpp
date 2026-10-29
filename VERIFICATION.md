# Verification: Memories 10.2.0 / go-vod 0.6.3 / player 0.2.3

The R3 container and player helper are deployed on a ROCK 5B+ with Armbian's vendor 6.1 kernel. Memories accepts protocol 0.6.3, and the service passes its health check. See [the R3 report](verification/r3-summary.json) for the sanitized measurements. The older summary.json records the preceding R1 build.

## Completed checks

- Formatting, Go race tests, go vet, ARM64 image build, and four player regression tests passed.
- All 63 library videos passed 180 independently decoded HEVC startup, cold-middle, and cold-end segments. Output dimensions matched the playlist declarations.
- Eight AVC/HEVC ladder scenarios passed 72 additional segments across every rendition.
- Ten synthetic AVC/HEVC orientation cases (0, 90, -90, 180, and the 270 alias) matched FFmpeg autorotation. The fixtures assert their input rotation before comparing colored quadrants.
- Server transitions through 1080p, 1440p, 720p, and 1080p passed independent fragment decoding. Video boundaries differed by at most 21.333 ms; audio boundaries were within -58.666/+24 ms. A 25-second pause followed by a cold encoder restart resumed in 1.443 seconds.
- In a real browser, portrait labels showed 1080p, 720p, and 480p. Displayed frames changed from 1080×1920 to 720×1280 and back to 1080×1920. Returning to Auto continued playback, and the video reached its end without a persistent freeze or fatal media error.
- Production logs confirmed hevc_rkmpp encoding and scale_rkrga scaling, with no encoder failure during this browser check. Hardware AVC fallback was exercised in the ladder tests; browser tests cover unsupported MSE reports and a single fatal-codec retry.
- Source sizes and modification times stayed unchanged. Nextcloud's external photo mount remains read-only. The transcoder has only its writable cache volume.

Manual quality changes now use Vidstack's load switch mode: already buffered video is retained, and the selected quality applies to newly loaded fragments. A visible quality change can therefore take up to the buffered duration, normally at most about 12 seconds.

## Limits

The browser recorded nonfatal bufferSeekOverHole and bufferStalledError events and recovered. This check proves that the earlier persistent freeze did not recur in this run; it does not establish zero brief rebuffering or smooth playback on every browser and network. Server fragment checks alone cannot establish browser playback behavior.

All 63 real sources tested here were SDR, including AVC, HEVC 8-bit, and HEVC 10-bit. Real HDR and Dolby Vision rendering are not validated. Unsupported source formats may use CPU decoding; HDR tone mapping, audio processing, and preview generation use CPU work. Video encoding has no software fallback.

Independent HLS transport-stream files are decoded separately. Concatenating them as one raw stream can produce misleading continuity-counter and AAC-delay errors. A short final fragment can legitimately contain one video frame and no audio when the audio has already ended.

A damaged original was diagnosed independently of HTTP transcoding and left untouched. Private media names and server details are excluded from this report.

## Operations

The final image is 109171649 bytes, ID sha256:77ed3855598fbd97b87aff30dbe94bccbc85ab3202fb6a244bc207e7aecd42a8. The previous image, helper, and stack definition were retained for rollback.

During a helper upgrade, PHP-FPM workers crashed with SIGSEGV and Nextcloud returned 502. Restarting PHP-FPM restored service; the same crash pattern also existed earlier that day. PHP 8.5 tracing JIT was enabled and has since been disabled while OPcache remains enabled. JIT is a suspected contributing factor, not a proven root cause. This PHP runtime incident is separate from hardware encoding; no claim of a complete crash diagnosis is made.

The health check detects an unexpected Memories app version. It cannot prevent manual app updates. Upgrade the app and backend as a tested pair, retain rollback artifacts, and check playback and service health after updates.

This is an experimental community project, not an official Memories release.
