#!/bin/sh
# Memories 11.0.2 only. Uses the stock Memories player, not the 10.2 helper.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
nextcloud=${NEXTCLOUD_CONTAINER:-nextcloud}
image=local/memories-rkmpp:memories-11.0.2-govod-0.7.0-r1
occ() { docker exec "$nextcloud" php /app/www/public/occ "$@"; }
version=$(occ config:app:get memories installed_version)
[ "$version" = 11.0.2 ] || { echo "Expected Memories 11.0.2, found $version" >&2; exit 1; }
docker build --platform linux/arm64 -f "$root/go-vod-v11/Dockerfile.rkmpp-test" -t local/memories-rkmpp:v11-smoke "$root/go-vod-v11"
docker build --platform linux/arm64 -f "$root/go-vod-v11/Dockerfile.rkmpp" -t "$image" "$root/go-vod-v11"
docker volume create memories-rkmpp-v11-cache >/dev/null
# Adopt a manually started instance of this same engine. Compose manages
# subsequent updates; the dedicated cache is retained.
if docker container inspect memories-rkmpp >/dev/null 2>&1; then
    project=$(docker inspect memories-rkmpp --format '{{index .Config.Labels "com.docker.compose.project"}}')
    if [ "$project" != memories_v11 ]; then
        running=$(docker exec memories-rkmpp /app/go-vod -version)
        [ "$running" = 'go-vod 0.7.0' ] || { echo 'Container name memories-rkmpp belongs to a different engine' >&2; exit 1; }
        docker rm -f memories-rkmpp
    fi
fi
docker compose -p memories_v11 -f "$root/compose.yml" up -d --no-deps --wait --wait-timeout 90 memories-rkmpp
occ config:system:set memories.vod.external --type=boolean --value=true
occ config:system:set memories.vod.disable --type=boolean --value=false
occ config:system:set memories.vod.connect --type=json --value='["memories-rkmpp:47788"]'
occ config:system:set memories.vod.vaapi --type=boolean --value=false
occ config:system:set memories.vod.nvenc --type=boolean --value=false
if occ config:app:get memories_rkmpp_player installed_version >/dev/null 2>&1; then
    occ app:disable memories_rkmpp_player
fi
docker cp "$root/memories_rkmpp_v11" "$nextcloud:/app/www/public/apps/"
docker exec "$nextcloud" chown -R abc:abc /app/www/public/apps/memories_rkmpp_v11
docker exec "$nextcloud" php -r 'define("OC_CONSOLE", true); require "/app/www/public/lib/base.php"; $id="memories_rkmpp_v11"; $a=\OC::$server->get(\OCP\App\IAppManager::class); $installed=\OC::$server->get(\OCP\IConfig::class)->getAppValue($id,"installed_version",""); if ($installed!=="" && $installed!==$a->getAppVersion($id) && !\OC_App::updateApp($id)) { exit(1); }'
occ app:enable memories_rkmpp_v11
docker exec "$nextcloud" php -r 'define("OC_CONSOLE", true); require "/app/www/public/lib/base.php"; $b=\OC::$server->get(\OCA\Memories\Service\BinExt::class); echo json_encode($b->testGoVod("memories-rkmpp:47788")), PHP_EOL;'
printf 'Memories 11.0.2 is connected to go-vod 0.7.0. Reload the Memories page.\n'
