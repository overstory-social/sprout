import { describe, expect, it } from 'vitest';

import type { LetStatement, SpawnStatement, Statement } from '../ast.js';
import { writtenPath } from '../ast.js';
import { Diagnostics } from '../../source/diagnostics.js';
import { unspanned } from '../../source/nodes.js';
import { locationOf, SourceFile, textOf } from '../../source/source.js';
import { chooser, readStatement, shape, type Chooser } from '../../fixtures/parse.js';
import { Lexer } from '../lexer.js';
import { DECLARATION_READERS } from './declarations.js';
import { Parser } from './parser.js';
import { destroyStatement, letStatement, spawnStatement, statement } from './statements.js';

/** One reader, run over a string on its own. */
function readWith<T>(read: (p: Parser) => T, text: string) {
  const diagnostics = new Diagnostics();
  const p = new Parser(new SourceFile('body.sprout', text), diagnostics, DECLARATION_READERS);
  return { read: read(p), refusals: diagnostics.refusals, done: p.done };
}

/** What a `let` names, as a shape, where it names an expression. */
function valueShape(statement: LetStatement): string {
  if (statement.value.kind === 'spawn') return spawnShape(statement.value);
  return shape(statement.value);
}

/** A spawn's kind and container as written. */
function spawnShape(spawn: SpawnStatement): string {
  const kind = spawn.spawned.library === null ? '' : `${spawn.spawned.library.text}.`;
  return `spawn ${kind}${spawn.spawned.name.text} in ${writtenPath(spawn.container)}`;
}

describe('`let` names the result of an expression', () => {
  it('reads the spec’s own two', () => {
    const ribs = readStatement('let ribs  = tools.count(Rib)');
    expect(ribs.refusals).toEqual([]);
    const statement = ribs.statement as LetStatement;
    expect(statement.name.text).toBe('ribs');
    expect(statement.value.kind).not.toBe('spawn');
    expect(valueShape(statement)).toBe('tools.count(Rib)');

    const state = readWith(letStatement, 'let state = self.get(:state)');
    expect(state.refusals).toEqual([]);
    expect(state.read!.name.text).toBe('state');
    expect(valueShape(state.read!)).toBe('self.get(:state)');
  });

  it('spans from the keyword to the end of what it names', () => {
    const { statement } = readStatement('let ribs = tools.count(Rib)');
    expect(textOf(statement!.at)).toBe('let ribs = tools.count(Rib)');
    expect(locationOf((statement as LetStatement).name.at)).toBe('body.sprout:1:5');
  });

  it('names a whole expression, not only a simple one', () => {
    const { statement } = readStatement('let ready = self.get(:wear) >= 99 && !self.get(:lit)');
    expect(valueShape(statement as LetStatement)).toBe(
      '((self.get(:wear) >= 99) && (!self.get(:lit)))',
    );
  });

  it('takes no type, because it takes the expression’s exactly', () => {
    const { statement, refusals } = readStatement('let n: integer = 1');
    expect(statement).toBeNull();
    expect(refusals[0]!.message).toContain('takes its type from what it names');
    expect(refusals[0]!.remedy).toContain('let n = ');
  });

  it('says what is wrong with one that is not written out', () => {
    const table: [string, string][] = [
      ['let', 'A `let` needs a name.'],
      ['let =', 'A `let` needs a name.'],
      ['let 4 = 1', 'A `let` needs a name.'],
      ['let Ward = 1', 'starts with a capital'],
      ['let x', 'is not given anything to name'],
      ['let x = ', 'the end of the file is not something to read'],
    ];
    for (const [text, said] of table) {
      const { statement, refusals } = readStatement(text);
      expect(statement, text).toBeNull();
      expect(refusals.map((d) => d.message).join(' '), text).toContain(said);
      for (const refusal of refusals)
        expect(refusal.remedy ?? '', `${text}: no remedy`).not.toBe('');
    }
  });

  it('refuses a word of the language as the name, at the name', () => {
    const { statement, refusals } = readStatement('let default = 1');
    expect(statement).toBeNull();
    expect(refusals).toHaveLength(1);
    expect(refusals[0]!.message).toBe(
      '`default` is a word of the language, so it cannot name a value.',
    );
    expect(refusals[0]!.remedy).toContain('Choose another name');
    expect(locationOf(refusals[0]!.at)).toBe('body.sprout:1:5');
  });

  it('refuses every reserved word there, and no ordinary word', () => {
    for (const word of ['text', 'true', 'string', 'each', 'let', 'spawn', 'destroy']) {
      const { statement, refusals } = readStatement(`let ${word} = 1`);
      expect(statement, word).toBeNull();
      expect(refusals.map((d) => d.message).join(' '), word).toContain('word of the language');
    }
    expect(readStatement('let textures = 1').refusals).toEqual([]);
  });

  it('names what a `spawn` makes, since it is the one statement that yields a binding', () => {
    const { statement, refusals } = readStatement('let cell = spawn MazeCell in self');
    expect(refusals).toEqual([]);
    const named = statement as LetStatement;
    expect(named.name.text).toBe('cell');
    expect(named.value.kind).toBe('spawn');
    expect(spawnShape(named.value as SpawnStatement)).toBe('spawn MazeCell in self');
    expect(textOf(named.at)).toBe('let cell = spawn MazeCell in self');
  });

  it('refuses a `destroy` as what it names, which yields nothing', () => {
    const { statement, refusals } = readStatement('let x = destroy self');
    expect(statement).toBeNull();
    expect(refusals.map((d) => [locationOf(d.at), d.message, d.remedy])).toEqual([
      [
        'body.sprout:1:9',
        '`destroy self` removes something, and is not something to read.',
        'Write it on its own line, as `destroy self`.',
      ],
    ]);
  });

  it('says what is wrong with the `spawn` it names, in the words a `spawn` is refused in', () => {
    const { statement, refusals } = readStatement('let cup = spawn Cup');
    expect(statement).toBeNull();
    expect(refusals.map((d) => d.message)).toEqual([
      '`spawn Cup` does not say where the new one goes.',
    ]);
  });
});

