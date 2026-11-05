#!/bin/sh
# Apply only to the pinned Memories 11.0.2 Android source, not signed web assets.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
source=${1:?Usage: sh android-v11/apply.sh UPSTREAM_CHECKOUT}
[ "$(git -C "$source" rev-parse HEAD)" = e156f850ec5514433f1cfac9d4f1dbd461500c8d ] || {
  echo 'Expected the pinned Memories 11.0.2 source' >&2; exit 1;
}
git -C "$source" apply --check --directory=android "$root/android-v11/native.patch"
git -C "$source" apply --directory=android "$root/android-v11/native.patch"
java="$source/android/app/src/main/java/gallery/memories/ui/video"
cp "$root/android-v11/NativeVideoPlayback.kt" "$root/android-v11/AudioBudget.kt" "$java/"
tests="$source/android/app/src/test/java/gallery/memories/ui/video"
mkdir -p "$tests"
cp "$root/android-v11/AudioBudgetTest.kt" "$tests/"
assets="$source/android/app/src/main/assets"
cp "$root/android-v11/native-video.js" "$assets/"
cp "$root/memories_rkmpp_v11/css/player.css" "$assets/rkmpp-player.css"
