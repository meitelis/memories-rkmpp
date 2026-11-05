# Memories 11.0.2 native-player integration

`memories_rkmpp_v11` is gated to Memories 11.0.2 and uses the native `PsVideoQuality.ts` hls.js hooks. It does not install the obsolete Memories 10.2 Vidstack player.

- Measure a bounded random-data download over the same Nextcloud origin before segment loading. Exclude PHP/encoder time to first byte from transfer estimates. Probe time is limited to 2.2 seconds; unavailable measurements start conservatively.
- Budget 72% of measured bandwidth. Prefer compatible original HLS when its keyframe grid is ready and bandwidth permits it; a pending grid does not block encoded playback.
- Watch fragment transfer throughput and buffered seconds. React quickly to a shrinking buffer, wait at least ten seconds of stable headroom before increasing the cap, and retain hls.js error/ABR handling.
- Keep a shared AAC track across Original and encoded video. Video selection uses `nextLevel` for shared audio, or `loadLevel` for legacy muxed audio, never the buffer-flushing `currentLevel` setter.
- Audio adaptation is independent: high/original on normal links, 96/64/32 kbps on weaker links, with sustained-change and cooldown checks. Profiles use AAC-LC, stereo, 48 kHz; normalized cold seeks use a global 1024-sample clock.
- The visible badge reports presented video dimensions and codec, not merely requested quality. Local DOM diagnostics expose buffer, throughput and dropped frames; no telemetry is uploaded.

The custom bandwidth policy currently targets hls.js. Safari native HLS retains the browser's own ABR; guest/public-share probing and mobile browser compatibility still require validation. A successful server hardware test does not prove audible continuity, perceptual HDR quality or smooth browser switching.

Deploy with `scripts/deploy-v11.sh`. Acceptance requires real media playback, repeated quality changes, cold seeks, abrupt network reduction/recovery, and checking audio drift/gaps. Merge and branch cleanup follow acceptance, then the mainline deployment is checked again.
