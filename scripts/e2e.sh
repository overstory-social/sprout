#!/usr/bin/env bash
# `npm run e2e`: the published tarballs install and run from an empty folder.
# The installed CLI inits a world, checks it and runs its first test,
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
# a client over a socket admits itself, looks and leaves before the server
# is stopped. Runs locally only — there is no CI on this repository.
set -euo pipefail
cd "$(dirname "$0")/.."
sha=$(git rev-parse --short HEAD)
corpus=$(pwd)/corpus/good/declarations
grammar=$(pwd)/corpus/good/grammar
shop=$(pwd)/corpus/good/printers_shop
skill=$(pwd)/corpus/skill/SKILL.md
packs=$(mktemp -d)
npm run build >/dev/null
npm pack -w sprout -w player -w repl -w server -w cli --pack-destination "$packs" >/dev/null
sandbox=$(mktemp -d)
cd "$sandbox"
npm init -y >/dev/null
npm install --silent "$packs"/overstory-sprout-*.tgz
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
for _ in $(seq 1 50); do grep -q 'listening' server.log && break; sleep 0.2; done
cat > client.mjs <<'CLIENT'
import WebSocket from 'ws';
const socket = new WebSocket('ws://127.0.0.1:47931', 'sprout.1');
const said = [];
socket.on('open', () => {
  socket.send(JSON.stringify({ t: 'hello', protocol: 'sprout.1', client: 'e2e', token: 'e2e-token-0123456789', renders: [] }));
  socket.send(JSON.stringify({ t: 'admit', world: 'shed', nickname: 'Marta' }));
  socket.send(JSON.stringify({ t: 'command', seq: 1, line: 'look' }));
});
socket.on('message', (data) => {
  const message = JSON.parse(data.toString());
  if (message.t === 'refused') { console.error(JSON.stringify(message)); process.exit(1); }
  if (message.t === 'effects') said.push(...message.effects.flatMap((one) => one.paragraphs ?? []));
  if (message.t === 'effects' && message.seq === 1) {
    console.log(said.join('\n'));
    socket.send(JSON.stringify({ t: 'leave' }));
  }
  if (message.t === 'bye') process.exit(0);
});
CLIENT
node client.mjs > client.txt
grep -qx 'There is nothing special about a hall.' client.txt
kill -INT "$server"
wait "$server"
grep -q 'info: stopped' server.log
echo "the installed sprout-server served shed to a client over a socket, and stopped when asked"
cd / && rm -rf "$sandbox" "$packs"
echo "e2e: green (init, check, parse, view, play (scripted and interactive), test and skill from the installed CLI, and a world served by the installed server, at $sha)"
