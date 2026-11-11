# Upstream review preparation — 11 November 2026

Source: `meitelis/memories-rkmpp` main at `d6a9471dfbd3dd721bd67698c062ddcc773e232c`.
Target: `pulsejet/memories` master at `21294a81d1dae8ecc82d9c3f29d652c7a13c3c6f`.

These are review candidates, not a submitted or fully validated upstream port.

## Patch order

1. `0001-wake-abandoned-hls-requests.diff`: a focused, backend-independent fix. Wake pending segment requests when clearing or pruning their producer; recognize a producer replaced by nil. Includes the two existing request-wakeup regressions from the custom repository. This can be reviewed separately from hardware support.
2. `0002-rkmpp-engine.diff`: the remaining Go engine changes, rebased by three-way file merge from v11.1.1 onto current master. Adds optional MPP/RGA encoding, source-grid Original/shared AAC, codec negotiation, input pacing and their existing Go tests. This is a larger technical reference to split further after maintainer feedback.

RKMPP is explicitly enabled with `MEMORIES_RKMPP=1`. The upstream Dockerfiles, entrypoint, PHP application, native Vue player, dependencies and other hardware implementations are retained. Current upstream HTTP reconnect detection, version 0.7.1 and display-rotation reset are preserved. No custom image builder, Portainer configuration, helper app or Android experiment is part of these patches. Open draft PRs #19/#20 were not imported; the source is the merged main branch, which already retains 3.5x catch-up.

## Upstream integration boundaries

Hardware-specific support belongs beside VA-API/NVENC and must remain opt-in. Stream-waiter fixes are independent. Browser adaptation and Original-selection behavior should be a separate change to the native player, not injected companion scripts.

The RKMPP engine patch alone does **not** port the companion player's startup probing, Main10 MediaSource checks, quality labels or Auto recovery into upstream Vue. Those remain in `memories_rkmpp_v11/js/` for reference. Enabling the optional backend without that frontend port does not reproduce the custom deployment's complete behavior. An upstream change also needs documented FFmpeg/Rockchip prerequisites and agreement on packaging an optional compatible FFmpeg rather than replacing everyone's default image.

## Validation and remaining gates

- Both patches replayed sequentially on a fresh checkout of the exact target and produced the expected final Git tree. Patch whitespace checks passed. SHA-256 values and final tree are in `manifest.json`.
- The unchanged custom browser source suite passed locally: 43/43. This validates the original helper tests, not the rebased native engine or an upstream Vue port.
- A Go compiler, Docker and PHP are unavailable in this environment. The executable named `go` is an unrelated program. No Go compile, race suite, vet, ARM64 image build or new board/browser run is claimed for these patches.
- Before submission, run `go test -race ./...`, `go vet ./...`, and `go build ./...` from `go-vod/` on both the focused fix and complete candidate. Use upstream's required lint/format workflows for later PHP/TypeScript changes.
- Verify unchanged CPU, VA-API and NVENC behavior with RKMPP disabled. On RK3588, verify H.264/HEVC, SDR10/HDR, rotation, shared audio, Original/cold seeks, cancellation, and concurrent streams. Hardware traces from the previous custom image do not validate the newly rebased engine.
- Review engine resource bounds: hardware concurrency, pacing when paused, keyframe-grid/GOP bounds, and per-manager HDR capability probing. Do not represent these as resolved by patch replay.
- Check new go-vod/Nextcloud protocol compatibility and implement native browser negotiation before proposing complete playback integration.

## Inspect safely

Run `python3 verify.py /path/to/clean/memories-checkout` with the checkout at the exact target commit. It verifies checksums and patch replay in a temporary clone, without changing the supplied checkout or any running service. The patches can then be applied manually on a review branch with `git apply --index`, in the order above.

Neither repository is currently a GitHub fork of its upstream. A normal upstream PR will need a genuine fork with upstream ancestry and the selected native-source commits. Do not open a PR from the custom repository's main branch or upload the deployment package wholesale.
