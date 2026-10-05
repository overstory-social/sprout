import { describe, expect, it } from 'vitest';

import {
  BODIES,
  STATEMENT_TABLE,
  standsIn,
  statementEntries,
  statementsSection,
  type StatementEntry,
} from './statements.js';
import { STATEMENT_WORDS } from '../../syntax/parse/statements.js';

const entry = (word: string): StatementEntry => STATEMENT_TABLE.find((one) => one.word === word)!;
const where = (one: StatementEntry): string[] =>
  BODIES.filter((body) => standsIn(one, body)).map((body) => body.name);

// Each test here compiles every example the skill shows, which is slow work and
// not a timing guard, so it is not held to vitest's five-second default.
const COMPILES_EVERY_EXAMPLE = 60_000;

describe('the statements the skill lists', { timeout: COMPILES_EVERY_EXAMPLE }, () => {
  it('are exactly the parser’s, in its order, then a call that writes', () => {
    const entries = statementEntries();
    expect(entries.map((one) => one.word)).toEqual([...STATEMENT_WORDS, null]);
    for (const one of STATEMENT_TABLE) {
      if (one.word !== null) expect(STATEMENT_WORDS, one.word).toContain(one.word);
    }
  });

  it('each stand somewhere, so an example is refused only for where it stands', () => {
    for (const one of STATEMENT_TABLE) expect(where(one), one.example).not.toEqual([]);
  });

  it('stand where the spec’s What it refuses says, as the checker decides it', () => {
    const decides = ['a guard', 'a `permit`'];
    const acts = ['a `do`', 'a handler or hook'];
    const everywhere = BODIES.map((body) => body.name);
    expect(where(entry('if'))).toEqual(everywhere);
    expect(where(entry('let'))).toEqual(everywhere);
    expect(where(entry('each'))).toEqual(everywhere);
    expect(where(entry('refuse'))).toEqual(decides);
    expect(where(entry('allow'))).toEqual(decides);
    expect(where(entry('say'))).toEqual(['a `do`']);
    expect(where(entry('tell'))).toEqual(acts);
    expect(where(entry('text'))).toEqual(['a `describe`']);
    for (const word of [
      'spawn',
      'destroy',
      'finally',
      'move',
      'connect',
      'act',
      'send',
      'broadcast',
      'wake',
    ]) {
      expect(where(entry(word)), word).toEqual(acts);
    }
    expect(where(STATEMENT_TABLE.find((one) => one.word === null)!)).toEqual(acts);
  });

  it('prints a row for each, marking each body it may stand in', () => {
    const section = statementsSection();
    const rows = section.split('\n').filter((line) => line.startsWith('| `'));
    expect(rows).toHaveLength(STATEMENT_WORDS.length + 1);
    expect(section).toContain(
      '| `say "Hello."` | speaks to the one acting, in text or a passage | — | — | yes | — | — |',
    );
  });
});
