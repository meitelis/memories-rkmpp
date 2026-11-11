#!/usr/bin/env bash
# Safe ROCK 5B+ hardware validation: no Nextcloud ports, secrets or writes.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
sample="${1:?Usage: bash scripts/test-v11-rkmpp.sh /absolute/path/to/video.mp4 [flags] OR --matrix}"
shift
mode=sample
if [[ "$sample" == --matrix ]]; then
  mode=matrix
else
  sample="$(realpath "$sample")"
  [[ -f "$sample" ]] || { echo "Sample not found: $sample" >&2; exit 2; }
fi
[[ "$(uname -m)" == "aarch64" ]] || { echo "Run on the ROCK 5B+ (ARM64), not Windows or x86." >&2; exit 2; }
image="local/memories-rkmpp:v11-smoke"
output_dir="${RKMPP_SMOKE_OUTPUT:-$HOME/memories-v11-smoke}"
mkdir -p "$output_dir"
output_dir="$(realpath "$output_dir")"
mkdir -p "$output_dir/tmp"

echo "Building separate offline test image ($image)..."
if [[ "${RKMPP_SMOKE_SKIP_BUILD:-0}" != 1 ]]; then
  docker build --platform linux/arm64 -f "$repo_root/go-vod/Dockerfile.rkmpp-test" -t "$image" "$repo_root/go-vod"
fi

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
  done < <(find "$dev" -type c -printf '%G\n' 2>/dev/null)
done
for gid in "${!groups[@]}"; do docker_args+=(--group-add "$gid"); done

protocol_version="$(docker run --rm --network none --entrypoint /app/go-vod "$image" -version)"
[[ "$protocol_version" == 'go-vod 0.7.1' ]] || { echo "Wrong protocol: $protocol_version" >&2; exit 4; }

echo "Testing isolated $mode; output: $output_dir"
# MPP reads /proc/device-tree/compatible through /sys/firmware. Docker's
# default system-path mask hides it, making HEVC fail as 'soc unknown'.
# Keep read-only filesystems, dropped capabilities and no-new-privileges.
run_args=(run --rm --network none --read-only --cap-drop ALL
  --security-opt no-new-privileges --security-opt systempaths=unconfined
  --pids-limit 256 --tmpfs /tmp:rw,nosuid,nodev,size=64m,mode=1777
  --user "$(id -u):$(id -g)" "${docker_args[@]}"
  --mount "type=bind,src=$output_dir,dst=/cache")
{
  date -u +'%Y-%m-%dT%H:%M:%SZ'
  uname -a
  git -C "$repo_root" rev-parse HEAD
  (cd "$repo_root"; find go-vod scripts -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum)
  docker image inspect "$image" --format '{{.Id}} {{.Architecture}}'
  printf '%s\n' "$protocol_version"
} >"$output_dir/environment.txt"
if [[ "$mode" == matrix ]]; then
  for suite in ffmpeg core api; do
    selection='^(TestRKMPPHardware.*|TestSegmentArgsRestartFMP4)$'
    if [[ "$suite" == core ]]; then selection='^(TestRKMPPHardware.*|TestFMP4SeekRestart)$'; fi
    docker "${run_args[@]}" -e MEMORIES_RKMPP_HW_TEST=1 --entrypoint "/app/$suite.test" \
      "$image" -test.run "$selection" -test.v -test.timeout 5m \
      2>&1 | tee "$output_dir/$suite-tests.log"
  done
else
  docker "${run_args[@]}" --mount "type=bind,src=$sample,dst=/samples/input.mp4,readonly" \
    "$image" -input /samples/input.mp4 -output /cache "$@" 2>&1 | tee "$output_dir/smoke.log"
fi
echo "Smoke output retained in: $output_dir"
