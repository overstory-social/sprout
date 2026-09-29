import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { scaffoldTest } from './test.js';
import { scaffoldWorld } from './world.js';

describe('`scaffold test`', () => {
  it('writes a test that arrives, for the author to grow, and refuses one that is there', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'sprout-scaffold-')), 'shop');
    scaffoldWorld(dir, 'marta');
    expect(scaffoldTest('opening_the_cabinet', dir)).toEqual({
      ok: true,
      page: 'wrote tests/opening_the_cabinet.json\n',
    });
    const test = JSON.parse(
      readFileSync(join(dir, 'tests', 'opening_the_cabinet.json'), 'utf8'),
    ) as { steps: unknown[] };
    expect(test.steps).toEqual([{ arrive: 'Marta', expect: [] }]);
    expect(scaffoldTest('opening_the_cabinet', dir).page).toBe(
      'tests/opening_the_cabinet.json is there already. Nothing was written.\n',
    );
    expect(scaffoldTest('Opening', dir).ok).toBe(false);
    expect(existsSync(join(dir, 'tests', 'Opening.json'))).toBe(false);
  });
});
