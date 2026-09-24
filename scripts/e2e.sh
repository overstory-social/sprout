#!/usr/bin/env bash
# `npm run e2e`: the published tarballs install and run from an empty folder.
# The installed CLI inits a world, checks it and runs its first test,
# checks a corpus world the same way, and inspects the new world and a corpus world: the grammar a
# world accepts, a line read where a visitor stands, and that visitor's
# view. It checks the worked microworld and plays each of its golden
# transcripts, which must print exactly what they hold; runs its own tests,
# which must pass, and its transcripts as tests, which must pass too; and
# runs a test that must fail, printing what the world said. It prints the
# generated skill exactly as corpus/skill/SKILL.md holds it. Runs locally
# only — there is no CI on this repository.
set -euo pipefail
cd "$(dirname "$0")/.."
sha=$(git rev-parse --short HEAD)
corpus=$(pwd)/corpus/good/declarations
grammar=$(pwd)/corpus/good/grammar
shop=$(pwd)/corpus/good/printers_shop
skill=$(pwd)/corpus/skill/SKILL.md
packs=$(mktemp -d)
npm run build >/dev/null
npm pack -w sprout -w cli --pack-destination "$packs" >/dev/null
sandbox=$(mktemp -d)
cd "$sandbox"
npm init -y >/dev/null
npm install --silent "$packs"/overstory-sprout-*.tgz "$packs"/overstory-sprout-cli-*.tgz
npx sprout init shed --author e2e
npx sprout check shed
npx sprout test shed
npx sprout check "$corpus"
npx sprout parse shed "look"
npx sprout view shed
npx sprout parse "$grammar" >/dev/null
npx sprout parse "$grammar" "take metal"
npx sprout view "$grammar" --at cellar
npx sprout check "$shop"
for transcript in "$shop"/transcripts/*.txt; do
  npx sprout play "$shop" "$transcript" > played.txt
  diff -u "$transcript" played.txt
  echo "played $(basename "$transcript") as written"
done
npx sprout test "$shop"
npx sprout test "$shop" "$shop"/transcripts/*.txt | tail -1
printf '@arrive Marta\nMarta> open cabinet\n  You open the type cabinet.\n' > locked.txt
if npx sprout test "$shop" locked.txt > tested.txt; then
  echo "a failing test passed" >&2
  exit 1
fi
grep -qx '    Marta (refused): It is locked.' tested.txt
tail -1 tested.txt
npx sprout skill > SKILL.md
cmp SKILL.md "$skill"
cd / && rm -rf "$sandbox" "$packs"
echo "e2e: green (init, check, parse, view, play, test and skill from the installed CLI at $sha)"
