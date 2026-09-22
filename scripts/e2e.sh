#!/usr/bin/env bash
# `npm run e2e`: the published tarballs install and run from an empty folder.
# Until B49 ships the worked microworld as a fixture, the end-to-end test is
# that the installed CLI can init a world and check it, and checks a corpus
# world the same way. Runs locally only — there is no CI on this repository.
set -euo pipefail
cd "$(dirname "$0")/.."
sha=$(git rev-parse --short HEAD)
corpus=$(pwd)/corpus/good/declarations
packs=$(mktemp -d)
npm run build >/dev/null
npm pack -w sprout -w cli --pack-destination "$packs" >/dev/null
sandbox=$(mktemp -d)
cd "$sandbox"
npm init -y >/dev/null
npm install --silent "$packs"/overstory-sprout-*.tgz "$packs"/overstory-sprout-cli-*.tgz
npx sprout init shed --author e2e
npx sprout check shed
npx sprout check "$corpus"
cd / && rm -rf "$sandbox" "$packs"
echo "e2e: green (init and check from the installed CLI at $sha)"
