import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { scaffold } from './command.js';

describe('`sprout scaffold`', () => {
  it('writes a world, then a kind, an object and a test into it', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'sprout-scaffold-')), 'shop');
    expect(scaffold(['world', dir], { author: 'marta' }).page).toContain('sprout.json');
    expect(scaffold(['kind', 'Key', dir], { is: 'sprout.Fixture' }).ok).toBe(true);
    expect(scaffold(['object', 'brass_key', dir], { in: 'hall', is: 'Key' }).ok).toBe(true);
    expect(scaffold(['test', 'keys', dir], {}).ok).toBe(true);
  });

  it('says what it makes, and what to name, where it is not told', () => {
    expect(scaffold([], {})).toMatchObject({
      ok: false,
      page: expect.stringContaining('sprout scaffold kind Name'),
    });
    expect(scaffold(['kind'], {}).page).toBe('Name the kind after it: sprout scaffold kind Key\n');
  });
});