describe('`spawn` makes a new instance of a kind, in a container', () => {
  it('reads the spec’s own', () => {
    for (const text of [
      'spawn Cup in actor',
      'spawn Sheet in here',
      'spawn MazeCell in self',
      'spawn sprout.Container in kiln.shelf',
      'spawn Cup in from',
    ]) {
      const { statement, refusals } = readStatement(text);
      expect(
        refusals.map((d) => d.message),
        text,
      ).toEqual([]);
      expect(statement!.kind, text).toBe('spawn');
      expect(spawnShape(statement as SpawnStatement), text).toBe(text);
      expect(textOf(statement!.at), text).toBe(text);
      expect(unspanned(statement), text).toEqual([]);
    }
  });

  it('keeps the kind’s library and each step of the container, each with its own span', () => {
    const { read } = readWith(spawnStatement, 'spawn sprout.Container in kiln.shelf');
    expect(read!.spawned.library!.text).toBe('sprout');
    expect(textOf(read!.spawned.at)).toBe('sprout.Container');
    expect(read!.container.parts.map((part) => locationOf(part.at))).toEqual([
      'body.sprout:1:27',
      'body.sprout:1:32',
    ]);
  });

  it('says what is missing, where it is missing, and what to write', () => {
    const table: [string, string, string, string][] = [
      [
        'spawn',
        'body.sprout:1:6',
        '`spawn` does not say what kind of thing to make.',
        'Write the kind and where it goes, as in `spawn Cup in self`.',
      ],
      [
        'spawn cup in self',
        'body.sprout:1:7',
        '`cup` is not the name of a kind.',
        'A kind starts with a capital letter, as in `Creature` or `sprout.Container`.',
      ],
      [
        'spawn 3 in self',
        'body.sprout:1:7',
        'the number 3 is not the name of a kind.',
        'A kind starts with a capital letter, as in `Creature` or `sprout.Container`.',
      ],
      [
        'spawn sprout. in self',
        'body.sprout:1:15',
        '`sprout.` is not followed by the name of a kind.',
        'A kind starts with a capital letter, as in `sprout.Container`.',
      ],
      [
        'spawn Cup',
        'body.sprout:1:10',
        '`spawn Cup` does not say where the new one goes.',
        'Write `in` and what it goes into: `spawn Cup in self`.',
      ],
      [
        'spawn sprout.Container self',
        'body.sprout:1:23',
        '`spawn sprout.Container` does not say where the new one goes.',
        'Write `in` and what it goes into: `spawn sprout.Container in self`.',
      ],
      [
        'spawn Cup in',
        'body.sprout:1:13',
        'After `in` comes the thing the new `Cup` goes into.',
        'Name it in lower case, as in `spawn Cup in self` or `spawn Cup in actor`.',
      ],
      [
        'spawn Cup in Shelf',
        'body.sprout:1:14',
        'After `in` comes the thing the new `Cup` goes into.',
        'Name it in lower case, as in `spawn Cup in self` or `spawn Cup in actor`.',
      ],
      [
        'spawn Cup in kiln.',
        'body.sprout:1:18',
        'This path ends in a dot.',
        'After a dot comes the name of what is inside the thing before it, as in `kiln.shelf`; or take the dot out.',
      ],
    ];
    for (const [text, where, message, remedy] of table) {
      const { statement, refusals } = readStatement(text);
      expect(statement, text).toBeNull();
      expect(
        refusals.map((d) => [locationOf(d.at), d.message, d.remedy]),
        text,
      ).toEqual([[where, message, remedy]]);
    }
  });

  it('marks a missing `in` as a gap after the kind, not as the word that follows', () => {
    const { refusals } = readStatement('spawn Cup self');
    expect(refusals).toHaveLength(1);
    expect(refusals[0]!.at.start).toBe(refusals[0]!.at.end);
    expect(locationOf(refusals[0]!.at)).toBe('body.sprout:1:10');
  });
});

