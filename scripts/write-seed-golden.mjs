// Writes corpus/goldens/seeds.json: the seed `turnSeed` (player/src/seeds.ts) gives a tick's or a
// wake's turn for a handful of steps' seeds, paths and counts, which runtime-c/test/seeds.test.c
// reproduces. Run it only when the rule changes, and read the diff.

import { writeFileSync } from 'node:fs';

import { SEED_MAX } from '@overstory/sprout/lang';
import { turnSeed } from '@overstory/sprout-player';

const cases = [
  [0, 'yard.kiln', 0],
  [0, 'yard.kiln', 1],
  [1, 'yard.kiln', 0],
  [0, 'yard.oven', 0],
  [7, 'ü', 1],
  [SEED_MAX, 'reach.boat', 3],
  [123456789, 'a.b.c.d.e.f', 40],
  [42, 'x'.repeat(200), 2],
  [0, '', 0],
].map(([seed, path, nth]) => ({ seed, path, nth, turn: turnSeed(seed, path, nth) }));

writeFileSync(
  'corpus/goldens/seeds.json',
  `${JSON.stringify({ rule: 'sha256("<seed> <path> <nth>") first 32 bits', cases }, null, 2)}\n`,
);
