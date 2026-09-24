import { describe, expect, it } from 'vitest';

import type { Statement } from '../ast.js';
import { writtenPath } from '../ast.js';
import { DEFAULT_LIMITS, type StaticCaps } from '../../bundle/limits.js';
import { Diagnostics } from '../../source/diagnostics.js';
import { unspanned } from '../../source/nodes.js';
import { locationOf, SourceFile, textOf } from '../../source/source.js';
import { chooser, readStatement } from '../../fixtures/parse.js';
import { parserOver } from '../../fixtures/readers.js';
import { Lexer } from '../lexer.js';
import { refusal, sayStatement, tellStatement, textStatement } from './speech.js';
import { block, onItsOwn } from './statements.js';

const READERS = { say: sayStatement, tell: tellStatement, text: textStatement } as const;

/** One statement read by its own reader, over `text` alone. */
function read(text: string, caps: StaticCaps = DEFAULT_LIMITS.caps) {
  const { p, diagnostics } = parserOver(text, { name: 'body.sprout', caps });
  const word = p.peek().text as keyof typeof READERS;
  const statement = READERS[word](p, onItsOwn());
  return {
    statement,
    refusals: diagnostics.refusals,
    said: diagnostics.refusals.map((d) => [locationOf(d.at), d.message, d.remedy]),
    done: p.done,
  };
}

/** A `say`, `tell` or `text` written back as the parser holds it. */
function written(statement: Statement | null): string {
  if (statement === null) return 'null';
  if (statement.kind !== 'say' && statement.kind !== 'tell' && statement.kind !== 'text') {
    return statement.kind;
  }
  const to =
    statement.kind === 'tell' && statement.to !== null ? ` ${writtenPath(statement.to)}` : '';
  const said = statement.said.kind === 'ident' ? statement.said.text : `"${statement.said.value}"`;
  return `${statement.kind}${to} ${said}`;
}

describe('`say` speaks to the actor, in quotes or in a passage', () => {
  it('reads the words in quotes, or a passage’s name', () => {
    const quoted = read('say "The bolt slides back."');
    expect(quoted.refusals).toEqual([]);
    expect(quoted.statement).toMatchObject({
      kind: 'say',
      said: { kind: 'prose-literal', value: 'The bolt slides back.' },
    });
    expect(unspanned(quoted.statement!)).toEqual([]);
    const named = read('say taken');
    expect(named.statement).toMatchObject({ kind: 'say', said: { kind: 'ident', text: 'taken' } });
  });

  it('reads words in quotes as a one-line passage, whose slots are the file’s to point at', () => {
    const { statement, refusals } = read('say "You take {target}. \\{ is a brace."');
    expect(refusals).toEqual([]);
    if (statement?.kind !== 'say' || statement.said.kind !== 'prose-literal') {
      return expect.unreachable('a `say` in quotes was written');
    }
    const { pieces } = statement.said.prose;
    expect(pieces.map((piece) => piece.kind)).toEqual(['prose-words', 'prose-slot', 'prose-words']);
    expect(textOf(pieces[1]!.at)).toBe('{target}');
    expect(pieces[2]).toMatchObject({ text: '. { is a brace.' });
  });

  it('refuses a `say` with nothing to say, or a reading where the words go', () => {
    for (const [text, at] of [
      ['say', 'body.sprout:1:4'],
      ['say self.get(:x)', 'body.sprout:1:4'],
      ['say 4', 'body.sprout:1:5'],
    ] as const) {
      const { statement, said } = read(text);
      expect(statement, text).toBeNull();
      expect(said, text).toEqual([
        [
          at,
          '`say` says something.',
          'Write the words in quotes, as in `say "The bolt slides back."`, or name a passage, as in `say taken`.',
        ],
      ]);
    }
  });
});

