# Memories RK3588 transcoder

Experimental hardware transcoder for Memories **10.2.0** and go-vod protocol **0.6.3**. Based on the official Memories v10.2.0 source, with RKMPP support carried forward. This is a full protocol update, including Nextcloud's per-file service tokens and HTTP media input.

The tested platform is a Radxa ROCK 5B+ running Armbian's 6.1 vendor kernel. Other boards and kernels need their own validation.

**R8 candidate / helper 0.3.4** bundles the existing R7 engine with an original-playback trial and adaptive RKMPP fallback. The helper's 44 player/settings tests pass; live browser integration remains pending. The unchanged engine retains R7's completed Go race, vet, ARM64 rendition and shared-audio checks. See `VERIFICATION.md` for the exact coverage and release limits.

## Hardware and playback

For HLS playback, supported SDR sources use MPP decoding and RGA scaling/rotation. The default output is hardware HEVC (`hevc_rkmpp`) when the client reports support, with hardware AVC (`h264_rkmpp`) as the compatibility fallback. There is no software video-encoder fallback. Supported HDR10/PQ and HLG sources use Mali OpenCL tone mapping to SDR, between MPP decoding/RGA scaling and hardware encoding. A real-frame probe checks this pipeline per rendition; unsupported profiles or failed GPU probes retain CPU tone mapping with hardware encoding. Unsupported source formats can require CPU decoding; audio normalization and preview generation also use CPU work. Dolby Vision rendering is not validated. Compatible originals can be served without re-encoding on the AVC path.

The backend retains the shared rendition clock, independently decodable HLS segments, bounded bitrate, six-second startup fragment, three-second later fragments, direct cold seeks, and hardware-safe buffering from the previous custom build. Inactive encoders are released after 15 seconds. Audio timestamps are preserved; a video-only tail is valid when its audio has already ended.

Known mono/stereo AAC-LC audio at 44.1 or 48 kHz and up to 256 kbps is copied, retaining its source packets and timestamps. Other audio, including lossless, high-bitrate or unknown formats, is converted once per playback manager to stereo 48 kHz AAC at 128 kbps. Every video quality references that same audio track; video jobs do not decode or encode it again. A bounded silent tail keeps shorter audio from stalling the picture. Older probe-cache entries are refreshed without discarding valid sibling caches. Source originals are never rewritten.

The child HLS muxer explicitly preserves source timestamps. Four warm/cold audits, covering 44.1/48 kHz AAC with HEVC and AVC, retained matching audio packets and video clocks. Authenticated probes reuse HTTP Range connections, including MP4 files whose index is stored at the end.

R5 shares cold source and keyframe analysis across viewers while keeping their playback state and credentials separate. Concurrent requests for the same cold fragment share one encoder start. Startup fragments are validated before sending and read once when delivered. A failed shared probe is retried with the waiting viewer's own credentials.

In Auto, the `memories_rkmpp_player` companion app first tries the authenticated original through Memories' stream endpoint. This is an optimistic playback trial, not a metadata-based guarantee that the file's codec, audio or bitrate is suitable. A decoder error, sustained stall or falling playable buffer switches once to that asset's adaptive HLS master while preserving position and pause state. A fully buffered ending does not trigger an unnecessary fallback. Original playback keeps the source bitrate and uses the browser's own buffering; adaptive renditions and the HLS buffer controls apply after fallback. Explicit HEVC or H.264 preferences bypass the original trial.

For HLS, the companion checks HEVC MediaSource support before requesting the master playlist and chooses an initial rendition from advertised bitrates and the available bandwidth estimate. Without a usable estimate it starts at the highest available short edge up to 1080p. Auto remains adaptive, respects actual display density, and can reduce the next rendition when its bitrate exceeds a conservative delivery budget. Available quality still depends on player size, measured bandwidth, and dropped frames. Portrait quality labels use the shorter displayed edge without altering the HLS dimensions or quality IDs.

With a separate audio track, manual quality changes use hls.js's `nextLevel` policy to replace future video while retaining audio. Muxed audio uses `loadLevel`, keeping the existing buffer intact and applying the new quality after it. A short buffer gives a quicker visible change; a larger buffer prioritizes an uneven connection. The helper retries once with AVC if a fatal codec error contradicts the browser's support report. It does not modify signed Memories assets or disable the player's Chrome seek workaround.

## Build and connect

Start with a local checkout:

```sh
git clone https://github.com/meitelis/memories-rkmpp.git
cd memories-rkmpp
```

1. Copy `.env.example` to `.env`. Set the internal Nextcloud URL and existing Docker network. Set the device group IDs to match your host.
2. Build the combined release on the ARM64 Docker host:

   ```sh
   sh scripts/build-release.sh --image local/memories-go-vod:rkmpp-10.2.0-v0.6.3-r8
   ```

   This builds the engine using its existing `go-vod/` context, then packages it with the companion app from this checkout. The helper version is read from `appinfo/info.xml`. To package an already tested matching engine without rebuilding it, add `--engine-image YOUR_EXISTING_ENGINE_IMAGE`.

