#!/bin/sh
# Standalone Compose only. Portainer updates stay in their existing stack.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
nextcloud=${NEXTCLOUD_CONTAINER:-nextcloud}
image=${MEMORIES_RKMPP_IMAGE:-local/memories-rkmpp:memories-11.1.1-govod-0.7.0-r10}
occ() { docker exec "$nextcloud" php /app/www/public/occ "$@"; }
version=$(occ config:app:get memories installed_version)
[ "$version" = 11.1.1 ] || { echo "Expected Memories 11.1.1, found $version" >&2; exit 1; }
if docker container inspect memories-rkmpp >/dev/null 2>&1; then
    project=$(docker inspect memories-rkmpp --format '{{index .Config.Labels "com.docker.compose.project"}}')
    if [ "$project" != memories_v11 ]; then
        printf 'memories-rkmpp belongs to project "%s". Update its existing stack instead; see docs/deployment.md.\n' "$project" >&2
        exit 1
    fi
fi
export MEMORIES_RKMPP_IMAGE="$image"
sh "$root/scripts/build-v11.sh"
docker volume create memories-rkmpp-v11-cache >/dev/null
docker compose -p memories_v11 -f "$root/compose.yml" up -d --no-deps --wait --wait-timeout 90 memories-rkmpp
sh "$root/scripts/install-player-v11.sh"
