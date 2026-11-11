#!/bin/sh
# Exercise version/ownership guards and build-only behavior with a fake Docker.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
cat > "$tmp/docker" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >> "${MEMORIES_TEST_CALLS:?}"
case "$1" in
    exec) printf '%s\n' "${MEMORIES_TEST_VERSION:?}" ;;
    container) [ "${MEMORIES_TEST_PROJECT-absent}" != absent ] ;;
    inspect) printf '%s\n' "${MEMORIES_TEST_PROJECT-}" ;;
    build) exit "${MEMORIES_TEST_BUILD_EXIT:-42}" ;;
    *) echo "Unexpected Docker action in preflight: $1" >&2; exit 99 ;;
esac
EOF
chmod +x "$tmp/docker"

for version in 11.0.2 11.1.0 11.1.1 11.1.3 11.2.0; do
    for script in deploy-v11.sh install-player-v11.sh; do
        : > "$tmp/calls"
        if MEMORIES_TEST_CALLS="$tmp/calls" MEMORIES_TEST_VERSION="$version" PATH="$tmp:$PATH" sh "$root/scripts/$script" >"$tmp/out" 2>&1; then
            echo "Unexpected $script acceptance for $version" >&2; exit 1
        else
            result=$?
        fi
        [ "$result" -eq 1 ] || { echo "Unexpected status $result for $version" >&2; exit 1; }
        grep -F "Expected Memories 11.1.2, found $version" "$tmp/out" >/dev/null
        ! grep -E '^(build|compose|rm|volume|cp) ' "$tmp/calls" >/dev/null
        [ "$(wc -l < "$tmp/calls")" -eq 1 ]
    done
done

# A Portainer-owned or unlabelled existing container must never be adopted.
for project in nextcloud_stack ''; do
    : > "$tmp/calls"
    if MEMORIES_TEST_CALLS="$tmp/calls" MEMORIES_TEST_VERSION=11.1.2 MEMORIES_TEST_PROJECT="$project" PATH="$tmp:$PATH" sh "$root/scripts/deploy-v11.sh" >"$tmp/out" 2>&1; then
        echo 'Unexpected adoption of an existing service' >&2; exit 1
    else
        result=$?
    fi
    [ "$result" -eq 1 ]
    grep -F 'Update its existing stack instead' "$tmp/out" >/dev/null
    ! grep -E '^(build|compose|rm|volume|cp) ' "$tmp/calls" >/dev/null
done

for project in absent memories_v11; do
    : > "$tmp/calls"
    if MEMORIES_TEST_CALLS="$tmp/calls" MEMORIES_TEST_VERSION=11.1.2 MEMORIES_TEST_PROJECT="$project" PATH="$tmp:$PATH" sh "$root/scripts/deploy-v11.sh" >"$tmp/out" 2>&1; then
        echo 'Unexpected complete mock deployment' >&2; exit 1
    else
        result=$?
    fi
    [ "$result" -eq 42 ] || { echo "Expected Docker-build sentinel 42, got $result" >&2; exit 1; }
done

# Portainer's build command performs only the two image builds, using the override.
: > "$tmp/calls"
MEMORIES_TEST_CALLS="$tmp/calls" MEMORIES_TEST_BUILD_EXIT=0 MEMORIES_RKMPP_IMAGE=local/memories-rkmpp:preflight-custom PATH="$tmp:$PATH" sh "$root/scripts/build-v11.sh" >"$tmp/out" 2>&1
[ "$(grep -c '^build ' "$tmp/calls")" -eq 2 ]
! grep -v '^build ' "$tmp/calls" >/dev/null
grep -F -- '-t local/memories-rkmpp:preflight-custom ' "$tmp/calls" >/dev/null

tag='local/memories-rkmpp:memories-11.1.2-govod-0.7.1-r12'
grep -F "MEMORIES_RKMPP_IMAGE:-$tag" "$root/scripts/build-v11.sh" >/dev/null
grep -F "MEMORIES_RKMPP_IMAGE:-$tag" "$root/scripts/deploy-v11.sh" >/dev/null
grep -F "MEMORIES_RKMPP_IMAGE:-$tag" "$root/compose.yml" >/dev/null
grep -F 'org.opencontainers.image.version="memories-11.1.2-govod-0.7.1-r12"' "$root/go-vod/Dockerfile.rkmpp" >/dev/null
echo 'Version guards, project ownership, build-only behavior and image defaults: passed'
