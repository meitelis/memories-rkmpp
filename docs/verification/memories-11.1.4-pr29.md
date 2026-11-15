# Memories 11.1.4 / PR #29 acceptance — 15 November 2026

## Source and scope

- Tested fork: [Memories RKMPP PR #29](https://github.com/meitelis/memories-rkmpp/pull/29), merged into `main` at `336e5396e4beb8decb360b8b40c5c46b44976453`.
- Source: Memories **11.1.4**, go-vod **0.7.3**, ROCK 5B+ RK3588 on vendor 6.1 kernel.
- Change: serialize missing HLS fragment restart decisions and FFmpeg producer initialization under the stream mutex, so parallel requests share one encoder instead of replacing each other.
- Build tag: `local/memories-rkmpp:11.1.4-pr29`. Image ID: `sha256:987cb2b2279e84b2431de8b2af9a5c34c2fa905b1627a3f0da93d4f25902e4b7`.
- Rollback tag observed before deployment: `local/memories-rkmpp:11.1.4-candidate`.

## Verification performed

1. GitHub ARM64 `Source checks` and `v11 RKMPP offline image build` both passed.
2. On 15 November, the owner built the candidate on the ROCK 5B+ using `scripts/build-v11.sh`. Go unit tests, formatting, vet, image compilation and export completed.
3. The owner executed `RKMPP_SMOKE_SKIP_BUILD=1 bash scripts/test-v11-rkmpp.sh --matrix` using a dedicated scratch location. All three hardware suites returned `PASS`:
   - `ffmpeg.test`: H.264/HEVC, 10 source codec families, 4K/HDR, aligned clocks, B frames, source grids, pacing and restart arguments.
   - `core.test`: source-aligned serving, real fMP4 seeking/restaring for copy and RKMPP transcode, H.264/HEVC rendering and shared AAC.
   - `api.test`: authenticated local-fixture stream, bitrate variants, shared audio and generated segments.
4. Logs showed `-readrate 1 -readrate_initial_burst 18 -readrate_catchup 3.5` on hardware-encoded inputs. Expected FFmpeg mono-layout guesses were nonfatal.
5. After live testing, the owner reported **“plays all very well”** and authorized merging PR #29.

## Limitations

The test matrix is synthetic and isolated; real-client acceptance is the owner's observation, not a controlled bandwidth/loss benchmark. It does not establish universal immunity to stalls, Chrome/Android/Safari equivalence, or perceptual HDR/AAC guarantees. This is a precise record of the tested change, not a claim that all streaming races are impossible.

## Updating an existing Portainer stack

Keep the same production Compose project, volumes, devices, network and cache; update **only the engine image** to the tested candidate. PR #29 changes no Memories browser helper or go-vod protocol version, so there is no requirement to reinstall the Nextcloud helper for this fix. Preserve the previous image for rollback.
