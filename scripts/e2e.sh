#!/usr/bin/env bash
# `npm run e2e`: the published tarballs install and run from an empty folder.
# This is the end-to-end test until B49 (the worked microworld as a fixture,
# with golden transcripts) replaces it; when the example worlds are fenced
# under legacy/, point EXAMPLE at whatever B49 ships. Runs locally only —
# there is no CI on this repository (CLAUDE.md, The gate, locally).
set -euo pipefail
cd "$(dirname "$0")/.."
EXAMPLE=${EXAMPLE:-pottery-studio}
sha=$(git rev-parse --short HEAD)
packs=$(mktemp -d)
npm run build >/dev/null
npm pack -w sprout -w cli --pack-destination "$packs" >/dev/null
sandbox=$(mktemp -d)
cd "$sandbox"
npm init -y >/dev/null
npm install --silent "$packs"/overstory-sprout-*.tgz "$packs"/overstory-sprout-cli-*.tgz
npx sprout check "node_modules/@overstory/sprout/examples/$EXAMPLE"
printf 'look\nquit\n' | npx sprout play "node_modules/@overstory/sprout/examples/$EXAMPLE" --store memory | head -20
cd / && rm -rf "$sandbox" "$packs"
echo "e2e: green ($EXAMPLE installed from tarballs and played at $sha)"
