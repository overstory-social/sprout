import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { checkWorld, formatCheck, formatCheckJson } from './check.js';
import { initWorld } from './init.js';

function worldWith(files: Record<string, string>): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'sprout-check-')), 'w');
  initWorld(dir, 'marta');
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

describe('checkWorld', () => {
  it('passes what init wrote, and says what it checked', () => {
    const result = checkWorld(worldWith({}));
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(formatCheck(result)).toBe('ok: 1 declarations in 1 files\n');
  });

  it('refuses a broken file by file, line and column, as a page and as JSON', () => {
    const dir = worldWith({ 'world.sprout': 'world w {\n  visitors are 42\n}\n' });
    const result = checkWorld(dir);
    expect(result.ok).toBe(false);
    expect(result.bundle).toBeNull();
    const page = formatCheck(result);
    expect(page).toContain('world.sprout:2:');
    expect(page).toMatch(/refused: \d+ problems?\n$/);
    const json = JSON.parse(formatCheckJson(result));
    expect(json.ok).toBe(false);
    expect(json.diagnostics[0]).toMatchObject({ file: 'world.sprout', line: 2, severity: 'refusal' });
    expect(typeof json.diagnostics[0].column).toBe('number');
  });

  it('refuses a manifest that is not one, at the key that is wrong', () => {
    const dir = worldWith({ 'sprout.json': '{ "name": "w", "version": 3 }\n' });
    const result = checkWorld(dir);
    expect(result.ok).toBe(false);
    const page = formatCheck(result);
    expect(page).toContain('sprout.json:1:');
    expect(page).toContain('version');
  });

  it('counts a file the manifest does not name', () => {
    const dir = worldWith({ 'extra.sprout': 'enum Ward { oak }\n' });
    const result = checkWorld(dir);
    expect(result.ok).toBe(false);
    expect(formatCheck(result)).toContain('the manifest does not name it');
  });
});
