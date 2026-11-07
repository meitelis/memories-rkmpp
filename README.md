# Memories 11.0.2 on RK3588

Hardware transcoding for **Nextcloud Memories 11.0.2 / go-vod 0.7.0**, tested on a ROCK 5B+ with the Armbian 6.1 vendor kernel, Rockchip MPP/RGA and Mali-G610 OpenCL.

The server requires hardware video processing: MPP decoding/encoding, RGA scaling/rotation and Mali HDR-to-SDR mapping. Unsupported video fails explicitly instead of silently using CPU video processing. Compatible SDR AVC/HEVC originals use stream copy. Audio is shared across video qualities; the browser keeps one default audio track during video quality changes.

The browser helper measures connection speed once before startup and selects an affordable initial rendition, preferring compatible Original. After startup, one quality controller uses actual completed HLS fragments and transfer headroom to try one higher quality at a time. It reduces quality when delivered segments are unsustainable or playback is approaching starvation; ordinary fragment-sized buffer oscillations do not force changes. hls.js retains fragment scheduling, a six-second buffer target and network error handling; switching uses conservative non-flushing quality selection. Paced encoder delivery does not masquerade as Internet speed. The browser badge shows the presented dimensions.

## Playback flow

```mermaid
flowchart LR
    P["Memories browser player"] -->|"playback and speed probe"| N["Nextcloud authentication"]
    N -->|"go-vod 0.7.0 requests"| M["go-vod: lazy workers and segment cache"]
    M -->|"authenticated media reads"| N
    M -->|"compatible Original"| C["Video stream copy"]
    M -->|"selected encoded quality"| D["MPP hardware decode"]
    D --> R["RGA scale and rotation"]
    R --> T["Mali OpenCL tone mapping when HDR"]
    T --> E["MPP H.264 / HEVC encode"]
    C --> V["Timestamped HLS video segments"]
    E --> V
    M --> A["Shared AAC: high / 96 / 64 / 32 kbps"]
    V --> N
    A --> N
    N -->|"HLS video + independent audio"| P
    B["One startup speed check + fragment delivery evidence"] -->|"select quality"| P
```

Only requested renditions start workers. The player prefers compatible Original when the one-time startup estimate permits it, then learns from delivered fragments and short-term buffer safety rather than repeated synthetic probes. Audio has its own shared timeline and the browser does not automatically switch audio profiles during video changes. SDR skips HDR tone mapping. The native Android client is a separate integration.

High audio is 192 kbps AAC when encoding, or the existing source bitrate when compatible AAC can be copied (up to 320 kbps). Lower profiles are 96, 64 and 32 kbps.

## Deploy on the ROCK 5B+

Docker/Compose and the device nodes in `compose.yml` are required. Copy `.env.example` to `.env` if the internal Nextcloud URL, Docker network or numeric device groups differ. The default Nextcloud layout is LinuxServer's `/app/www/public`, container `nextcloud`.

```sh
git switch main
git pull --ff-only
sh scripts/deploy-v11.sh
```

The script checks Memories 11.0.2, builds and tests the ARM64 image, starts the health-checked service, installs the browser helper and verifies the real go-vod 0.7.0 handshake. The container has a read-only root, no capabilities, no published host port and a dedicated cache volume. Original media is fetched through authenticated Nextcloud callbacks.

## Validate

```sh
node --test memories_rkmpp_v11/js/*.test.cjs
bash scripts/test-v11-rkmpp.sh --matrix
```

The board matrix tests all ten supported input codecs against both hardware encoders, PQ/HLG, RGA, packet cadence, full/cold timelines, shared audio, serving and API behavior. See [hardware tests](HARDWARE_TEST_V11.md), [playback evidence](PLAYBACK_ACCEPTANCE_V11.md) and [player integration](PLAYER_INTEGRATION_V11.md).

`go-vod/` is the only engine source, `memories_rkmpp_v11/` is the browser helper and `scripts/` contains deployment and the two reproducible board/network runners. The obsolete 10.2 engine/helper, duplicate upstream tree and old deployment tooling were removed; their source remains in Git history.

The native Android companion is developed separately on `import/laptop-2026-11-04` and is excluded from this release. Its reported startup failure remains open. Browser results do not establish native Android, Safari, public-share or perceptual HDR/audio acceptance. See [current status](PROGRESS_MEMORIES_11.md).
