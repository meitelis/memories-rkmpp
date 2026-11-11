#!/bin/sh
# Install the matching browser helper without replacing the Docker service.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
nextcloud=${NEXTCLOUD_CONTAINER:-nextcloud}
occ() { docker exec "$nextcloud" php /app/www/public/occ "$@"; }
version=$(occ config:app:get memories installed_version)
[ "$version" = 11.1.2 ] || { echo "Expected Memories 11.1.2, found $version" >&2; exit 1; }
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
# Nextcloud 35 uses the server version, not this app's version, in script URLs.
# Advance its template asset cache after replacing the adapter's static files.
docker exec "$nextcloud" php -r 'define("OC_CONSOLE", true); require "/app/www/public/lib/base.php"; $c=\OC::$server->get(\OCP\IConfig::class); $c->setAppValue("theming","cachebuster",(string)((int)$c->getAppValue("theming","cachebuster","0")+1));'
docker exec "$nextcloud" php -r 'define("OC_CONSOLE", true); require "/app/www/public/lib/base.php"; $b=\OC::$server->get(\OCA\Memories\Service\BinExt::class); echo json_encode($b->testGoVod("memories-rkmpp:47788")), PHP_EOL;'
printf 'Memories 11.1.2 is connected to go-vod 0.7.1. Reload the Memories page.\n'
