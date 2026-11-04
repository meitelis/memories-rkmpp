#!/bin/sh
set -eu
usage() {
    echo 'Usage: sh scripts/deploy.sh --nextcloud CONTAINER [--compose-file FILE] [--project NAME] [--image IMAGE] [--backup-dir DIR] [--docroot PATH] [--web-user USER] [--app-path PATH]'
}
fail() { echo "Error: $*" >&2; exit 1; }
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
compose_file=$script_dir/../compose.10.2.yml
project= image= nextcloud= app_path= backup_dir=
docroot=/app/www/public
web_user=abc
while [ "$#" -gt 0 ]; do
    case "$1" in
        --compose-file|--project|--image|--nextcloud|--backup-dir|--docroot|--web-user|--app-path)
            [ "$#" -ge 2 ] || fail "Missing value for $1"
            case "$1" in
                --compose-file) compose_file=$2 ;; --project) project=$2 ;; --image) image=$2 ;;
                --nextcloud) nextcloud=$2 ;; --backup-dir) backup_dir=$2 ;; --docroot) docroot=$2 ;;
                --web-user) web_user=$2 ;; --app-path) app_path=$2 ;;
            esac
            shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) usage >&2; fail "Unknown argument: $1" ;;
    esac
done
[ -n "$nextcloud" ] && [ -f "$compose_file" ] || { usage >&2; exit 1; }
case "$project" in -*|*[!a-z0-9_-]*) fail "Invalid Compose project name" ;; esac
case "$image" in -*|*[!A-Za-z0-9_./:@-]*) fail "Invalid image reference" ;; esac
temporary=$(mktemp -d "${TMPDIR:-/tmp}/memories-rkmpp-deploy.XXXXXXXX")
trap 'rm -rf -- "$temporary"' EXIT
trap 'exit 130' HUP INT TERM
overlay=
if [ -n "$image" ]; then
    docker image inspect "$image" >/dev/null
    overlay=$temporary/image.yml
    printf 'services:\n  memories-rkmpp:\n    image: "%s"\n' "$image" > "$overlay"
fi
# Keep the supplied Compose file first so its relative paths/project stay stable.
# Add the optional override after it.
compose() {
    if [ -n "$project" ]; then
        if [ -n "$overlay" ]; then docker compose -f "$compose_file" -f "$overlay" -p "$project" "$@"
        else docker compose -f "$compose_file" -p "$project" "$@"; fi
    else
        if [ -n "$overlay" ]; then docker compose -f "$compose_file" -f "$overlay" "$@"
        else docker compose -f "$compose_file" "$@"; fi
    fi
}
compose up -d --no-deps --wait --wait-timeout 120 memories-rkmpp
engine=$(compose ps -q memories-rkmpp)
case "$engine" in ''|-*|*[!A-Za-z0-9_.-]*) fail "Could not resolve exactly one engine container" ;; esac
set -- --engine "$engine" --nextcloud "$nextcloud" --docroot "$docroot" --web-user "$web_user"
[ -z "$backup_dir" ] || set -- "$@" --backup-dir "$backup_dir"
[ -z "$app_path" ] || set -- "$@" --app-path "$app_path"
sh "$script_dir/update-nextcloud-player.sh" "$@"
