import { describe, expect, it } from 'vitest';

import type { ConnectStatement } from '../ast.js';
import { writtenPath } from '../ast.js';
import { Diagnostics } from '../../source/diagnostics.js';
import { unspanned } from '../../source/nodes.js';
import { locationOf, SourceFile, textOf } from '../../source/source.js';
import { chooser, readStatement } from '../../fixtures/parse.js';
import { Lexer } from '../lexer.js';
import { connectStatement } from './connect.js';
import { DECLARATION_READERS } from './declarations.js';
import { Parser } from './parser.js';
import { block, onItsOwn } from './statements.js';

const said = (text: string) =>
  readStatement(text).refusals.map((d) => [locationOf(d.at), d.message, d.remedy]);

/** A block read on its own: the kinds of statement it kept, and what was said. */
function blockOf(text: string) {
  const diagnostics = new Diagnostics();
  const p = new Parser(new SourceFile('body.sprout', text), diagnostics, DECLARATION_READERS);
  const read = block(p, onItsOwn());
  return { kinds: read?.statements.map((one) => one.kind) ?? null, refusals: diagnostics.refusals };
}

describe('`connect`', () => {
  it('reads a link by its name and what it leads to', () => {
    for (const text of ['connect onward to cell', 'connect back to from', 'connect way_3 to a.b']) {
      const { statement, refusals } = readStatement(text);
      expect(refusals, text).toEqual([]);
      expect(unspanned(statement), text).toEqual([]);
      const read = statement as ConnectStatement;
      expect(`connect ${read.link.text} to ${writtenPath(read.destination)}`).toBe(text);
      expect(textOf(read.at)).toBe(text);
    }
  });

  it('is read by its own reader', () => {
    const diagnostics = new Diagnostics();
    const p = new Parser(
      new SourceFile('body.sprout', 'connect onward to cell'),
      diagnostics,
      DECLARATION_READERS,
    );
    expect(connectStatement(p)?.kind).toBe('connect');
    expect(diagnostics.refusals).toEqual([]);
  });

  it('refuses a link not named, a destination not given, and `to` left out', () => {
    expect(said('connect')).toEqual([
      [
        'body.sprout:1:8',
        '`connect` does not say which link it assigns.',
        "Name one of `self`'s links, and what it leads to, as in `connect onward to cell`.",
      ],
    ]);
    expect(said('connect Onward to cell')[0]!.slice(1)).toEqual([
      "`Onward` starts with a capital, and a link's name is written in lower case.",
      "Name one of `self`'s links, and what it leads to, as in `connect onward to cell`.",
    ]);
    expect(said('connect onward cell')).toEqual([
      [
        'body.sprout:1:15',
        '`connect onward` does not say where the link leads.',
        'Write `to` and the place: `connect onward to cell`.',
      ],
    ]);
    expect(said('connect onward to')).toEqual([
      [
        'body.sprout:1:18',
        'After `to` comes the place `onward` leads to.',
        'Name a binding that holds it, as in `connect onward to cell` after `let cell = spawn …`.',
      ],
    ]);
  });
});

// --- generated input -------------------------------------------------------
//
// The reader's share of the parser's recovery rule: a well-formed
// `connect` is read whole and in silence; one with any single token taken
// out is refused exactly once and never thrown; and a refused one never
// takes the statement after it.

const FOLLOWING = [
  ['say "after"', 'say'],
  ['move target to self', 'move'],
  ['connect onward to cell', 'connect'],
  ['if (a) { self.set(:n, 1) }', 'if'],
  ['let n = 1', 'let'],
] as const;

function tokensOf(text: string): { start: number; end: number }[] {
  const lexer = new Lexer(new SourceFile('g.sprout', text), new Diagnostics());
  const out: { start: number; end: number }[] = [];
  for (let token = lexer.next(); token.kind !== 'end'; token = lexer.next()) {
    out.push({ start: token.at.start, end: token.at.end });
  }
  return out;
}

describe('a `connect` never vanishes silently, and never takes what follows it', () => {
  it('over generated ones, whole and with any one token taken out', () => {
    const c = chooser(20_260_924);
    for (let i = 0; i < 200; i++) {
      const text = `connect ${c.one(['onward', 'back', 'way_3', 'deeper'])} to ${c.one(['cell', 'from', 'self', 'a.b'])}`;
      expect(readStatement(text).refusals, text).toEqual([]);
      for (const dropped of tokensOf(text)) {
        const word = text.slice(dropped.start, dropped.end);
        const gap = `${text.slice(0, dropped.start)}${text.slice(dropped.end)}`.replace(/ +/g, ' ');
        let read: ReturnType<typeof readStatement> | undefined;
        expect(() => {
          read = readStatement(gap);
        }, gap).not.toThrow();
        // The word taken out leaves a name standing as a statement: a reading, not a loss.
        if (word === 'connect') continue;
        // A path's dot or a step taken out leaves a shorter path.
        if (read!.refusals.length === 0 && (word === '.' || word === 'a' || word === 'b')) continue;
        expect(read!.refusals.length, `${gap}, from ${text}`).toBe(1);
      }
    }
  });

  it('keeps the statements either side of a defective one, and says one thing', () => {
    const c = chooser(28);
    const DEFECTIVE = [
      'connect',
      'connect onward',
      'connect onward to',
      'connect to cell',
      'connect 4',
    ];
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
