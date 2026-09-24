#!/usr/bin/env bash
# `npm run e2e`: the published tarballs install and run from an empty folder.
# Until B49 ships the worked microworld as a fixture, the end-to-end test is
# that the installed CLI can init a world and check it, checks a corpus
# world the same way, and inspects the new world and a corpus world: the
# grammar a world accepts, a line read where a visitor stands, and that
# visitor's view. Runs locally only — there is no CI on this repository.
set -euo pipefail
cd "$(dirname "$0")/.."
sha=$(git rev-parse --short HEAD)
corpus=$(pwd)/corpus/good/declarations
grammar=$(pwd)/corpus/good/grammar
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
npx sprout parse shed "look"
npx sprout view shed
npx sprout parse "$grammar" >/dev/null
npx sprout parse "$grammar" "take metal"
npx sprout view "$grammar" --at cellar
cd / && rm -rf "$sandbox" "$packs"
echo "e2e: green (init, check, parse and view from the installed CLI at $sha)"
