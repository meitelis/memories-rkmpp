#!/bin/sh
# Patch a pinned upstream Memories 11.0.2 Android checkout only.
# Do not replace signed JS bundles or change the working Nextcloud server.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
source=${1:?Usage: sh android-v11/apply.sh UPSTREAM_CHECKOUT}
expected=e156f850ec5514433f1cfac9d4f1dbd461500c8d
[ "$(git -C "$source" rev-parse HEAD)" = "$expected" ] || {
  echo "Expected pinned Memories 11.0.2 commit $expected" >&2
  exit 1
}
git -C "$source" apply --check "$root/android-v11/native.patch"
git -C "$source" apply "$root/android-v11/native.patch"
java="$source/android/app/src/main/java/gallery/memories/ui/video"
cp "$root/android-v11/NativeVideoPlayback.kt" "$java/"
assets="$source/android/app/src/main/assets"
cp "$root/android-v11/native-video.js" "$assets/"
cp "$root/memories_rkmpp_v11/css/player.css" "$assets/rkmpp-player.css"
echo "Android Media3 quality integration applied."