describe('`destroy self` is the only form', () => {
  it('reads it, spanning both words', () => {
    const { read, refusals } = readWith(destroyStatement, 'destroy   self');
    expect(refusals).toEqual([]);
    expect(read!.kind).toBe('destroy');
    expect(textOf(read!.at)).toBe('destroy   self');
  });

  it('says what is missing when nothing follows', () => {
    const { statement, refusals } = readStatement('destroy');
    expect(statement).toBeNull();
    expect(refusals.map((d) => [locationOf(d.at), d.message, d.remedy])).toEqual([
      [
        'body.sprout:1:8',
        '`destroy` does not say what to remove.',
        'Write `destroy self`: an object removes only itself.',
      ],
    ]);
  });

  it('refuses anything but `self`, once, at what was written', () => {
    for (const [text, at] of [
      ['destroy cup', 'cup'],
      ['destroy actor', 'actor'],
      ['destroy self.shelf', 'self.shelf'],
      ['destroy kiln.shelf.cup', 'kiln.shelf.cup'],
      ['destroy Cup', 'Cup'],
      ['destroy 3', '3'],
    ] as const) {
      const { statement, refusals } = readStatement(text);
      expect(statement, text).toBeNull();
      expect(
        refusals.map((d) => [textOf(d.at), d.message, d.remedy]),
        text,
      ).toEqual([
        [
          at,
          '`destroy` removes only the object whose body runs it.',
          'Write `destroy self`. To be rid of something else, send it a message and let it destroy itself.',
        ],
      ]);
    }
  });
});

describe('a statement', () => {
  it('is read by the word it starts with', () => {
    const kinds = ['let n = 1', 'spawn Cup in self', 'destroy self'].map(
      (text) => readWith(statement, text).read?.kind,
    );
    expect(kinds).toEqual(['let', 'spawn', 'destroy']);
  });

  it('refuses a word that starts none, naming the ones it reads', () => {
    for (const text of ['ribs = 1', 'self.set(:wear, 1)', 'Cup in self', '"text"']) {
      const { statement, refusals } = readStatement(text);
      expect(statement, text).toBeNull();
      expect(refusals, text).toHaveLength(1);
      expect(refusals[0]!.message, text).toContain(
        'does not start a statement this compiler reads',
      );
      expect(refusals[0]!.remedy).toBe(
        'A statement starts with `let`, `spawn` and `destroy`, as in `let cup = spawn Cup in self`.',
      );
      expect(locationOf(refusals[0]!.at), text).toBe('body.sprout:1:1');
    }
  });

  it('refuses what is written after one, as the next statement would be', () => {
    const { statement, refusals } = readStatement('spawn Cup in kiln shelf');
    expect(statement!.kind).toBe('spawn');
    expect(refusals.map((d) => [locationOf(d.at), d.message])).toEqual([
      ['body.sprout:1:19', '`shelf` does not start a statement this compiler reads.'],
    ]);
  });
});

