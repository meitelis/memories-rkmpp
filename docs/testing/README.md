# Testing

Run source checks before building or deploying. Keep private media, tokens, deployment configuration and captures outside Git.

## Browser and Go source checks

```sh
npm ci --ignore-scripts
npm test
cd go-vod
go test -race ./...
go vet ./...
go build ./...
```

Use Linux for the Go integration tests, which include shell-based fixtures. The browser suite includes the pinned hls.js 1.7.4 controllers and exercises fast/slow startup, failed probes, Original availability, capability negotiation and later native downshifts. These controller checks do not decode browser media.

From the repository root:

```sh
sh -n scripts/build-v11.sh scripts/install-player-v11.sh scripts/deploy-v11.sh scripts/test-v11-deploy-preflight.sh
sh scripts/test-v11-deploy-preflight.sh
bash -n scripts/test-v11-rkmpp.sh scripts/test-v11-network.sh
php scripts/test-v11-compat.php
docker compose -f compose.yml config --quiet
```

The deployment preflight uses a fake Docker CLI: it verifies version checks, project ownership and image-tag consistency without operating a server. CI also lints the helper's PHP files.

## Isolated board tests

```sh
bash scripts/test-v11-rkmpp.sh --matrix
```

Run on the ROCK 5B+ with the required devices. The runner builds a separate image and generates disposable fixtures; it does not change Nextcloud or the running stack. See [hardware validation](hardware.md) for coverage, output records and existing-sample usage. A recorded older matrix does not establish all behavior for a newer source revision.

## Live browser checks

Check the actual target browser after engine/helper updates:

1. Start a compatible source in Auto on a fast connection; verify actual Original dimensions, playback beyond the startup boundary, and normal audio progression.
2. Select Original and a lower encoded quality, then return to Auto. Confirm the native Auto state and eventual presented dimensions.
3. Test a slow connection from startup, then throughput drop/recovery and available network-change events.
4. Seek forward/backward, pause/resume, navigate repeatedly and play to the end. Watch for stalls, stale requests and timestamp gaps.
5. Check audible continuity and real HDR appearance separately from frame/buffer counters.

Adding `?rkmpp_debug` to the Memories page enables bounded diagnostic data on the status badge, including fragment timing, Auto state, buffer and frame counts. Remove the parameter for normal use. Debug traces omit media URLs and credentials.

The [10 November record](../verification/auto-original-2026-11-10.md) covers the recent Auto startup and Main10 Original update. [Historical acceptance notes](../history/playback-2026-11-07.md) describe older adapters and policies.

## Optional network shaping

```sh
bash scripts/test-v11-network.sh nextcloud 443
```

This deliberately shapes that container's IPv4 HTTPS responses, including the speed probe, through a bounded 20 Mbps → 800 kbps → 4 Mbps → 80 Mbps profile. Internal bridge traffic is excluded. Existing traffic-control state causes an early exit; EXIT/INT/TERM handlers restore the original noqueue state. Run this deliberately during validation, not as part of routine deployment.