describe('`tell` speaks to the place, or to the one it names', () => {
  it('reads the spec’s forms: to the place, and to a binding', () => {
    for (const [text, form] of [
      ['tell "{actor} pulls the lever, and somewhere below, water moves."', 'place'],
      ['tell pulled', 'place'],
      ['tell self "You are tagged."', 'self'],
      ['tell item greeting', 'item'],
      ['tell kiln.shelf "Warm."', 'kiln.shelf'],
    ] as const) {
      const { statement, refusals } = read(text);
      expect(refusals, text).toEqual([]);
      if (statement?.kind !== 'tell') return expect.unreachable(`${text} is a \`tell\``);
      expect(statement.to === null ? 'place' : writtenPath(statement.to), text).toBe(form);
      expect(textOf(statement.at), text).toBe(text);
      expect(unspanned(statement), text).toEqual([]);
    }
  });

  it('takes a lone word for a passage, never the next line’s for its words', () => {
    // The word on the next line starts something of its own.
    const { kinds, refusals } = blockOf('{ tell pulled\n  self.set(:n, 1)\n  tell p\n  say done }');
    expect(refusals).toEqual([]);
    expect(kinds).toEqual([
      'tell place pulled',
      'expression-statement',
      'tell place p',
      'say done',
    ]);
  });

  it('refuses a `tell` with nothing to say, in words naming who it is to', () => {
    expect(read('tell').said).toEqual([
      [
        'body.sprout:1:5',
        '`tell` says something.',
        'Write the words in quotes, as in `tell "{actor} pulls the lever."`, or name a passage, as in `tell pulled`.',
      ],
    ]);
    expect(read('tell kiln.shelf').said).toEqual([
      [
        'body.sprout:1:16',
        '`tell kiln.shelf` says something.',
        'Write the words in quotes, as in `tell kiln.shelf "{actor} pulls the lever."`, or name a passage, as in `tell kiln.shelf pulled`.',
      ],
    ]);
    expect(read('tell self 4').said.map(([at]) => at)).toEqual(['body.sprout:1:11']);
  });

  it('refuses a dotted path it cannot read once, at the step', () => {
    const { statement, refusals } = read('tell kiln. "Warm."');
    expect(statement).toBeNull();
    expect(refusals).toHaveLength(1);
  });
});

describe('`text` gives a `describe` its words', () => {
  it('reads the words in quotes, or a passage’s name', () => {
    expect(written(read('text greeting').statement)).toBe('text greeting');
    expect(written(read('text "A lever, waist high."').statement)).toBe(
      'text "A lever, waist high."',
    );
    expect(read('text').said).toEqual([
      [
        'body.sprout:1:5',
        '`text` says something.',
        'Write the words in quotes, as in `text "A lever, waist high."`, or name a passage, as in `text greeting`.',
      ],
    ]);
  });
});

describe('words in quotes are held to the host’s cap on a literal line', () => {
  it('counts them as they mean, and keeps the statement', () => {
    const caps = { ...DEFAULT_LIMITS.caps, literalCharacters: 10 };
    expect(read('say "0123456\\"89"', caps).refusals).toEqual([]);
    for (const [text, word, lead] of [
      ['say "0123456789a"', 'say', 'say'],
      ['tell "0123456789a"', 'tell', 'tell'],
      ['tell self "0123456789a"', 'tell', 'tell self'],
      ['text "0123456789a"', 'text', 'text'],
    ] as const) {
      const long = read(text, caps);
      expect(
        long.refusals.map((d) => [d.message, d.remedy]),
        text,
      ).toEqual([
        [
          `This line is 11 characters long, and 10 is as long as a \`${word}\` in quotes may be.`,
          `Put the words in a passage, which has no length cap of its own, and say it by name, as in \`${lead} greeting\`.`,
        ],
      ]);
      expect(long.statement?.kind, text).toBe(word);
    }
  });

  it('holds `refuse` to it, and keeps the words', () => {
    const caps = { ...DEFAULT_LIMITS.caps, literalCharacters: 3 };
    const { p, diagnostics } = parserOver('refuse "No room here."', { name: 'body.sprout', caps });
    const keyword = p.next();
    expect(refusal(p, keyword, onItsOwn())).toMatchObject({
      kind: 'prose-literal',
      value: 'No room here.',
    });
    expect(diagnostics.refusals.map((d) => [locationOf(d.at), d.message, d.remedy])).toEqual([
      [
        'body.sprout:1:8',
        'This line is 13 characters long, and 3 is as long as a `refuse` in quotes may be.',
        'Put the words in a passage, which has no length cap of its own, and say it by name, as in `refuse greeting`.',
      ],
    ]);
  });

  it('holds `refuse` to it no more than to the cap: a line as long as the cap stands', () => {
    const caps = { ...DEFAULT_LIMITS.caps, literalCharacters: 13 };
    const { p, diagnostics } = parserOver('refuse "No room here." refuse full', {
      name: 'body.sprout',
      caps,
    });
    expect(refusal(p, p.next(), onItsOwn())).toMatchObject({ kind: 'prose-literal' });
    expect(refusal(p, p.next(), onItsOwn())).toMatchObject({ kind: 'ident', text: 'full' });
    expect(diagnostics.refusals).toEqual([]);
  });
});

