import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { readArchive } from './archive.js';
import { checkArchive, formatCheck, formatCheckJson } from './check.js';
import { main } from './cli.js';
import { captured } from './testing.js';

// `sprout check`: the two example archives pass; a deliberately broken
// one fails by file, line and column, and the same as JSON — the
// compiler's Problem exactly, for an editor or a CI step.

const EXAMPLES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'sprout-examples');

describe('checkArchive', () => {
  it('both example archives compile strictly, with a door', () => {
    for (const slug of ['pottery-studio', 'wanderers-shed']) {
      const r = checkArchive(readArchive(join(EXAMPLES, slug)));
      expect(r.ok, slug).toBe(true);
      expect(r.program.entry).not.toBeNull();
      expect(formatCheck(r)).toMatch(/^ok: \d+ rooms, \d+ objects, \d+ kinds, the door is \w+\n$/);
    }
  });

  it('a broken archive: problems by file, line and column; the JSON is the compiler’s Problem exactly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sprout-check-'));
    mkdirSync(join(dir, 'rooms'));
    writeFileSync(
      join(dir, 'sprout.json'),
      '{"format":1,"language":1,"entry":"hall","extensions":[]}',
    );
    writeFileSync(join(dir, 'rooms', 'hall.sprout'), 'room hall {\n  exit "down" to cellar\n}\n');
    writeFileSync(join(dir, 'rooms', 'ghost.sprout'), 'object ghost: Ghost in hall {}\n');
    writeFileSync(join(dir, 'rooms', 'far.sprout'), 'use teleport\nroom far {}\n');
    const r = checkArchive(readArchive(dir));
    expect(r.ok).toBe(false);
    expect(formatCheck(r)).toBe(
      [
        // (the compiler names a missing extension twice — once for the archive's
        // union of `use` lines, once for the file's own; the language's, not the CLI's)
        'rooms/far.sprout:1:1 This host has no extension called "teleport".',
        'rooms/far.sprout:1:5 This host has no extension called "teleport".',
        'rooms/ghost.sprout:1:1 No kind called "Ghost" is defined here.',
        'rooms/hall.sprout:1:1 No room is called "cellar" here (the exit "down" from hall).',
        '',
      ].join('\n'),
    );
    const json = JSON.parse(formatCheckJson(r)) as { ok: boolean; problems: unknown[] };
    expect(json.ok).toBe(false);
    expect(json.problems[2]).toEqual({
      file: 'rooms/ghost.sprout',
      definition: 'ghost',
      line: 1,
      column: 1,
      message: 'No kind called "Ghost" is defined here.',
      level: null,
    });
  });

  it('an archive that needs a newer language is refused by its manifest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sprout-check-'));
    writeFileSync(
      join(dir, 'sprout.json'),
      '{"format":1,"language":99,"entry":"hall","extensions":[]}',
    );
    writeFileSync(join(dir, 'hall.sprout'), 'room hall {}\n');
    const r = checkArchive(readArchive(dir));
    expect(r.problems[0]).toMatchObject({
      file: 'sprout.json',
      message: expect.stringContaining('needs language level 99'),
    });
  });

  it('through the command: exit 0 on the studio, exit 1 with --json on the broken one', async () => {
    const io = captured();
    expect(await main(['check', join(EXAMPLES, 'pottery-studio')], io)).toBe(0);
    expect(io.out()).toMatch(/^ok: 7 rooms/);
    const dir = mkdtempSync(join(tmpdir(), 'sprout-check-'));
    writeFileSync(join(dir, 'a.sprout'), 'room a {\n  exit "x" to nowhere\n}\n');
    const bad = captured();
    expect(await main(['check', dir, '--json'], bad)).toBe(1);
    expect(JSON.parse(bad.out())).toMatchObject({ ok: false, problems: [{ file: 'a.sprout' }] });
    const missing = captured();
    expect(await main(['check', join(dir, 'nope')], missing)).toBe(1);
    expect(missing.err()).toContain('no such folder or zip');
  });
});
