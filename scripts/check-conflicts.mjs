// Refuses a tracked file that still holds a merge-conflict marker: a line
// opening `<<<<<<< `, `||||||| ` or `>>>>>>> `, or one that is exactly
// `=======`, which no file here writes as a setext heading.
// Prettier formats markdown without reading for these, so the gate asks
// first, and names each file and line.

import { spawnSync } from 'node:child_process';

const found = spawnSync(
  'git',
  ['grep', '-nE', '^(<<<<<<< |\\|\\|\\|\\|\\|\\|\\| |>>>>>>> |=======$)'],
  {
    encoding: 'utf8',
  },
);

if (found.status === 1) process.exit(0);
if (found.status !== 0) {
  process.stderr.write(found.stderr);
  process.exit(found.status ?? 2);
}
process.stderr.write(`merge-conflict markers left in:\n${found.stdout}`);
process.exit(1);
