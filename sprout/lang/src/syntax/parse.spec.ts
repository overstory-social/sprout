import { describe, expect, it } from 'vitest';

import type { EnumDeclaration } from './ast.js';
import { DECLARATIONS, parseProse, parseProseFile, parseStatement } from './parse.js';
import { Diagnostics } from '../source/diagnostics.js';
import { locationOf, SourceFile } from '../source/source.js';
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
  kind: 'kind Two is sprout.Container { :open true }',
  message: 'message :stir',
  object: 'object two is Crate { contains }',
  verb: 'verb two { role target: Crate  "two [target]" }',
  world: 'world two is sprout.World { visitors are P\n visitors arrive at y }',
};

/**
 * Other ways the same declaration may open, where a word has more than
 * one. Recovery has to stop at every one of them, and a rule that only
 * ever sees the commonest spelling drops the others in silence — with
 * `world`'s brace-on-its-own form missing here, deleting the brace from
 * `world`'s row in `DECLARATION_SHAPES` passes the whole suite. A world
 * that leaves `sprout.World` out is refused a layer later, and the
 * parser has to read it as a world for that refusal to be reached. A
 * kind may compose nothing, an object may leave its body out or its kinds
 * (which is refused a layer later), and a verb may have no roles, no
 * phrases, or neither.
 */
const ALSO_WRITTEN: Record<string, string[]> = {
  kind: ['kind Two { }', 'kind Two is Crate, sprout.Container { contains actors }'],
  object: ['object two is Crate', 'object two is Crate, sprout.Fixture { }', 'object two { }'],
  verb: ['verb two { "two" }', 'verb two { }', 'verb two { role target  role tools many }'],
  world: [
    'world two is sprout.World, victorian.Voice { visitors are P\n visitors arrive at y }',
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

/**
 * What a file keeps of one declaration written well at its top level: the
 * declaration, and nothing said. An `object` is the exception, since an
 * object is written inside what holds it: at the top level it is read
 * whole, so it ends what came before it and takes nothing after it, and
 * refused, and the file keeps nothing of it.
 */
function keptAtTopLevel(word: string): { declarations: number; said: string[] } {
  return word === 'object'
    ? {
        declarations: 0,
        said: [
          '`two` is written outside the world, and an object is written inside what holds it.',
        ],
      }
    : { declarations: 1, said: [] };
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
        ).toHaveLength(1 + keptAtTopLevel(word).declarations);
      }
    }
  });

  it('and ends the body before it even where the name was forgotten', () => {
    // `enum {`, `kind {`, `verb {` and `world {` are a declaration the author started and
    // did not finish naming — still a declaration, so the body before
    // it ends here. Reading the word as an option instead keeps the
    // mistake and loses everything after it. Recovery cannot stand in
    // for this test either: it asks the looser question, which never
    // consults `DECLARATION_SHAPES`.
    for (const [nameless, said] of [
      ['enum { a }', 'An enum needs a name.'],
      ['world { }', 'A world needs a name.'],
      ['kind { }', 'A kind needs a name.'],
      ['verb { }', '`verb` needs a name.'],
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
      expect(
        refusals.map((d) => d.message),
        word,
      ).toEqual(keptAtTopLevel(word).said);
      expect(declarations, word).toHaveLength(keptAtTopLevel(word).declarations);
    }
  });

  it('stops recovery at every word it reads, however that word is written', () => {
    for (const word of DECLARATIONS) {
      for (const written of spellingsOf(word)) {
        const { declarations, refusals } = read(`nonsense\n${written}`);
        expect(declarations, written).toHaveLength(keptAtTopLevel(word).declarations);
        expect(
          refusals.slice(1).map((d) => d.message),
          written,
        ).toEqual(keptAtTopLevel(word).said);
      }
    }
  });

  it('reads every spelling cleanly, so the rule above is not asserting a refusal', () => {
    for (const word of DECLARATIONS) {
      for (const written of spellingsOf(word)) {
        const { declarations, refusals } = read(written);
        expect(
          refusals.map((d) => d.message),
          written,
        ).toEqual(keptAtTopLevel(word).said);
        expect(declarations, written).toHaveLength(keptAtTopLevel(word).declarations);
      }
    }
  });
});

describe('one statement, read on its own', () => {
  const statement = (text: string) => {
    const diagnostics = new Diagnostics();
    const read = parseStatement(new SourceFile('s.sprout', text), diagnostics);
    return { read, said: diagnostics.refusals.map((d) => `${locationOf(d.at)} ${d.message}`) };
  };

  it('reads each statement this compiler reads', () => {
    for (const [text, kind] of [
      ['let n = 1', 'let'],
      ['spawn Cup in self', 'spawn'],
      ['destroy self', 'destroy'],
    ] as const) {
      const { read, said } = statement(text);
      expect(said, text).toEqual([]);
      expect(read?.kind, text).toBe(kind);
    }
  });

  it('keeps the statement it read, and refuses what is written after it', () => {
    const { read, said } = statement('destroy self self');
    expect(read?.kind).toBe('destroy');
    expect(said).toEqual(['s.sprout:1:14 `self` does not start a statement this compiler reads.']);
  });

  it('says nothing more about what follows a statement it could not read', () => {
    expect(statement('spawn cup in self').said).toEqual([
      's.sprout:1:7 `cup` is not the name of a kind.',
    ]);
  });
});

describe('prose, read on its own', () => {
  it('reads a `.prose` file for its passages, and nothing else', () => {
    const diagnostics = new Diagnostics();
    const passages = parseProseFile(
      new SourceFile('m.prose', 'passage a { A. }\n:b 1\npassage c default { C. }'),
      diagnostics,
    );
    expect(passages.map((one) => one.name.text)).toEqual(['a', 'c']);
    expect(diagnostics.refusals.map((d) => locationOf(d.at))).toEqual(['m.prose:2:1']);
  });

  it('reads the whole of a text as a one-line passage’s words', () => {
    const diagnostics = new Diagnostics();
    const prose = parseProse(
      new SourceFile('the engine', '{item} cannot stand in {to}.'),
      diagnostics,
    );
    expect(diagnostics.all).toEqual([]);
    expect(prose.pieces.map((piece) => piece.kind)).toEqual([
      'prose-slot',
      'prose-words',
      'prose-slot',
      'prose-words',
    ]);
  });
});
