#!/usr/bin/env bash
# Персональные версии: каждая ветка `ed/<id>` из deploy/editions.json собирается своим `edition.json` в dist/<path>/.
# Ветка заморожена: правки main туда не попадают, пока её явно не обновили (merge main → ed/<id>).
set -euo pipefail
root=$(pwd)
jq -c '.[]' deploy/editions.json | while read -r ed; do
  id=$(jq -r .id <<<"$ed"); branch=$(jq -r .branch <<<"$ed"); path=$(jq -r .path <<<"$ed")
  echo "::group::edition $id ($branch → $path)"
  git fetch --no-tags --depth 1 origin "$branch:refs/remotes/origin/$branch"
  dir="$RUNNER_TEMP/ed-$id"
  git worktree add --detach "$dir" "origin/$branch"
  base=$(jq -r .base "$dir/edition.json")
  [ "$base" = "/polski-quest/$path/" ] || { echo "edition.json base=$base, ждали /polski-quest/$path/"; exit 1; }
  (cd "$dir" && npm ci --no-audit --no-fund && npm run build)
  mkdir -p "dist/$path" && cp -R "$dir/dist/." "dist/$path/"
  echo "::endgroup::"
done
