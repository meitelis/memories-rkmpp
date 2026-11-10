#!/bin/sh
# Build and test the ARM64 engine; do not start or replace services.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
image=${MEMORIES_RKMPP_IMAGE:-local/memories-rkmpp:memories-11.1.1-govod-0.7.0-r10}
docker build --platform linux/arm64 -f "$root/go-vod/Dockerfile.rkmpp-test" -t local/memories-rkmpp:v11-smoke "$root/go-vod"
docker build --platform linux/arm64 -f "$root/go-vod/Dockerfile.rkmpp" -t "$image" "$root/go-vod"
printf 'Built %s. Existing services are unchanged.\n' "$image"
