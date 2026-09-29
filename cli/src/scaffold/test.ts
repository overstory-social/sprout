import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { writeScript } from '@overstory/sprout-player';

import { applyScaffold, type Scaffolded } from './edits.js';

// `sprout scaffold test <name> [dir]`: a test in the world's `tests/`, a
// script that arrives and expects what the visitor reads there, for the
// author to grow; `sprout test` runs it.

/** A test's name as its file is named: lower case, digits, `_` and `-`. */
const TEST_NAME = /^[a-z0-9][a-z0-9_-]*$/;

export function scaffoldTest(name: string, dir: string): Scaffolded {
  if (!TEST_NAME.test(name)) {
    return {
      ok: false,
      page: `A test's name is lower case, digits, \`_\` and \`-\`: \`${name}\` is not. Write \`opening_the_cabinet\`.\n`,
    };
  }
  const file = `tests/${name}.json`;
  if (existsSync(join(dir, file)))
    return { ok: false, page: `${file} is there already. Nothing was written.\n` };
  const text = writeScript({
    about: `${name.replace(/[_-]+/g, ' ')}: what this test checks. \`sprout test\` plays it and checks each step's \`expect\`.`,
    steps: [{ arrive: 'Marta', expect: [] }],
  });
  return applyScaffold(dir, [{ file, text }]);
}
