> Historical snapshot. Version numbers, acceptance gates and deployment statements below describe that stage of development. Use the [current deployment](../deployment.md), [playback](../playback.md) and [testing](../testing/README.md) guides for main.

# Memories 11.0.2 migration

The active and only engine is `go-vod/`, based on upstream Memories 11.0.2 commit `e156f850ec5514433f1cfac9d4f1dbd461500c8d` and protocol **0.7.0**. The root Compose and `scripts/deploy-v11.sh` target that version explicitly.

Main previously used Memories 10.2 / go-vod 0.6.3. That source, its helper, deployment tooling and verification records remain accessible at commit `2938ae0754f1707a1a924cf89b5d601ec3383075`. They are removed from the current tree. The upstream baseline is referenced by its immutable commit rather than duplicated in a second source directory.

The migration preserves upstream fMP4, authenticated callbacks, bridge reads and request envelopes. Strict RKMPP mode requires MPP decoding/encoding, RGA transforms and successful Mali HDR probes. Shared audio has one sample clock across the video ladder.

The native Android companion is intentionally outside this server/browser release and stays on `import/laptop-2026-11-04`. It must be validated independently before inclusion.
