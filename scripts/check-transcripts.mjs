// `npm run check`, its second half: the golden transcripts. Every
// `corpus/good/<world>/transcripts/*.txt` is a script `sprout play` plays
// through real turns, and is also what playing it prints, so a transcript
// that plays back other than as written is a changed behaviour. `--write`
// replays each and writes what it printed; review the diff like any other
// change.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const write = process.argv.includes('--write');
const cli = join('cli', 'bin', 'sprout.js');
const play = (world, script) => {
  try {
    return { code: 0, out: execFileSync('node', [cli, 'play', world, script], { encoding: 'utf8' }) };
  } catch (err) {
    return { code: err.status, out: String(err.stdout) + String(err.stderr) };
  }
};

let failed = 0;
let played = 0;
for (const name of readdirSync('corpus/good').sort()) {
  const world = join('corpus/good', name);
  const folder = join(world, 'transcripts');
  if (!existsSync(folder)) continue;
  for (const file of readdirSync(folder).filter((f) => f.endsWith('.txt')).sort()) {
    const script = join(folder, file);
    const { code, out } = play(world, script);
    played++;
    if (code !== 0) {
      failed++;
      console.error(`✗ ${script}: did not play\n${out}`);
      continue;
    }
    if (write) {
      writeFileSync(script, out);
      console.log(`wrote ${script}`);
      continue;
    }
    const expected = readFileSync(script, 'utf8');
    if (expected !== out) {
      failed++;
      console.error(`✗ ${script}: the transcript changed\n--- expected\n${expected}--- actual\n${out}`);
      continue;
    }
    console.log(`✓ ${script} plays as written`);
  }
}
if (failed > 0) {
  console.error(`✗ ${failed} transcript(s) did not play as written`);
  process.exit(1);
}
console.log(`✓ transcripts: all ${played} play as written`);
