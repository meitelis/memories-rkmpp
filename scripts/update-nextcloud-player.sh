#!/bin/sh
# Run on the Docker host; the engine container receives no additional access.
set -eu
umask 077
app=memories_rkmpp_player
usage() {
    cat <<'EOF'
Usage: sh scripts/update-nextcloud-player.sh (--engine CONTAINER | --image IMAGE) --nextcloud CONTAINER [options]
  --backup-dir DIR  Host backups (default: ./memories-rkmpp-backups)
  --docroot PATH    Nextcloud root (default: /app/www/public)
  --web-user USER   Nextcloud web-server user (default: abc)
  --app-path PATH   Explicit helper path, checked against Nextcloud's apps paths
  --dry-run        Extract and check versions/paths without changing Nextcloud
EOF
}
fail() { echo "Error: $*" >&2; exit 1; }
engine= image= nextcloud= app_path= dry_run=0
backup_base=$PWD/memories-rkmpp-backups
docroot=/app/www/public
web_user=abc
while [ "$#" -gt 0 ]; do
    case "$1" in
        --engine|--image|--nextcloud|--backup-dir|--docroot|--web-user|--app-path)
            [ "$#" -ge 2 ] || fail "Missing value for $1"
            case "$1" in
                --engine) engine=$2 ;; --image) image=$2 ;; --nextcloud) nextcloud=$2 ;;
                --backup-dir) backup_base=$2 ;; --docroot) docroot=$2 ;;
                --web-user) web_user=$2 ;; --app-path) app_path=$2 ;;
            esac
            shift 2 ;;
        --dry-run) dry_run=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) usage >&2; fail "Unknown argument: $1" ;;
    esac
done
[ -n "$nextcloud" ] || { usage >&2; exit 1; }
if [ -n "$engine" ]; then [ -z "$image" ] || fail "Choose --engine or --image, not both"
else [ -n "$image" ] || fail "Choose --engine or --image"; fi
for name in "$nextcloud" "${engine:-image-extraction}" "$web_user"; do
    case "$name" in ''|-*|*[!A-Za-z0-9_.-]*) fail "Invalid container/user name" ;; esac
done
case "$image" in -*|*[!A-Za-z0-9_./:@-]*) fail "Invalid image reference" ;; esac
for path in "$docroot" "${app_path:-/unspecified}"; do
    case "$path" in /*) ;; *) fail "Container paths must be absolute" ;; esac
    case "$path" in *'/../'*|*'/./'*|*/..|*/.|*'
'*) fail "Container paths must not contain traversal or newlines" ;; esac
done
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
control=$(sed '1d' "$script_dir/nextcloud-player-control.php")
temporary=$(mktemp -d "${TMPDIR:-/tmp}/memories-rkmpp-update.XXXXXXXX")
created= lock= backup= activated=0
cleanup() {
    status=$?
    trap - EXIT HUP INT TERM
    if [ -n "$lock" ]; then
        docker exec --user "$web_user" "$nextcloud" sh -c '
            # memories-rkmpp-cleanup: remove only our acquired lock directory.
            set -eu
            case "$1" in */.memories_rkmpp_player-update-lock) ;; *) exit 1 ;; esac
            if [ "$2" != 1 ] && [ -d "$1/old" ]; then
                echo "Previous helper retained at $1/old; restore it before removing the lock." >&2
                exit 1
            fi
            rm -rf -- "$1"
        ' cleanup "$lock" "$activated" || echo "Updater lock retained for inspection: $lock" >&2
    fi
    [ -z "$created" ] || docker rm "$created" >/dev/null 2>&1 || true
    rm -rf -- "$temporary"
    exit "$status"
}
trap cleanup EXIT
trap 'exit 130' HUP INT TERM
if [ -n "$image" ]; then
    created=$(docker create --entrypoint /app/go-vod "$image" -version)
    [ -n "$created" ] || fail "Image extraction container was not created"
    engine=$created