3. Deploy the transcoder and install or update its bundled Nextcloud connector with one host command:

   ```sh
   sh scripts/deploy.sh --compose-file compose.yml --project memories_rkmpp --nextcloud nextcloud
   ```

   Replace `nextcloud` with your Nextcloud container name. For an existing installation, use its **existing Compose project name** so its cache volume and container are retained. The command starts only the `memories-rkmpp` service, waits for its health check, finds its container, then installs or updates the bundled helper. A new helper installation is enabled automatically; an existing installation uses Nextcloud's app-specific upgrade API.

4. In Memories administration, enable external video transcoding and use `memories-rkmpp:47788`. Leave VA-API and NVENC disabled. Reload Memories to load the helper and its playback settings.

The supplied GPU-enabled image needs `/dev/mpp_service`, `/dev/rga`, `/dev/dma_heap`, `/dev/dri`, and `/dev/mali0`. The tested vendor driver also requires `systempaths=unconfined`; the supplied configuration retains the default AppArmor profile, drops capabilities, runs as UID1000, and keeps the root filesystem read-only.

Only the transcoder cache needs a writable volume. The protocol fetches media through Nextcloud, so the transcoder needs no direct data or photo mounts. Keep external photo folders mounted read-only in **Nextcloud**. No host ports are published. Container logs rotate at 10 MB with three files, bounding their disk use.

For Portainer, build the image on the host first, then use the supplied Compose definition and environment variables. Keep an existing deployment's cache volume name when updating it. After a Portainer redeploy, run the host updater below against the resulting engine container; Portainer and plain `docker compose up` do not invoke the host deployment script automatically.

Use a Nextcloud URL that is reachable from the transcoder and accepted by Nextcloud's trusted-domain configuration. The supplied `preflight.py` currently targets the LinuxServer Nextcloud layout (`/app/www/public`, web-server user `abc`); other images need an equivalent version check.

`MEMORIES_RKMPP_OPENCL=false` disables GPU tone mapping for troubleshooting. The image includes one Mali OpenCL runtime from the same pinned Jellyfin media image; the host kernel driver must be compatible. GPU initialization alone is insufficient, so the backend probes a decoded, scaled, tone-mapped and encoded frame before choosing this path. SDR sources skip tone mapping. HDR output is currently converted to SDR; this is not HDR passthrough.

### Bundled Nextcloud player connector

R8 is one custom container image containing the unchanged R7 engine and the matching `memories_rkmpp_player` 0.3.4 app under `/usr/share/memories-rkmpp/nextcloud-app`. The helper's app version and bundled version label both advance, allowing the updater to distinguish it from 0.3.3. The connector executes inside Nextcloud to provide the integrated UI. The transcoder runs no extra process and needs no Docker socket, Nextcloud app mount or write access to Nextcloud. The host deployment command performs the app installation using your existing Docker access.

The installer defaults to LinuxServer Nextcloud's `/app/www/public` document root and web-server user `abc`. It discovers an existing helper's registered location, or selects a configured writable apps directory for a first installation. Use `--docroot`, `--web-user` and, if needed, `--app-path /your/writable/apps/memories_rkmpp_player` for another supported layout. The app path must belong to Nextcloud's configured writable apps paths. The helper declares Nextcloud 35 support; compatibility is checked before replacing an installed app. Its AGPL license is separate from the backend's Apache license.

To inspect or update just the connector from a running engine container:

```sh
sh scripts/update-nextcloud-player.sh --engine YOUR_ENGINE_CONTAINER --nextcloud nextcloud --dry-run
sh scripts/update-nextcloud-player.sh --engine YOUR_ENGINE_CONTAINER --nextcloud nextcloud
```

Alternatively, `--image YOUR_RELEASE_IMAGE` extracts the helper through a temporary, stopped container and removes that container afterward. A dry run extracts the bundle and checks its identity, installed version and target path without changing Nextcloud. A normal update stages and checks Nextcloud compatibility before replacing the named helper directory. Downgrades are rejected. Concurrent updates are blocked by a lock in the selected apps directory.

Before replacing existing code, the updater saves that app to `./memories-rkmpp-backups/` on the Docker host, with its container, path and prior version in `metadata.txt`. Change this location with `--backup-dir`. The backup includes only this connector's code. A failed activation restores the previous code and exits with an error; check the app's recorded version before retrying, since code restoration does not rewind app metadata. If restoration or an interrupted update leaves a lock, its `old/` directory is retained for recovery.

