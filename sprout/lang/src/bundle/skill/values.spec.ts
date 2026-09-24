import { describe, expect, it } from 'vitest';

import { compileSnippet } from './bench.js';
import {
  DRAW_TABLE,
  READING_TABLE,
  TYPE_TABLE,
  valuesProbe,
  valuesSection,
  WRITE_TABLE,
} from './values.js';
import { DRAWS } from '../../check/chance.js';
import { READINGS } from '../../check/check/readings.js';
import { EFFECTS } from '../../check/check/writes.js';
import { BUILT_IN_TYPES } from '../../declare/types.js';

const words = (table: readonly { word: string }[]): string[] => table.map((entry) => entry.word);

describe('the values the skill lists', () => {
  it('are exactly the checker’s readings, writes and draws, and the types a property takes', () => {
    expect(words(READING_TABLE).sort()).toEqual([...READINGS].sort());
    expect(words(WRITE_TABLE).sort()).toEqual([...EFFECTS].sort());
    expect(words(DRAW_TABLE).sort()).toEqual([...DRAWS].sort());
    expect(words(TYPE_TABLE)).toEqual([...BUILT_IN_TYPES, 'enum', 'list', 'remembers']);
  });

  it('are shown by examples that all compile, together, with nothing to say', () => {
    expect(compileSnippet(valuesProbe()).diagnostics).toEqual([]);
  });

  it('prints every example, and where a draw may stand as the checker decides it', () => {
    const section = valuesSection();
    for (const entry of [...TYPE_TABLE, ...READING_TABLE, ...WRITE_TABLE, ...DRAW_TABLE]) {
      expect(section, entry.word).toContain(`| \`${entry.example}\` |`);
    }
    expect(section).toContain(
      'A draw may stand in a `do` and a handler or hook, and in no other body.',
    );
    expect(section).toContain('ranges over -2,147,483,648 to 2,147,483,647');
  });
});
