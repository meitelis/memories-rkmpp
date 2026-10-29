# Memories RK3588 transcoder

Experimental hardware transcoder for Memories **10.2.0** and go-vod protocol **0.6.3**. Based on the official Memories v10.2.0 source, with RKMPP support carried forward. This is a full protocol update, including Nextcloud's per-file service tokens and HTTP media input.

The tested platform is a Radxa ROCK 5B+ running Armbian's 6.1 vendor kernel. Other boards and kernels need their own validation.

## Hardware and playback

Supported SDR sources use MPP decoding and RGA scaling/rotation. The default output is hardware HEVC (`hevc_rkmpp`) when the client reports support, with hardware AVC (`h264_rkmpp`) as the compatibility fallback. There is no software video-encoder fallback. Unsupported source formats can require CPU decoding; HDR tone mapping, audio processing, and preview generation use CPU work. Dolby Vision rendering is not validated. Compatible originals can be served without re-encoding on the AVC path.

The backend retains the shared rendition clock, independently decodable HLS segments, bounded bitrate, six-second startup fragment, three-second later fragments, direct cold seeks, and hardware-safe buffering from the previous custom build. Inactive encoders are released after 15 seconds. Audio timestamps are preserved; a video-only tail is valid when its audio has already ended.

The `memories_rkmpp_player` companion app checks HEVC MediaSource support before requesting the master playlist, starts Auto at the highest available short edge up to 1080p, and leaves adaptive quality enabled. It corrects portrait quality labels without altering HLS dimensions or quality selection. It retries once with AVC if a fatal codec error contradicts the browser's support report. It does not modify or rebuild signed Memories assets. Without the helper, negotiation uses Memories' file-playback capability report, which can differ from MSE support.

## Build and connect

Start with a local checkout:

```sh
git clone https://github.com/meitelis/memories-rkmpp.git
cd memories-rkmpp
```

1. Copy `.env.example` to `.env`. Set the internal Nextcloud URL and existing Docker network. Set the device group IDs to match your host.
2. Build on the ARM64 Docker host:

   ```sh
   docker build -f go-vod/Dockerfile.rkmpp -t local/memories-go-vod:rkmpp-10.2.0-v0.6.3-r3 go-vod
   docker compose up -d
   ```

3. In Memories administration, enable external video transcoding and use `memories-rkmpp:47788`. Leave VA-API and NVENC disabled.

The image needs `/dev/mpp_service`, `/dev/rga`, `/dev/dma_heap`, and `/dev/dri`. The tested vendor driver also requires `systempaths=unconfined`; the supplied configuration retains the default AppArmor profile, drops capabilities, runs as UID1000, and keeps the root filesystem read-only.

Only the transcoder cache needs a writable volume. The new protocol fetches media through Nextcloud, so the transcoder needs no direct data or photo mounts. Keep your external photo folder mounted read-only in **Nextcloud**, with its existing external-storage configuration. No host ports are published.

For Portainer, build the image on the host first, then use the supplied Compose definition and environment variables. Keep an existing deployment's cache volume name when updating it.

Use a Nextcloud URL that is reachable from the transcoder and accepted by Nextcloud's trusted-domain configuration. The supplied `preflight.py` currently targets the LinuxServer Nextcloud layout (`/app/www/public`, web-server user `abc`); other images need an equivalent version check.

### Optional player helper

Copy `memories_rkmpp_player/` into your persistent Nextcloud apps directory, then enable it with `occ app:enable memories_rkmpp_player` as Nextcloud's web-server user. Reload Memories afterward. The helper currently declares support for Nextcloud 35, which is the tested version. Its AGPL license is separate from the backend's Apache license.

The helper is recommended for HEVC negotiation and portrait labels. `MEMORIES_RKMPP_CODEC=h264` forces the compatibility output for troubleshooting. The default `hevc` still requires client support; it does not force unsupported clients to decode HEVC. Child playlists preserve the negotiated codec list so the output format stays consistent across qualities and seeks.

## Future updates

Upgrade Memories and this custom backend as a tested pair. Check the installed Memories application's required go-vod version against the candidate before changing the running stack. Retain the previous image and stack definition.

The container health check verifies Nextcloud connectivity and the tested Memories app version. It reports a compatibility mismatch after an independent app update. This detects version drift; it does **not** prevent manual Memories updates or automatically port the hardware backend to a new protocol.

## Verification

See `VERIFICATION.md` for the completed checks and remaining limits. Source originals are never rewritten. Private media, service tokens, passwords, and server-specific deployment backups are excluded from this package.

## Credits and source

Memories source base: `d59c33d94d4e9627565e2023eb3c5c798788ebe2` (v10.2.0); upstream go-vod protocol tag: `9116b5e6436e4e01a3226460acd092cf62f1f088` (0.6.3).

The Dockerfile pins its Go builder and Jellyfin media image by digest. The final image contains the Go server, FFmpeg/FFprobe, runtime libraries, and licenses, with no shell or compiler. The source build runs Go race tests and `go vet` before compiling the runtime binary.

Thanks to [Memories](https://github.com/pulsejet/memories), [Jellyfin FFmpeg](https://github.com/jellyfin/jellyfin-ffmpeg), [ffmpeg-rockchip](https://github.com/nyanmisaka/ffmpeg-rockchip), and the Rockchip MPP/RGA contributors. Upstream licenses are retained alongside their sources.
