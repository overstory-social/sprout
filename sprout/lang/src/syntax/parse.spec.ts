import { describe, expect, it } from 'vitest';

import type { EnumDeclaration } from './ast.js';
import { DECLARATIONS } from './parse.js';
import { locationOf } from '../source/source.js';
import { read, optionsOf } from '../fixtures/parse.js';

/**
 * One well-formed declaration for each word this compiler reads.
 *
 * A rule that holds for declarations in general needs a real one of
 * each, and `${word} Two { a }` is not that: it is an enum's shape
 * written out three times, and `message Two { a }` is not a message.
 * The specs below assert this table covers `DECLARATIONS`, so a word
 * added to the compiler is given a sample here rather than quietly
 * skipping every rule that walks them.
 */
const A_DECLARATION: Record<string, string> = {
  enum: 'enum Two { a }',
  message: 'message :stir',
  world: 'world two: sprout.World { visitors are P\n visitors arrive at y }',
};

/**
 * Other ways the same declaration may open, where a word has more than
 * one. Recovery has to stop at every one of them, and a rule that only
 * ever sees the commonest spelling drops the others in silence — with
 * `world`'s brace-on-its-own form missing here, deleting the brace from
 * `world`'s row in `DECLARATION_SHAPES` passes the whole suite. A world
 * that leaves `sprout.World` out is refused a layer later, and the
 * parser has to read it as a world for that refusal to be reached.
 */
const ALSO_WRITTEN: Record<string, string[]> = {
  world: [
    'world two: sprout.World, victorian.Voice { visitors are P\n visitors arrive at y }',
    'world two { visitors are P\n visitors arrive at y }',
  ],
};

/** Every spelling of one word's declaration, the commonest one first. */
function spellingsOf(word: string): string[] {
  return [sampleOf(word), ...(ALSO_WRITTEN[word] ?? [])];
}

/** Every rule that walks `DECLARATIONS` checks the table has kept up. */
function sampleOf(word: string): string {
  expect(Object.keys(A_DECLARATION), `${word} has no sample in A_DECLARATION`).toContain(word);
  return A_DECLARATION[word]!;
}

describe('a forgotten brace does not eat the declaration after it', () => {
  it('names the unclosed enum and keeps the sibling that follows', () => {
    const { declarations, refusals } = read('enum Ward {\n  oak\nenum Two { a, b }\n');
    expect(refusals.map((d) => d.message)).toEqual(['`Ward` is never closed.']);
    expect(declarations.map((d) => (d as EnumDeclaration).name.text)).toEqual(['Ward', 'Two']);
    expect(optionsOf(declarations[0] as EnumDeclaration)).toEqual(['oak']);
  });

  it('does the same for a message after it', () => {
    const { declarations, refusals } = read('enum Ward {\n  oak\nmessage :stir\n');
    expect(refusals.map((d) => d.message)).toEqual(['`Ward` is never closed.']);
    expect(declarations.map((d) => d.kind)).toEqual(['enum', 'message']);
  });

  it('reads a declaration keyword as one however that declaration is written', () => {
    // Every spelling, not just the commonest: this is the loop that
    // reads what the author WROTE, so it is the one `DECLARATION_SHAPES`
    // governs, and a spelling missing from that table is a declaration
    // swallowed as an option. Recovery cannot stand in for this — it
    // asks a looser question that never consults the table at all.
    for (const word of DECLARATIONS) {
      for (const written of spellingsOf(word)) {
        const { declarations } = read(`enum Ward {\n  oak\n${written}`);
        expect(optionsOf(declarations[0] as EnumDeclaration), written).toEqual(['oak']);
        expect(
          declarations.map((d) => d.kind),
          written,
        ).toHaveLength(2);
      }
    }
  });

  it('and ends the body before it even where the name was forgotten', () => {
    // `enum {` and `world {` are a declaration the author started and
    // did not finish naming — still a declaration, so the body before
    // it ends here. Reading the word as an option instead keeps the
    // mistake and loses everything after it. Recovery cannot stand in
    // for this test either: it asks the looser question, which never
    // consults `DECLARATION_SHAPES`.
    for (const [nameless, said] of [
      ['enum { a }', 'An enum needs a name.'],
      ['world { }', 'A world needs a name.'],
    ] as const) {
      const { declarations, refusals } = read(`enum Ward {\n  oak\n${nameless}`);
      expect(optionsOf(declarations[0] as EnumDeclaration), nameless).toEqual(['oak']);
      expect(
        refusals.map((d) => d.message),
        nameless,
      ).toEqual(['`Ward` is never closed.', said]);
    }
  });

  it('reads one at the very end of the file as a word, not as a declaration', () => {
    // Both things said are true of what is written: `message` stands
    // where an option should and may not, and the file stopped before
    // the brace. Treating the word as a declaration the author started
    // would instead invent a third, a name they never wrote.
    const { declarations, refusals } = read('enum Ward { oak, message');
    expect(refusals.map((d) => d.message)).toEqual([
      '`message` is a word of the language, so it cannot be an option of `Ward`.',
      '`Ward` is never closed.',
    ]);
    expect(optionsOf(declarations[0] as EnumDeclaration)).toEqual(['oak']);
  });

  it('points at the keyword, which is where the brace should have been', () => {
    const { refusals } = read('enum Ward {\n  oak\nenum Two { a }\n');
    expect(locationOf(refusals[0]!.at)).toBe('ward.sprout:3:1');
  });

  it('says it once, not once per option it had already read', () => {
    const { refusals } = read('enum Ward {\n  oak, silver, brass\nenum Two { a }\n');
    expect(refusals).toHaveLength(1);
  });
});

describe('every place that asks where a declaration starts reads one table', () => {
  it('reads every word it says it reads', () => {
    for (const word of DECLARATIONS) {
      const { declarations, refusals } = read(sampleOf(word));
      expect(refusals, word).toEqual([]);
      expect(declarations, word).toHaveLength(1);
    }
  });

  it('stops recovery at every word it reads, however that word is written', () => {
    for (const word of DECLARATIONS) {
      for (const written of spellingsOf(word)) {
        const { declarations } = read(`nonsense\n${written}`);
        expect(declarations, written).toHaveLength(1);
      }
    }
  });

  it('reads every spelling cleanly, so the rule above is not asserting a refusal', () => {
    for (const word of DECLARATIONS) {
      for (const written of spellingsOf(word)) {
        const { declarations, refusals } = read(written);
        expect(refusals, written).toEqual([]);
        expect(declarations, written).toHaveLength(1);
      }
    }
  });
});
