# Memories RK3588 transcoder

Experimental hardware transcoder for Memories **10.2.0** and go-vod protocol **0.6.3**. Based on the official Memories v10.2.0 source, with RKMPP support carried forward. This is a full protocol update, including Nextcloud's per-file service tokens and HTTP media input.

The tested platform is a Radxa ROCK 5B+ running Armbian's 6.1 vendor kernel. Other boards and kernels need their own validation.

The current **R6 / helper 0.3.0 candidate** adds AAC audio preservation and integrated playback settings to the validated R5 backend. Its full Go race suite, go vet and ARM64 image build passed on the server. Initial 48 kHz audio and local GUI checks passed; 44.1 kHz, the complete fragment matrix and live playback/connection-test checks are still pending. R6 has not yet replaced the live deployment. See `VERIFICATION.md` for the completed checks and remaining work.

## Hardware and playback

Supported SDR sources use MPP decoding and RGA scaling/rotation. The default output is hardware HEVC (`hevc_rkmpp`) when the client reports support, with hardware AVC (`h264_rkmpp`) as the compatibility fallback. There is no software video-encoder fallback. Supported HDR10/PQ and HLG sources use Mali OpenCL tone mapping to SDR, between MPP decoding/RGA scaling and hardware encoding. A real-frame probe checks this pipeline per rendition; unsupported profiles or failed GPU probes retain CPU tone mapping with hardware encoding. Unsupported source formats can require CPU decoding; audio normalization and preview generation also use CPU work. Dolby Vision rendering is not validated. Compatible originals can be served without re-encoding on the AVC path.

The backend retains the shared rendition clock, independently decodable HLS segments, bounded bitrate, six-second startup fragment, three-second later fragments, direct cold seeks, and hardware-safe buffering from the previous custom build. Inactive encoders are released after 15 seconds. Audio timestamps are preserved; a video-only tail is valid when its audio has already ended.

The candidate copies known mono/stereo AAC-LC audio at 44.1 or 48 kHz and up to 256 kbps into each RKMPP rendition, retaining its source packets and timestamps. This avoids starting a separate AAC encoder for compatible audio when changing quality or seeking. Other audio, including unknown profiles or bitrates, retains stereo 48 kHz AAC normalization. The candidate also refreshes older probe-cache entries so the audio profile and bitrate are available for this decision. Source originals are never rewritten; click-free switching still requires live validation.

R6 explicitly sets `avoid_negative_ts=disabled` on each child HLS muxer as well as the outer output. This removes the experimentally reproduced 21.333 ms warm/cold timestamp shift in the audited 48 kHz case. All 140 compared AAC packets retained matching timestamps and payloads in that check; the 44.1 kHz and full rendition matrix checks remain pending.

R5 shares cold source and keyframe analysis across viewers while keeping their playback state and credentials separate. Concurrent requests for the same cold fragment share one encoder start. Startup fragments are validated before sending and read once when delivered. A failed shared probe is retried with the waiting viewer's own credentials.

The `memories_rkmpp_player` companion app checks HEVC MediaSource support before requesting the master playlist, starts Auto at the highest available short edge up to 1080p, and leaves adaptive quality enabled. Auto respects the display’s actual pixel density without an artificial 1.5× ceiling; available quality still depends on player size, measured bandwidth, and dropped frames. It corrects portrait quality labels using the shorter displayed edge, without altering HLS dimensions or quality selection.

Manual quality changes use hls.js's `nextLevel` policy: the playing fragment and fetch-time padding remain buffered while later fragments are replaced. The displayed resolution changes after the new rendition is ready at a safe fragment boundary. The helper retries once with AVC if a fatal codec error contradicts the browser's support report. It does not modify or rebuild signed Memories assets. Without the helper, negotiation uses Memories' file-playback capability report, which can differ from MSE support.

## Build and connect

Start with a local checkout:

```sh
git clone https://github.com/meitelis/memories-rkmpp.git
cd memories-rkmpp
```

1. Copy `.env.example` to `.env`. Set the internal Nextcloud URL and existing Docker network. Set the device group IDs to match your host.
2. Build on the ARM64 Docker host:

   ```sh
   docker build -f go-vod/Dockerfile.rkmpp -t local/memories-go-vod:rkmpp-10.2.0-v0.6.3-r6 go-vod
   docker compose up -d
   ```

3. In Memories administration, enable external video transcoding and use `memories-rkmpp:47788`. Leave VA-API and NVENC disabled.

The supplied GPU-enabled image needs `/dev/mpp_service`, `/dev/rga`, `/dev/dma_heap`, `/dev/dri`, and `/dev/mali0`. The tested vendor driver also requires `systempaths=unconfined`; the supplied configuration retains the default AppArmor profile, drops capabilities, runs as UID1000, and keeps the root filesystem read-only.

Only the transcoder cache needs a writable volume. The new protocol fetches media through Nextcloud, so the transcoder needs no direct data or photo mounts. Keep your external photo folder mounted read-only in **Nextcloud**, with its existing external-storage configuration. No host ports are published.

