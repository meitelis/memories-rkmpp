#!/bin/sh
# Regression-test the deploy preflight without invoking the real Docker CLI.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
cat > "$tmp/docker" <<'EOF'
#!/bin/sh
case "$1" in
    exec) printf '%s\n' "${MEMORIES_TEST_VERSION:?}" ;;
    build) exit 42 ;; # Sentinel: confirmed 11.1.1 passed the version check.
    *) echo "Unexpected Docker action in preflight: $1" >&2; exit 99 ;;
esac
EOF
chmod +x "$tmp/docker"

for version in 11.0.2 11.1.0 11.2.0; do
    if MEMORIES_TEST_VERSION="$version" PATH="$tmp:$PATH" sh "$root/scripts/deploy-v11.sh" >"$tmp/out" 2>&1; then
        echo "Unexpected deploy acceptance for $version" >&2; exit 1
    else
        result=$?
    fi
    [ "$result" -eq 1 ] || { echo "Unexpected status $result for $version" >&2; exit 1; }
    grep -F "Expected Memories 11.1.1, found $version" "$tmp/out" >/dev/null
done
if MEMORIES_TEST_VERSION=11.1.1 PATH="$tmp:$PATH" sh "$root/scripts/deploy-v11.sh" >"$tmp/out" 2>&1; then
    echo "Unexpected complete mock deployment" >&2; exit 1
else
    result=$?
fi
[ "$result" -eq 42 ] || { echo "Expected Docker-build sentinel 42, got $result" >&2; exit 1; }

tag='local/memories-rkmpp:memories-11.1.1-govod-0.7.0-r10'
grep -F "image=$tag" "$root/scripts/deploy-v11.sh" >/dev/null
grep -F "image: $tag" "$root/compose.yml" >/dev/null
grep -F 'org.opencontainers.image.version="memories-11.1.1-govod-0.7.0-r10"' "$root/go-vod/Dockerfile.rkmpp" >/dev/null
echo 'Memories 11.1.1 deploy preflight and image-tag consistency: passed'
