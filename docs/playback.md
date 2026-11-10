# Browser playback

The helper extends the stock Memories 11.1.1 HTML video/hls.js hooks. It does not replace signed Memories assets, the video element, or the shared audio playlist. The current integration is checked against hls.js 1.7.4.

## Original and encoded quality

**Original** copies compatible source video packets into HLS fragments instead of re-encoding them. It is named in the native quality menu and remains available to Auto once its copy-grid playlist is ready. This is a remuxed stream, not a byte-identical transfer of the original MP4 container; audio follows the shared compatibility/padding policy below.

SDR Main10 HEVC requires an explicit browser MediaSource capability. Copied Main10 is advertised as Main10, while encoded HEVC fallbacks remain Main. HDR retains the SDR tone-mapping path. Source rotation, container/codec compatibility and supported bit depth still affect Original eligibility. A failed copy timeline cannot silently re-encode under an Original label.

**Auto** leaves rendition selection to native hls.js ABR. A bounded same-origin connection probe seeds its initial bandwidth estimate. Its separate lowest-quality fragment bitrate test is disabled because on-demand transcoder startup made that test misleading. Slow-transfer adaptation, emergency downshifts and FPS-drop capping remain enabled.

Manual selection pins the selected level without flushing the existing buffer. Returning to Auto releases that pin immediately; an observed visual change can occur later because buffered video is retained. The status badge reports the dimensions actually presented, not merely the requested level.

## Buffering and connection measurements

- Forward buffer target: 18 seconds, up to 96 MiB. Back buffer: 8 seconds.
- Startup probe: up to 2.2 seconds, using 64 KiB, 384 KiB and 1.5 MiB samples. Failed or incomplete responses do not become bandwidth samples.
- Network/online/foreground hints and manual-to-Auto reentry can refresh the estimate. While playing below the top rendition, recovery probes are limited to one per 20 seconds and 128 KiB + 384 KiB per check.
- Completed fragment transfer timing is measured separately from pre-first-byte producer waits. Two recent transfer samples and sufficient buffer can justify a conservative native-estimator correction.
- Only requested renditions start workers. Encoded RKMPP input uses `-readrate 1 -readrate_initial_burst 18 -readrate_catchup 3.5`; it is not suspended with SIGSTOP. The catch-up ceiling is an input-pacing setting, not a throughput guarantee.

## Audio

All video qualities reference one shared audio timeline. Quality changes do not automatically change the audio profile or replace its source. High audio is 192 kbps when encoding; compatible AAC can retain source packets under the existing format, duration and bitrate checks. The other lazy profiles are 96, 64 and 32 kbps. Short/unsupported audio can be normalized and padded so the picture is not blocked by a missing audio tail.

## Client scope

The browser helper applies to HTMLVideoElement/hls.js playback. Native Android uses ExoPlayer and its own adaptation, and Safari native HLS controls its own buffering. Their behavior is not established by a browser result. Android development remains outside main's server/browser release on its existing branches, including the draft [native quality PR #16](https://github.com/meitelis/memories-rkmpp/pull/16).

See [testing](testing/README.md) for current checks and [the latest verification](verification/auto-original-2026-11-10.md) for the observed Original/startup fix. Older Android bridge analysis and player policies are retained as [historical records](history/README.md).
