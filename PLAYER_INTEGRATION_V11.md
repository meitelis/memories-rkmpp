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

## Android native player: confirmed integration gap

The user reports that the resolution menu is absent in the Android app while it
remains available in the browser. Treat this as an open acceptance failure.

The pinned upstream 11.0.2 implementation has two distinct playback paths:

- [PsVideo.ts](https://github.com/pulsejet/memories/blob/v11.0.2/src/components/viewer/PsVideo.ts)
  creates `viewer-video-native-hole` when the native capability is available;
  only HTML video receives the hls.js quality hooks.
- [ViewerVideoNativeHole.vue](https://github.com/pulsejet/memories/blob/v11.0.2/src/components/viewer/ViewerVideoNativeHole.vue)
  mirrors position, dimensions, buffering and playback controls, but does not
  expose `qualityList` or `currentQuality` to the stock quality menu.
- [NativeHoleVideo.kt](https://github.com/pulsejet/memories/blob/v11.0.2/android/app/src/main/java/gallery/memories/ui/video/NativeHoleVideo.kt)
  uses ExoPlayer with HLS support. Its command bridge handles play, stop, pause,
  seek, volume, mute and rate; it has no quality-selection command or track list.
- The newer Android shell caches signed upstream web assets rather than the
  normal Nextcloud template. A BeforeTemplateRenderedEvent helper is therefore
  insufficient for that shell as well as for its native player.

The browser adapter deliberately attaches to HTMLVideoElement/hls.js. Do not
claim that its speed probe, policy, rendition badge or quality menu runs in the
native app. ExoPlayer still has its own automatic adaptation; server-side MPP/RGA,
AAC packet-clock and bitrate fixes apply to either client.

A complete native integration must expose ExoPlayer video tracks and Auto/manual
selection through the bridge, report the actually presented format, and change
track-selection parameters on the existing media item without replacing its URL
or resetting shared audio. Native startup bandwidth and buffer policy need their
own verification. Shipping that bridge requires a compatible Android build and
web controls, not a server-only JavaScript injection or an unsigned replacement
of the app's signed asset manifest. The installed Android version has not yet
been collected, so do not assume its shell behavior from the server version alone.