fi
mkdir "$temporary/app"
docker cp "$engine:/usr/share/memories-rkmpp/nextcloud-app/." "$temporary/app/"
[ -z "$(find "$temporary/app" -type l -print)" ] || fail "Bundled helper must not contain symlinks"
xml=$temporary/app/appinfo/info.xml
[ -f "$xml" ] || fail "Image does not contain the playback helper"
grep -q '<id>memories_rkmpp_player</id>' "$xml" || fail "Bundled app ID is incorrect"
version=$(sed -n 's/.*<version>\([^<]*\)<\/version>.*/\1/p' "$xml")
case "$version" in ''|*[!A-Za-z0-9.+-]*) fail "Invalid bundled helper version" ;; esac
inspect() {
    docker exec --user "$web_user" "$nextcloud" php -r "$control" -- "$docroot" inspect "$app_path" "$version"
}
inspection=$(inspect)
target=$(printf '%s\n' "$inspection" | sed -n '1p')
previous=$(printf '%s\n' "$inspection" | sed -n '2p')
exists=$(printf '%s\n' "$inspection" | sed -n '3p')
case "$target" in /*/memories_rkmpp_player) ;; *) fail "Nextcloud returned an unsafe app path" ;; esac
case "$target" in *'/../'*|*'/./'*|*'
'*) fail "Nextcloud returned an unsafe app path" ;; esac
case "$exists" in 0|1) ;; *) fail "Could not inspect the installed helper" ;; esac
printf 'Bundled helper: %s\nInstalled helper: %s\nNextcloud app path: %s\n' "$version" "${previous:-not installed}" "$target"
if [ "$dry_run" = 1 ]; then
    echo 'Dry run complete; Nextcloud has not been changed.'
    exit 0
fi
parent=${target%/*}
new_lock=$parent/.memories_rkmpp_player-update-lock
docker exec --user "$web_user" "$nextcloud" sh -c '
    # memories-rkmpp-lock: mkdir refuses a concurrent or stale lock.
    set -eu
    mkdir -- "$1"
    mkdir -- "$1/new"
' lock "$new_lock"
lock=$new_lock
mkdir -p -- "$backup_base"
backup_base=$(CDPATH= cd -- "$backup_base" && pwd -P)
backup=$(mktemp -d "$backup_base/player-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXXXX")
printf 'container=%s\npath=%s\nprevious_version=%s\nnew_version=%s\nprevious_directory=%s\n' \
    "$nextcloud" "$target" "$previous" "$version" "$exists" > "$backup/metadata.txt"
if [ "$exists" = 1 ]; then docker cp "$nextcloud:$target" "$backup/app"; fi
docker cp "$temporary/app/." "$nextcloud:$lock/new/"
# Docker copies as root; change ownership only inside this newly acquired stage.
docker exec --user 0 "$nextcloud" chown -R "$web_user" "$lock/new"
docker exec --user "$web_user" "$nextcloud" php -r "$control" -- "$docroot" validate "$lock/new" "$version"
[ "$(inspect)" = "$inspection" ] || fail "Installed helper changed while staging; retry the update"
docker exec --user "$web_user" "$nextcloud" sh -c '
    # memories-rkmpp-swap: preserve the old directory until activation succeeds.
    set -eu
    target=$1; lock=$2; exists=$3
    [ ! -L "$target" ] && [ ! -e "$lock/old" ]
    if [ "$exists" = 1 ]; then [ -d "$target" ]; mv -- "$target" "$lock/old"; fi
    [ ! -e "$target" ] && [ ! -L "$target" ]
    if ! mv -- "$lock/new" "$target"; then
        if [ ! -e "$target" ] && [ ! -L "$target" ] && [ -d "$lock/old" ]; then
            mv -- "$lock/old" "$target"
        fi
        exit 1
    fi
' swap "$target" "$lock" "$exists"
if ! docker exec --user "$web_user" "$nextcloud" php -r "$control" -- "$docroot" activate "$version"; then
    if docker exec --user "$web_user" "$nextcloud" sh -c '
        # memories-rkmpp-restore: restore only the directory replaced above.
        set -eu
        target=$1; lock=$2
        [ ! -e "$lock/failed" ]
        [ -d "$target" ] && [ ! -L "$target" ]
        mv -- "$target" "$lock/failed"
        [ ! -d "$lock/old" ] || mv -- "$lock/old" "$target"
    ' restore "$target" "$lock"; then
        fail "Activation failed; previous code restored. Check app installed_version before retrying. Backup: $backup"
    else
        fail "Activation failed and automatic code restoration could not complete. Keep the updater lock and restore the host backup: $backup"
    fi
fi
activated=1
printf 'Backup retained: %s\nReload Memories to load the bundled playback helper.\n' "$backup"
