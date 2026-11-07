# Android native-quality companion — experimental

This branch builds a **separate** Memories RKMPP APK (`gallery.memories.rkmpp`) from upstream Memories v11.0.2 Android 1.17 source (pinned SHA `e156f850ec5514433f1cfac9d4f1dbd461500c8d`). The existing official Android app, Nextcloud server and working browser hls.js deployment are unchanged.

## Design

- Uses Android **Media3 ExoPlayer** adaptive track selection (bandwidth measurement, buffer safety and conservative up/downshifts), rather than running hls.js in a second video element or creating another bespoke quality state machine.
- `DefaultBandwidthMeter` resets on mobile-network/Wi-Fi changes. Media3 owns adaptation and switching.
- Manual resolution+bitrate selection sets a supported **video-only** track override on the current player. Selecting **Auto** clears it, without recreating the player, seeking, or touching AAC.
- Android's existing Memories viewer quality control is connected to a small `nativex` bridge, with immutable quality snapshots. It reports currently presented dimensions and codec.
- Retains the original native video startup path. The abandoned prototype delayed `prepare()` for an external speed probe and replaced its player asynchronously; **this implementation removes that source of startup regressions**. It also preserves cookie-based media authentication.
- Still permits a five-second fallback if go-vod returns 409 while preparing an Original HLS playlist.
- Uses a bounded 18-second / 48 MiB forward buffer, 3-second back-buffer. Display of Original is conservative when a definite format ID is unavailable.
- Signed upstream web bundles and their signature validation are untouched; the APK adds only a small local script and CSS for the quality menu.

## Build and test

GitHub workflow **Memories RKMPP Android native quality** checks out upstream commit and uses `android-v11/apply.sh`, runs JavaScript adapter tests and Gradle `testDebugUnitTest assembleDebug`. The generated artifact is named `memories-rkmpp-android-media3`.

With JDK 21 / Android SDK 37.2 locally:

```sh
sh android-v11/apply.sh /path/to/pinned/memories
cd /path/to/pinned/memories/android
./gradlew testDebugUnitTest assembleDebug --console=plain
```

## Device acceptance

This code is **not a proven playback fix** until installed and tested on the actual Android phone. Check first-frame startup (the previous companion APK failed here), full-resolution Original, manually 480p / 720p / 1080p then Auto, network switch 5G ↔ Wi-Fi, seek, pause/background/resume, audio continuity and repeated clip navigation. A successful build proves compilation, not Media3 device/decoder support or smooth playback.

The browser hls.js implementation in `main` remains the accepted version; do not merge or deploy this Android change until testing.