// --- generated input -------------------------------------------------------
//
// The statement readers' share of the parser's recovery rule: a
// well-formed statement is read whole and in silence, and one with any
// single token taken out is refused exactly once — never passed, never
// refused twice for one gap, never thrown. The let values are ones in
// which every token is the parser's to miss: a call with its argument
// taken out is a well-formed call, and its arity is the checker's.

const KINDS = ['Cup', 'Sheet', 'MazeCell', 'sprout.Container', 'victorian.Voice'];
const TARGETS = ['self', 'actor', 'here', 'from', 'kiln.shelf', 'shop.kiln.shelf'];
const NAMES = ['cup', 'cell', 'n', 'ribs'];
const VALUES = ['1', '"a line"', 'true', 'target', 'self.count', 'n + 1', 'a == b', 'x.count > 3'];

/** One well-formed statement, and the kind of node it should read as. */
function wellFormed(c: Chooser): { text: string; kind: Statement['kind'] } {
  const gap = (): string => c.one([' ', ' ', '  ', '\n']);
  const spawn = (): string =>
    ['spawn', c.one(KINDS), 'in', c.one(TARGETS)]
      .map((word, i) => (i === 0 ? word : gap() + word))
      .join('');
  switch (c.below(4)) {
    case 0:
      return { text: spawn(), kind: 'spawn' };
    case 1:
      return { text: `destroy${gap()}self`, kind: 'destroy' };
    case 2:
      return { text: `let${gap()}${c.one(NAMES)}${gap()}=${gap()}${spawn()}`, kind: 'let' };
    default:
      return { text: `let${gap()}${c.one(NAMES)}${gap()}=${gap()}${c.one(VALUES)}`, kind: 'let' };
  }
}

/** Every token of a text, by where it was written. */
function tokensOf(text: string): { start: number; end: number }[] {
  const lexer = new Lexer(new SourceFile('g.sprout', text), new Diagnostics());
  const out: { start: number; end: number }[] = [];
  for (let token = lexer.next(); token.kind !== 'end'; token = lexer.next()) {
    out.push({ start: token.at.start, end: token.at.end });
  }
  return out;
}

describe('a statement never vanishes silently', () => {
  it('over generated statements, whole and with any one token taken out', () => {
    const c = chooser(20_260_923);
    const reached = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const made = wellFormed(c);
      const whole = readStatement(made.text);
      expect(
        whole.refusals.map((d) => d.message),
        made.text,
      ).toEqual([]);
      expect(whole.statement?.kind, made.text).toBe(made.kind);
      expect(textOf(whole.statement!.at), made.text).toBe(made.text.trim());
      reached.add(made.kind);

      for (const dropped of tokensOf(made.text)) {
        // A space where the token was only where its neighbours would
        // otherwise run together into one word the author never wrote.
        const before = made.text.slice(0, dropped.start);
        const after = made.text.slice(dropped.end);
        const joins = /\w$/.test(before) && /^\w/.test(after);
        const text = `${before}${joins ? ' ' : ''}${after}`;
        let read: ReturnType<typeof readStatement> | undefined;
        expect(() => {
          read = readStatement(text);
        }, text).not.toThrow();
        expect(
          read!.refusals.map((d) => d.message),
          `${JSON.stringify(text)}, from ${JSON.stringify(made.text)}`,
        ).toHaveLength(1);
      }
    }
    expect([...reached].sort()).toEqual(['destroy', 'let', 'spawn']);
  });
});
