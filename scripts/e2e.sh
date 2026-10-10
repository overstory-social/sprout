#!/usr/bin/env bash
# `npm run e2e`: the published tarballs install and run from an empty folder.
# The installed CLI scaffolds a world, a kind and an object in it, checks it and runs its first test,
# checks a corpus world the same way, and inspects the new world and a corpus world: the grammar a
# world accepts, a line read where a visitor stands, and that visitor's
# view. It checks the worked microworld and plays each of its golden
# transcripts, which must print exactly what they hold; runs its own tests,
# which must pass, and its transcripts as tests, which must pass too, with a
# report of what they reached between them; and
# runs a test that must fail, printing what the world said. It plays the
# new world interactively from a here-document, with and without `-` for
# the script, recording the session, and plays the recording back, which
# must print exactly what it holds; without --debug it checks the page
# shows only the prose the visitor reads. It prints the generated skill
# exactly as corpus/skill/SKILL.md
# holds it. The installed MCP host plays a visitor over stdio, recording the
# session, and the recording plays back as written. It serves the new world from the installed `sprout-server`, and
# the installed terminal client, plain from a pipe, comes in, looks and
# leaves before the server is stopped. The installed `sprout-language-server`
# is sent an edit that breaks the new kind and answers with the refusal on
# its file. The C runtime is fuzzed against the TypeScript one over the corpus. Runs locally only — there is no CI on this repository.
set -euo pipefail
cd "$(dirname "$0")/.."
repo=$(pwd)
sha=$(git rev-parse --short HEAD)
corpus=$(pwd)/corpus/good/declarations
grammar=$(pwd)/corpus/good/grammar
shop=$(pwd)/corpus/good/printers_shop
skill=$(pwd)/corpus/skill/SKILL.md
packs=$(mktemp -d)
npm run build >/dev/null
node scripts/check-runtime-c.mjs --required
node scripts/check-runtime-c.mjs --required --sanitize
npm pack -w sprout -w player -w repl -w mcp -w server -w tui -w cli -w editors/language-server --pack-destination "$packs" >/dev/null
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
npx sprout test "$shop" "$shop"/transcripts/*.json --report reached.json | tail -2
# What the transcripts reached between them: every place, and some prose never shown.
node -e '
const r = require("./reached.json");
const { places, passages } = r.reach;
if (places.never.length > 0 || passages.never.length === 0 || r.faults.length > 0) process.exit(1);
console.log(`reached ${places.reached.length} of ${places.declared} places, ${passages.reached.length} of ${passages.declared} passages`);
'
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
# The installed MCP host, over stdio: an agent arrives and looks, and the recording plays back as written.
cat > mcp.cjs <<'MCP'
const { spawn } = require('node:child_process');
const host = spawn('npx', ['sprout', 'mcp', 'shed', '--record', 'mcp.json', '--advance-per-turn', '30s']);
const send = (message) => host.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
let out = '';
const give = (code, words) => { console.log(words); host.stdin.end(); setTimeout(() => process.exit(code), 500); };
setTimeout(() => give(1, 'the MCP host never answered'), 20000);
host.stdout.on('data', (data) => {
  out += data;
  const answers = out.split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line));
  const looked = answers.find((one) => one.id === 3);
  if (looked !== undefined) give(0, `sprout mcp: ${looked.result.content[0].text.split('\n')[0]}`);
});
send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '0' } } });
send({ method: 'notifications/initialized' });
send({ id: 2, method: 'tools/call', params: { name: 'arrive', arguments: { name: 'Marta' } } });
send({ id: 3, method: 'tools/call', params: { name: 'say', arguments: { name: 'Marta', line: 'look' } } });
MCP
node mcp.cjs | tee mcp.txt
grep -qx 'sprout mcp: There is nothing special about a hall.' mcp.txt
npx sprout play shed mcp.json > mcp-played.json
diff -u mcp.json mcp-played.json
echo "the installed MCP host played a visitor over stdio, and its recording plays back as written"
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
# The installed language server, over stdio: an unsaved edit to the kind is checked with the whole world.
cat > lsp.cjs <<'LSP'
const { spawn } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const server = spawn('./node_modules/.bin/sprout-language-server', ['--stdio']);
const send = (message) => {
  const body = JSON.stringify({ jsonrpc: '2.0', ...message });
  server.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
};
const file = resolve('shed/lantern.sprout');
const uri = pathToFileURL(file).href;
let buffer = Buffer.alloc(0);
const give = (code, words) => { console.log(words); server.kill(); process.exit(code); };
setTimeout(() => give(1, `no diagnostics came for ${uri}`), 15000);
server.stdout.on('data', (data) => {
  buffer = Buffer.concat([buffer, data]);
  for (;;) {
    const head = buffer.indexOf('\r\n\r\n');
    if (head < 0) return;
    const length = Number(/Content-Length: (\d+)/.exec(buffer.subarray(0, head).toString())[1]);
    if (buffer.length < head + 4 + length) return;
    const message = JSON.parse(buffer.subarray(head + 4, head + 4 + length).toString());
    buffer = buffer.subarray(head + 4 + length);
    const { method, params } = message;
    if (method === 'textDocument/publishDiagnostics' && params.uri === uri && params.diagnostics.length > 0)
      give(0, `language server: ${params.diagnostics[0].message.split('\n')[0]}`);
  }
});
send({ id: 1, method: 'initialize', params: { processId: null, rootUri: null, capabilities: {} } });
send({ method: 'initialized', params: {} });
const text = readFileSync(file, 'utf8').replace('sprout.Fixture', 'sprout.Fixtur');
send({ method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: 'sprout', version: 1, text } } });
LSP
node lsp.cjs | tee lsp.txt
grep -q 'Fixtur' lsp.txt
# The C runtime and the TypeScript one take the same fuzzed plays of every corpus world, about two thousand
# typed lines in all, and print the same things turn by turn.
(cd "$repo" && node scripts/check-runtime-c.mjs --required | tail -1 && node scripts/fuzz-runtime.mjs --corpus --readings 2000 | tee "$packs/fuzz.txt" | tail -1)
grep -q 'no divergence' "$packs/fuzz.txt"
cd / && rm -rf "$sandbox" "$packs"
echo "e2e: green (scaffold, check, parse, view, play (scripted and interactive), test (and its report), skill and mcp from the installed CLI, a world served by the installed server to the installed client, the installed language server, and the C runtime against the TypeScript one over fuzzed plays, at $sha)"