/** A block read on its own: each statement it kept, written back, and what was said. */
function blockOf(text: string) {
  const { p, diagnostics } = parserOver(text, { name: 'body.sprout' });
  const kept = block(p, onItsOwn());
  return {
    kinds:
      kept?.statements.map((one) =>
        one.kind === 'tell' && one.to === null
          ? written(one).replace('tell ', 'tell place ')
          : written(one),
      ) ?? null,
    refusals: diagnostics.refusals,
  };
}

// --- generated input -------------------------------------------------------
//
// The speech readers' share of the parser's recovery rule: a well-formed
// `say`, `tell` or `text` is read whole and in silence; one with any
// single token taken out is refused exactly once, or reads as a shorter
// statement that is still well formed (`tell self greeting` without
// `self` is `tell greeting`), and never throws; and a refused one never
// takes the statement after it.

const WORDS = ['"The bolt slides back."', '"{actor} tags {self}."', 'taken', 'greeting'];
const TOLD = ['self', 'item', 'actor', 'kiln.shelf'];

function wellFormed(c: ReturnType<typeof chooser>): string {
  switch (c.below(4)) {
    case 0:
      return `say ${c.one(WORDS)}`;
    case 1:
      return `text ${c.one(WORDS)}`;
    case 2:
      return `tell ${c.one(WORDS)}`;
    default:
      return `tell ${c.one(TOLD)} ${c.one(WORDS)}`;
  }
}

function tokensOf(text: string): { start: number; end: number }[] {
  const lexer = new Lexer(new SourceFile('g.sprout', text), new Diagnostics());
  const out: { start: number; end: number }[] = [];
  for (let token = lexer.next(); token.kind !== 'end'; token = lexer.next()) {
    out.push({ start: token.at.start, end: token.at.end });
  }
  return out;
}

const FOLLOWING = [
  ['say "after"', 'say "after"'],
  ['move target to self', 'move'],
  ['send lamp :lit', 'send'],
  ['if (a) { self.set(:n, 1) }', 'if'],
  ['let n = 1', 'let'],
  ['self.set(:n, 1)', 'expression-statement'],
] as const;

describe('words for a reader never vanish silently, and never take what follows them', () => {
  it('over generated statements, whole and with any one token taken out', () => {
    const c = chooser(20_260_930);
    const reached = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const text = wellFormed(c);
      const whole = readStatement(text);
      expect(
        whole.refusals.map((d) => d.message),
        text,
      ).toEqual([]);
      expect(textOf(whole.statement!.at), text).toBe(text);
      reached.add(whole.statement!.kind);
      for (const dropped of tokensOf(text)) {
        const before = text.slice(0, dropped.start);
        const after = text.slice(dropped.end);
        const gap = `${before}${/\w$/.test(before) && /^\w/.test(after) ? ' ' : ''}${after}`;
        let gapped: ReturnType<typeof readStatement> | undefined;
        expect(() => {
          gapped = readStatement(gap);
        }, gap).not.toThrow();
        // The first word taken out leaves a bare name, an expression
        // standing as a statement, or words in quotes, which start none.
        const word = text.slice(dropped.start, dropped.end);
        if (['say', 'tell', 'text'].includes(word) && gapped!.refusals.length === 0) {
          reached.add('a reading');
          continue;
        }
        // Who is told, or the words, taken out of `tell x words` leaves a
        // `tell` that is whole: to the place, or with `x` as the passage.
        if (gapped!.refusals.length === 0 && gapped!.statement?.kind === 'tell') {
          reached.add('a shorter tell');
          continue;
        }
        expect(gapped!.refusals.length, `${gap}, from ${text}`).toBe(1);
      }
    }
    expect([...reached].sort()).toEqual(['a reading', 'a shorter tell', 'say', 'tell', 'text']);
  });

  it('keeps the statements either side of a defective one, and says one thing', () => {
    const c = chooser(30);
    const DEFECTIVE = ['say', 'tell', 'text', 'tell kiln.shelf', 'say 4', 'tell self 4', 'text 4'];
    for (let run = 0; run < 200; run++) {
      const [before, beforeKind] = c.one(FOLLOWING);
      const [after, afterKind] = c.one(FOLLOWING);
      const text = `{ ${before}\n  ${c.one(DEFECTIVE)}\n  ${after} }`;
      const { kinds, refusals } = blockOf(text);
      expect(refusals, text).toHaveLength(1);
      expect(kinds, text).toEqual([beforeKind, afterKind]);
    }
  });
});
