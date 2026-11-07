# Memories 11.0.2 native-player integration

`memories_rkmpp_v11` is gated to Memories 11.0.2 and uses the native `PsVideoQuality.ts` hls.js hooks. It does not install the obsolete Memories 10.2 Vidstack player.

- Measure a bounded random-data download once, before segment loading, over the same Nextcloud origin. Exclude PHP/encoder time to first byte. The probe is limited to 2.2 seconds and unavailable measurements start conservatively.
- Use 80% of measured bandwidth for the initial resolution only. Prefer compatible Original when available; its copy-grid preflight has a bounded 1.5-second opportunity. Do not run speed tests again during playback.
- Eighteen seconds is the hls.js forward buffer target, not a mandatory delay before playback. The quality controller begins evaluating after three playable seconds; if playback cannot fill three seconds, cold startup/seek protection expires after 9/6 seconds of elapsed time instead of waiting forever for a fragment request to age. The buffer is also bounded by 96 MiB. Eight seconds of back-buffer remain.
- **One fragment-evidence-driven Auto controller**: eighteen seconds remains hls.js's buffering goal (not a mandatory startup wait). Completed segments must demonstrate sufficient delivery rate and HTTP transfer headroom, while emergency downshifts still respond to real starvation. Normal 3–5 second fragment buffer fluctuations alone do not switch resolution.
- Two independent, successfully delivered fragments support an upgrade. The new rendition must actually play before further upgrading. Failed attempts require stronger delivery evidence, not a blanket delay. HLS segment sequence numbers are deduplicated, and waiting, pauses, seeks and manual selections clear stale upgrade evidence.
- hls.js `loadLevel` changes rendition without flushing already-playable video. The current audio track remains unchanged throughout video adaptation; there are **no automatic alternate AAC bitrate switches**. A user-driven quality selection overrides Auto until Auto is explicitly reselected.
- Startup speed estimation and Original stream-copy preflight are each bound to a specific player session: a replaced/aborted hls.js instance cannot initialize another instance or mark its Original rendition ready. Old media producers may still run until server idle expiry; this browser fix does not prove timestamp continuity between Original and encoded streams.
- Cold starts and seeks are protected against misclassification of initial fragment production, with a bounded six-second warm-up once the controller begins checking. FPS-drop capping remains active.
- The badge reports presented video dimensions and codec above the native controls, fading with them. Local DOM diagnostics expose buffer, throughput, Original readiness, decoder cap and dropped frames; no telemetry is uploaded.

Encoded RKMPP HLS video uses FFmpeg input pacing with an 18-second initial burst and catch-up rate 3. The stream supervisor never suspends those asynchronous hardware workers with SIGSTOP. Copy and software audio retain the existing producer throttling. Idle producers still stop through the normal timeout.

The buffer-first quality policy currently targets hls.js. Safari native HLS retains the browser's own ABR; guest/public-share probing and mobile browser compatibility still require validation. A successful server hardware test does not prove audible continuity, perceptual HDR quality or smooth browser switching.

Deploy with `scripts/deploy-v11.sh`. Acceptance requires real media playback, repeated quality changes, cold seeks, abrupt network reduction/recovery, and checking audio drift/gaps. Merge and branch cleanup follow acceptance, then the mainline deployment is checked again.

## Android native player: separate from this release

The official Android app lacks the browser helper's quality hooks. A separate
companion APK now exposes quality choices but has a reported startup failure.
The user explicitly deferred that native app from the server/browser merge.
Its work remains on `import/laptop-2026-11-04`; do not treat it as released.

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
of the app's signed asset manifest. Server logs show a native 1.15 client;
the 11.0.2 source tag contains Android 1.17. Do not assume every handset's client
version or shell behavior from the Nextcloud application version alone.