For Portainer, build the image on the host first, then use the supplied Compose definition and environment variables. Keep an existing deployment's cache volume name when updating it.

Use a Nextcloud URL that is reachable from the transcoder and accepted by Nextcloud's trusted-domain configuration. The supplied `preflight.py` currently targets the LinuxServer Nextcloud layout (`/app/www/public`, web-server user `abc`); other images need an equivalent version check.

`MEMORIES_RKMPP_OPENCL=false` disables GPU tone mapping for troubleshooting. The image includes one Mali OpenCL runtime from the same pinned Jellyfin media image; the host kernel driver must be compatible. GPU initialization alone is insufficient, so the backend probes a decoded, scaled, tone-mapped and encoded frame before choosing this path. SDR sources skip tone mapping. HDR output is currently converted to SDR; this is not HDR passthrough.

### Optional player helper

Copy `memories_rkmpp_player/` into your persistent Nextcloud apps directory, then enable it with `occ app:enable memories_rkmpp_player` as Nextcloud's web-server user. Reload Memories afterward. The helper currently declares support for Nextcloud 35, which is the tested version. Its AGPL license is separate from the backend's Apache license.

The helper is recommended for HEVC negotiation and portrait labels. `MEMORIES_RKMPP_CODEC=h264` forces the compatibility output for troubleshooting. The default `hevc` still requires client support; it does not force unsupported clients to decode HEVC. Child playlists preserve the negotiated codec list so the output format stays consistent across qualities and seeks.

### Playback settings

The candidate helper **0.3.0** adds **Playback settings** to the Memories navigation beside its existing settings entry. Preferences are saved for this browser. If browser storage is blocked, they apply for the current visit.

**Video format** offers Auto, HEVC/H.265 preferred, and H.264 compatibility. Auto prefers HEVC when the browser reports MediaSource support. HEVC preferred still respects that support check and the one-time AVC recovery; it cannot force an unsupported decoder. Buffer changes apply during playback. Format changes keep the playback position and pause state, with a brief reload when the codec changes.

These format and buffer preferences integrate with hls.js. Native HLS buffering remains controlled by the browser and upstream player; the hls.js settings do not override that path.

| Buffer profile | Target |
| --- | --- |
| Auto | Starts balanced at 12 seconds; adapts to about 6–18 seconds using estimated bandwidth and the selected rendition's bitrate. |
| Responsive | 6 seconds. |
| Smooth | 18 seconds. |
| Custom | 6–30 seconds. |

All profiles retain a 32 MB video budget, which can shorten the target for higher-bitrate video. Manual quality changes continue to preserve the playing fragment with the `nextLevel` policy.

**Test connection** downloads about 2.2 MB from this Nextcloud server: a 128 KiB warm-up followed by two timed 1 MiB requests. It measures the current path to Nextcloud, including server and proxy overhead, rather than an ISP's advertised speed. It uses the signed-in session and no external speed-test service. The slower sample guides the recommendation: above 25 Mbps selects Responsive, 6–25 Mbps selects Auto, and below 6 Mbps or strongly varying samples selects Smooth. Recommendations use format Auto; **Use recommendation** applies them, and **Reset to Auto** restores the defaults.

The connection-test endpoint bounds each response to 64 KiB–1 MiB and limits a signed-in user to six requests per minute, enough for two complete tests. The local browser preview passed first-click opening, backdrop dismissal, saving format/Custom settings across reload, and Reset to Auto. Live Nextcloud integration, connection-test behavior and actual video transitions still need verification.

## Future updates

Upgrade Memories and this custom backend as a tested pair. Check the installed Memories application's required go-vod version against the candidate before changing the running stack. Retain the previous image and stack definition.

The container health check verifies Nextcloud connectivity and the tested Memories app version. It reports a compatibility mismatch after an independent app update. This detects version drift; it does **not** prevent manual Memories updates or automatically port the hardware backend to a new protocol.

## Verification

See `VERIFICATION.md` for the completed checks and remaining limits. Source originals are never rewritten. Private media, service tokens, passwords, and server-specific deployment backups are excluded from this package.

## Credits and source

Memories source base: `d59c33d94d4e9627565e2023eb3c5c798788ebe2` (v10.2.0); upstream go-vod protocol tag: `9116b5e6436e4e01a3226460acd092cf62f1f088` (0.6.3).

The Dockerfile pins its Go builder and Jellyfin media image by digest. The final image contains the Go server, FFmpeg/FFprobe, runtime libraries, and licenses, with no shell or compiler. The source build runs Go race tests and `go vet` before compiling the runtime binary.

Thanks to [Memories](https://github.com/pulsejet/memories), [Jellyfin FFmpeg](https://github.com/jellyfin/jellyfin-ffmpeg), [ffmpeg-rockchip](https://github.com/nyanmisaka/ffmpeg-rockchip), and the Rockchip MPP/RGA contributors. Upstream licenses are retained alongside their sources.
