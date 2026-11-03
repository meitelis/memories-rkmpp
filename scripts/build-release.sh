#!/bin/sh
set -eu

usage() {
    echo "Usage: sh scripts/build-release.sh --image IMAGE [--engine-image EXISTING_ENGINE_IMAGE]"
}
fail() { echo "Error: $*" >&2; exit 1; }
image= engine_image=
while [ "$#" -gt 0 ]; do
    case "$1" in
        --image|--engine-image)
            [ "$#" -ge 2 ] || fail "Missing value for $1"
            case "$1" in --image) image=$2 ;; *) engine_image=$2 ;; esac
            shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) usage >&2; fail "Unknown argument: $1" ;;
    esac
done
[ -n "$image" ] || { usage >&2; exit 1; }
case "$image" in -*|*[!A-Za-z0-9_./:-]*) fail "Use a tagged Docker image name" ;; esac
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
version=$(sed -n 's/.*<version>\([^<]*\)<\/version>.*/\1/p' "$root/memories_rkmpp_player/appinfo/info.xml")
[ -n "$version" ] || fail "Missing companion app version"
if [ -z "$engine_image" ]; then
    engine_image="${image}-engine"
    docker build -f "$root/go-vod/Dockerfile.rkmpp" -t "$engine_image" "$root/go-vod"
else
    case "$engine_image" in -*|*[!A-Za-z0-9_./:@-]*) fail "Invalid engine image reference" ;; esac
    docker image inspect "$engine_image" >/dev/null
fi
docker build -f "$root/Dockerfile.release" --build-arg "ENGINE_IMAGE=$engine_image" \
    --build-arg "PLAYER_VERSION=$version" -t "$image" "$root"
printf 'Release image: %s\nBundled playback helper: %s\n' "$image" "$version"