To roll back a successful connector update, disable `memories_rkmpp_player`, restore the saved `app/` directory to the exact path recorded in `metadata.txt`, restore its web-server ownership, set this app's `installed_version` to the saved `previous_version` using `occ config:app:set`, then enable the app again. The current connector has no database migrations. Retain the previous engine image separately for an engine rollback. If connector installation fails during deployment, the deployment command exits unsuccessfully and the engine remains running; correct the reported connector issue and rerun its updater.

The updater and its PHP control file are also bundled beside the app in `/usr/share/memories-rkmpp/`, so they can be extracted with `docker cp` when only the release image is available. Keep both files together when running the updater outside this checkout.

The helper is recommended for HEVC negotiation and portrait labels. `MEMORIES_RKMPP_CODEC=h264` forces the compatibility output for troubleshooting. The default `hevc` still requires client support; it does not force unsupported clients to decode HEVC. Child playlists preserve the negotiated codec list so the output format stays consistent across qualities and seeks.

### Playback settings

Helper **0.3.4** provides **Playback settings** in Memories navigation and a gear beside the viewer's top-right controls. Preferences are saved for this browser. If browser storage is blocked, they apply for the current visit. The connector lives in Nextcloud's persistent app directory; its version is bundled with the engine. A future Nextcloud major upgrade still needs a compatible connector release.

**Video format** offers Auto, HEVC/H.265 preferred, and H.264 compatibility. Auto permits the original-playback trial, leaving the original file's codec unchanged; its HLS fallback prefers HEVC when supported. Explicit HEVC or H.264 preferences go directly to adaptive HLS. HEVC preferred still respects the browser's MediaSource support and one-time AVC recovery. Selecting either explicit format during original playback preserves position and pause state when loading HLS. Returning to Auto keeps that asset on HLS, avoiding repeated original/fallback loops. HLS buffer changes apply during playback.

These format and buffer preferences integrate with hls.js. Native HLS buffering remains controlled by the browser and upstream player; the hls.js settings do not override that path.

| Buffer profile | Target |
| --- | --- |
| Auto | Starts balanced at 12 seconds; adapts to about 6–18 seconds using estimated bandwidth and the selected rendition's bitrate. |
| Responsive | 6 seconds. |
| Smooth | 18 seconds. |
| Custom | 6–30 seconds. |

All profiles retain a 32 MB video budget, which can shorten the target for higher-bitrate video. Quality changes preserve audio using the switching policy described above.

**Test connection** downloads about 2.2 MB from this Nextcloud server: a 128 KiB warm-up followed by two timed 1 MiB requests. It measures the current path to Nextcloud, including server and proxy overhead, rather than an ISP's advertised speed. It uses the signed-in session and no external speed-test service. The slower sample guides the recommendation: above 25 Mbps selects Responsive, 6–25 Mbps selects Auto, and below 6 Mbps or strongly varying samples selects Smooth. Recommendations use format Auto; **Use recommendation** applies them, and **Reset to Auto** restores the defaults.

The authenticated connection-test endpoint bounds each response to 64 KiB–1 MiB and limits a user to six requests per minute, enough for two complete tests. The panel, connection test, browser-local settings, top-right placement and close behavior have been checked on the live Nextcloud installation. Playback remains subject to browser, decoder and network limits; no universal click-free or zero-rebuffering guarantee is made.

## Future updates

Upgrade Memories and this custom backend as a tested pair. Check the installed Memories application's required go-vod version against the candidate before changing the running stack. Retain the previous image and stack definition.

The container health check verifies Nextcloud connectivity and the tested Memories app version. It reports a compatibility mismatch after an independent app update. This detects version drift; it does **not** prevent manual Memories updates or automatically port the hardware backend to a new protocol.

## Verification

See `VERIFICATION.md` for the completed checks and remaining limits. Source originals are never rewritten. Private media, service tokens, passwords, and server-specific deployment backups are excluded from this package.

## Credits and source

Memories source base: `d59c33d94d4e9627565e2023eb3c5c798788ebe2` (v10.2.0); upstream go-vod protocol tag: `9116b5e6436e4e01a3226460acd092cf62f1f088` (0.6.3).

The engine Dockerfile pins its Go builder and Jellyfin media image by digest. The release image inherits that engine and adds the matching Nextcloud app and host updater. It contains the Go server, FFmpeg/FFprobe, runtime libraries, and licenses, with no shell or compiler. The source engine build runs Go race tests and `go vet` before compiling the runtime binary.

Thanks to [Memories](https://github.com/pulsejet/memories), [Jellyfin FFmpeg](https://github.com/jellyfin/jellyfin-ffmpeg), [ffmpeg-rockchip](https://github.com/nyanmisaka/ffmpeg-rockchip), and the Rockchip MPP/RGA contributors. Upstream licenses are retained alongside their sources.
