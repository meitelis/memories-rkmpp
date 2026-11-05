# Native Android integration for Memories 11.0.2

This builds a companion **Memories RKMPP** APK (`gallery.memories.rkmpp`) from
the pinned upstream 11.0.2 source, whose Android client version is 1.17. It can
be installed beside the official app. It uses the same server and transcoder;
the working browser/server deployment is unchanged.

The patch adds an immutable quality snapshot and a video-track command to the
native bridge. An APK-owned adapter exposes those through Memories' existing
quality menu and displays presented dimensions/codec beside the fading controls.
The upstream signed web bundle and its signature verification stay intact.

Media3 owns video adaptation and buffering. Startup uses a bounded, authenticated
speed measurement through the same Nextcloud server, with 72% bandwidth budgeting
and no viewport-size cap that would unnecessarily exclude Original on a fast link.
Buffers are limited to 18 seconds / 48 MiB, with three seconds behind. A temporary
Original-index HTTP 409 permits a five-second rendition fallback. Manual selection
updates the existing player's video track override; Auto removes that override.
Neither operation changes the media URL, seeks or replaces the audio track.

AAC selection follows its own high/96/64/32 kbps budget, with faster reduction,
slower recovery and seek protection. Clip navigation cancels stale startup work;
pause/background state is retained while a probe finishes.

## Reproduce the build

The `Memories 11 native Android player` workflow checks out upstream commit
`e156f850ec5514433f1cfac9d4f1dbd461500c8d`, applies `native.patch`, copies the
small native/adapter files and runs JVM policy tests plus `assembleDebug` with
JDK 21 and Android SDK 37.2. The `memories-rkmpp-android` artifact contains the
installable APK and test report. No server credentials or signing keys are inputs.

For a local build with those dependencies:

```sh
sh android-v11/apply.sh /path/to/pinned/memories
cd /path/to/pinned/memories/android
./gradlew testDebugUnitTest assembleDebug --console=plain
```

`node --test android-v11/native-video.test.cjs` checks the stock-controls adapter:
distinct bitrate options, presented dimensions, paused selection and stale-clip
rejection. JVM tests check audio budget thresholds and hysteresis. These checks
do not establish real-device playback or audible continuity. Before accepting the
APK, test home-network Original startup, all quality choices, forward/backward
seeks, pause/background/resume and a weak-link reduction/recovery on Android.
