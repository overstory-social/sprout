#!/usr/bin/env bash
# `npm run e2e`: the published tarballs install and run from an empty folder.
# The installed CLI scaffolds a world, a kind and an object in it, checks it and runs its first test,
# checks a corpus world the same way, and inspects the new world and a corpus world: the grammar a
# world accepts, a line read where a visitor stands, and that visitor's
# view. It checks the worked microworld and plays each of its golden
# transcripts, which must print exactly what they hold; runs its own tests,
# which must pass, and its transcripts as tests, which must pass too; and
# runs a test that must fail, printing what the world said. It plays the
# new world interactively from a here-document, with and without `-` for
# the script, recording the session, and plays the recording back, which
# must print exactly what it holds; without --debug it checks the page
# shows only the prose the visitor reads. It prints the generated skill
# exactly as corpus/skill/SKILL.md
# holds it. It serves the new world from the installed `sprout-server`, and
# the installed terminal client, plain from a pipe, comes in, looks and
# leaves before the server is stopped. Runs locally only — there is no CI on this repository.
set -euo pipefail
cd "$(dirname "$0")/.."
sha=$(git rev-parse --short HEAD)
corpus=$(pwd)/corpus/good/declarations
grammar=$(pwd)/corpus/good/grammar
shop=$(pwd)/corpus/good/printers_shop
skill=$(pwd)/corpus/skill/SKILL.md
packs=$(mktemp -d)
npm run build >/dev/null
npm pack -w sprout -w player -w repl -w server -w tui -w cli --pack-destination "$packs" >/dev/null
sandbox=$(mktemp -d)
cd "$sandbox"
npm init -y >/dev/null
npm install --silent "$packs"/overstory-sprout-*.tgz
npx sprout scaffold world shed --author e2e
npx sprout scaffold kind Lantern shed --is sprout.Fixture
npx sprout scaffold object lamp shed --in hall --is Lantern
npx sprout check shed
npx sprout test shed
npx sprout check "$corpus"
npx sprout parse shed "look"
npx sprout view shed
npx sprout parse "$grammar" >/dev/null
npx sprout parse "$grammar" "take metal"
npx sprout view "$grammar" --at cellar
npx sprout check "$shop"
for transcript in "$shop"/transcripts/*.json; do
  npx sprout play "$shop" "$transcript" > played.json
  diff -u "$transcript" played.json
  echo "played $(basename "$transcript") as written"
done
npx sprout test "$shop"
npx sprout test "$shop" "$shop"/transcripts/*.json | tail -1
printf 'look\n' | npx sprout play shed --debug --record session.json > interactive.txt
grep -qx '  Inspector (described): There is nothing special about a hall.' interactive.txt
npx sprout play shed session.json > replayed.json
diff -u session.json replayed.json
echo "played shed interactively from a here-document and recorded it; the recording plays back as written"
printf 'look\n' | npx sprout play shed - --debug > interactive-dash.txt
diff -u interactive.txt interactive-dash.txt
echo "\`-\` for the script plays interactively too"
printf 'look\n' | npx sprout play shed > interactive-prose.txt
if grep -q '(described)\|^@\|^  ' interactive-prose.txt; then
  echo "interactive play without --debug showed a label, a host line or an indent" >&2
  exit 1
fi
grep -qx 'Inspector> look' interactive-prose.txt
echo "without --debug, interactive play shows only the prose"
printf '{ "steps": [{ "arrive": "Marta" }, { "as": "Marta", "type": "open cabinet", "expect": [{ "words": "You open the type cabinet." }] }] }\n' > locked.json
if npx sprout test "$shop" locked.json > tested.txt; then
  echo "a failing test passed" >&2
  exit 1
fi
grep -qx '    Marta (refused): It is locked.' tested.txt
tail -1 tested.txt
npx sprout skill > SKILL.md
cmp SKILL.md "$skill"
printf 'listen = "127.0.0.1:47931"\n[[worlds]]\npath = "./shed"\n' > server.toml
./node_modules/.bin/sprout-server start --config server.toml > server.log 2>&1 &
server=$!
# Whatever fails from here, the server does not outlive the run.
trap 'kill "$server" 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do grep -q 'listening' server.log && break; sleep 0.2; done
if ! grep -q 'listening' server.log; then
  echo "sprout-server never said it was listening:" >&2
  cat server.log >&2
  exit 1
fi
# The installed terminal client, plain from a pipe, its token kept in the sandbox and not the real home.
printf 'look\n' | HOME="$sandbox" timeout 20 npx sprout client connect 127.0.0.1:47931 --as Marta --plain > client.txt
grep -qx 'There is nothing special about a hall.' client.txt
grep -qx '\[a hall\]' client.txt
kill -INT "$server"
wait "$server"
trap - EXIT
grep -q 'info: stopped' server.log
echo "the installed sprout-server served shed to the installed terminal client, and stopped when asked"
cd / && rm -rf "$sandbox" "$packs"
echo "e2e: green (scaffold, check, parse, view, play (scripted and interactive), test and skill from the installed CLI, and a world served by the installed server to the installed client, at $sha)"
