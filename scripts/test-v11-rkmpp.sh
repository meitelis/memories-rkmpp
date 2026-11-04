#!/usr/bin/env bash
# Safe ROCK 5B+ hardware validation: no Nextcloud ports, secrets or writes.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
sample="${1:?Usage: bash scripts/test-v11-rkmpp.sh /absolute/path/to/video.mp4 [-codec hevc] [-start 6]}"
shift
sample="$(realpath "$sample")"
[[ -f "$sample" ]] || { echo "Sample not found: $sample" >&2; exit 2; }
[[ "$(uname -m)" == "aarch64" ]] || { echo "Run on the ROCK 5B+ (ARM64), not Windows or x86." >&2; exit 2; }
image="local/memories-rkmpp:v11-smoke"
output_dir="${RKMPP_SMOKE_OUTPUT:-$HOME/memories-v11-smoke}"
mkdir -p "$output_dir"
output_dir="$(realpath "$output_dir")"

echo "Building separate offline test image ($image)..."
docker build --platform linux/arm64 -f "$repo_root/go-vod-v11/Dockerfile.rkmpp-test" -t "$image" "$repo_root/go-vod-v11"

devices=(/dev/mpp_service /dev/rga /dev/dma_heap /dev/dri)
if [[ -e /dev/mali0 ]]; then devices+=(/dev/mali0); fi
docker_args=()
for dev in "${devices[@]}"; do
  [[ -e "$dev" ]] || { echo "Missing Rockchip device: $dev" >&2; exit 3; }
  docker_args+=(--device "$dev:$dev")
done
declare -A groups=()
for dev in "${devices[@]}"; do
  while IFS= read -r gid; do
    [[ -n "$gid" ]] && groups["$gid"]=1
  done < <(find "$dev" -type c -printf '%g\n' 2>/dev/null)
done
for gid in "${!groups[@]}"; do docker_args+=(--group-add "$gid"); done

echo "Testing isolated video sample; output: $output_dir"
docker run --rm \
  --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges \
  --pids-limit 256 \
  --tmpfs /tmp:rw,nosuid,nodev,size=64m,mode=1777 \
  --user "$(id -u):$(id -g)" \
  "${docker_args[@]}" \
  --mount "type=bind,src=$sample,dst=/samples/input.mp4,readonly" \
  --mount "type=bind,src=$output_dir,dst=/cache" \
  "$image" -input /samples/input.mp4 -output /cache "$@"
echo "Smoke output retained in: $output_dir"
