# Memories 11.0.2 native-player integration

`memories_rkmpp_v11` is gated to Memories 11.0.2 and uses the native `PsVideoQuality.ts` hls.js hooks. It does not install the obsolete Memories 10.2 Vidstack player.

- Measure a bounded random-data download over the same Nextcloud origin before segment loading. Exclude PHP/encoder time to first byte from transfer estimates. Probe time is limited to 2.2 seconds; unavailable measurements start conservatively.
- Budget 72% of measured bandwidth. Prefer compatible original HLS when bandwidth permits it; allow its copy-grid preflight up to 1.5 seconds before selecting an encoded fallback.
- Watch fragment transfer throughput and buffered seconds. React quickly to a shrinking buffer, wait at least ten seconds of stable headroom before increasing the cap, and retain hls.js error/ABR handling.
- Keep a shared AAC track across Original and encoded video. Manual video selection uses `loadLevel`, preserving buffered pictures while a cold rendition starts. Runtime audio uses `nextAudioTrack`, preserving the current audio buffer.
- Protect cold seeks separately from congestion. Hold the current rendition while its producer warms; exclude that cold delivery from network samples. Scale buffer thresholds to the byte-limited forward target, rather than requiring ten seconds on every source.
- Bound forward storage to a 48 MiB target with an 18-second ceiling and three seconds retained behind. This matters for high-bitrate originals. Browser quota recovery can reduce those targets further. Use the normal 20% sustained frame-drop threshold for decoder capping.
- Audio adaptation is independent: high/original on normal links, 96/64/32 kbps on weaker links, with sustained-change and cooldown checks. Profiles use AAC-LC, stereo, 48 kHz; normalized cold seeks use a global 1024-sample clock.
- The badge reports presented video dimensions and codec above the native controls, fading with them. Local DOM diagnostics expose buffer, throughput, Original readiness, decoder cap and dropped frames; no telemetry is uploaded.

Encoded RKMPP HLS video uses FFmpeg input pacing with an 18-second initial burst and catch-up rate 2. The stream supervisor never suspends those asynchronous hardware workers with SIGSTOP. Copy and software audio retain the existing producer throttling. Idle producers still stop through the normal timeout.

The custom bandwidth policy currently targets hls.js. Safari native HLS retains the browser's own ABR; guest/public-share probing and mobile browser compatibility still require validation. A successful server hardware test does not prove audible continuity, perceptual HDR quality or smooth browser switching.

Deploy with `scripts/deploy-v11.sh`. Acceptance requires real media playback, repeated quality changes, cold seeks, abrupt network reduction/recovery, and checking audio drift/gaps. Merge and branch cleanup follow acceptance, then the mainline deployment is checked again.
