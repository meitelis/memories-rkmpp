# Memories 11.0.2 RK3588 migration

The active server is `go-vod-v11/`, based on upstream Memories 11.0.2 and protocol **0.7.0**. `upstream-v11/go-vod/` is the immutable comparison baseline. The installed application is already Memories 11.0.2; deployment uses the root `compose.yml` and `scripts/deploy-v11.sh`.

The old `go-vod/` 0.6.3 engine and `memories_rkmpp_player` belong to Memories 10.2. They are retained as historical source, documented in `LEGACY_MEMORIES_10.2.md`, and must not be deployed into Memories 11. The v11 script disables the obsolete helper and installs `memories_rkmpp_v11`.

The v11 server preserves upstream fMP4, authenticated callbacks, bridge reads and 0.7.0 request envelopes. RKMPP strict mode requires MPP decode/encode, RGA transforms and successful Mali OpenCL HDR probes. Unsupported video fails explicitly. Shared AAC playlists allow video-quality changes without restarting audio; lower audio rates are lazy independent tracks.

See `README.md` for deployment, `HARDWARE_TEST_V11.md` for reproducible board tests, `PLAYER_INTEGRATION_V11.md` for adaptive playback, and `PROGRESS_MEMORIES_11.md` for the current checkpoint and outstanding acceptance work. Code is not ready for mainline merely because unit tests and Docker builds pass; real playback must satisfy the agreed quality, buffering, seeking and audio requirements first.
