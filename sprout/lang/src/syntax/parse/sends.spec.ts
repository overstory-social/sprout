import { describe, expect, it } from 'vitest';

import type { BroadcastStatement, SendStatement } from '../ast.js';
import { writtenPath } from '../ast.js';
import { Diagnostics } from '../../source/diagnostics.js';
import { unspanned } from '../../source/nodes.js';
import { locationOf, SourceFile, textOf } from '../../source/source.js';
import { chooser, readStatement, shape } from '../../fixtures/parse.js';
import { Lexer } from '../lexer.js';
import { DECLARATION_READERS } from './declarations.js';
import { Parser } from './parser.js';
import { broadcastStatement, sendStatement } from './sends.js';
import { block, onItsOwn } from './statements.js';

/** A send or a broadcast as the parser holds it, written back. */
function written(statement: SendStatement | BroadcastStatement): string {
  const value = statement.value === null ? '' : ` with ${shape(statement.value)}`;
  return statement.kind === 'send'
    ? `send ${writtenPath(statement.target)} :${statement.message.text}${value}`
    : `broadcast :${statement.message.text}${value}`;
}

const said = (text: string) =>
  readStatement(text).refusals.map((d) => [locationOf(d.at), d.message, d.remedy]);

/** A block read on its own: the kinds of statement it kept, and what was said. */
function blockOf(text: string) {
  const diagnostics = new Diagnostics();
  const p = new Parser(new SourceFile('body.sprout', text), diagnostics, DECLARATION_READERS);
  const read = block(p, onItsOwn());
  return { kinds: read?.statements.map((one) => one.kind) ?? null, refusals: diagnostics.refusals };
}

describe('`send` and `broadcast`', () => {
  it('read the spec’s own three, and a send down a dotted path', () => {
    for (const [text, form] of [
      ['send oak_door :unlock_attempt', 'send oak_door :unlock_attempt'],
      ['send from :unlock_failed with 2', 'send from :unlock_failed with 2'],
      ['broadcast :illuminating with true', 'broadcast :illuminating with true'],
      ['send kiln.shelf :fired', 'send kiln.shelf :fired'],
      ['broadcast :gust', 'broadcast :gust'],
    ] as const) {
      const { statement, refusals } = readStatement(text);
      expect(refusals, text).toEqual([]);
      expect(unspanned(statement), text).toEqual([]);
      expect(written(statement as SendStatement | BroadcastStatement), text).toBe(form);
      expect(textOf(statement!.at), text).toBe(text);
    }
  });

  it('are read by their own readers', () => {
    const diagnostics = new Diagnostics();
    const p = new Parser(
      new SourceFile('body.sprout', 'send lamp :lit with self.get(:on) broadcast :rang'),
      diagnostics,
      DECLARATION_READERS,
    );
    const send = sendStatement(p);
    const broadcast = broadcastStatement(p);
    expect(diagnostics.refusals).toEqual([]);
    expect(written(send!)).toBe('send lamp :lit with self.get(:on)');
    expect(written(broadcast!)).toBe('broadcast :rang');
  });

  it('refuse a send to nothing, and a message without its colon', () => {
    expect(said('send')).toEqual([
      [
        'body.sprout:1:5',
        '`send` does not say what to send the message to.',
        'Write the thing and the message, as in `send oak_door :unlock_attempt`.',
      ],
    ]);
    expect(said('send Door :knock')).toEqual([
      [
        'body.sprout:1:6',
        '`Door` starts with a capital, so it is not the name of anything here.',
        'Write the thing and the message, as in `send oak_door :unlock_attempt`.',
      ],
    ]);
    expect(said('send door knock')).toEqual([
      [
        'body.sprout:1:11',
        '`send door` does not say which message.',
        'A message is written with its colon: `send door :knock`.',
      ],
    ]);
    expect(said('broadcast')).toEqual([
      [
        'body.sprout:1:10',
        '`broadcast` does not say which message.',
        'Write the message with its colon, as in `broadcast :unlock_attempt`.',
      ],
    ]);
  });

  it('refuse a `with` that gives nothing', () => {
    expect(said('broadcast :lit with')).toEqual([
      [
        'body.sprout:1:20',
        '`with` is followed by the value `broadcast :lit` carries.',
        'Write the value after it, as in `broadcast :lit with true`.',
      ],
    ]);
  });
});

// --- generated input -------------------------------------------------------
//
// The send readers' share of the parser's recovery rule: a well-formed
// send is read whole and in silence; one with any single token taken out
// is refused exactly once and never thrown; and a refused one never takes
// the statement after it.

const TARGETS = ['self', 'from', 'lamp', 'kiln.shelf', 'shop.hall.lamp'];
const VALUES = ['true', '2', 'self.get(:lit)', 'n + 1'];

function wellFormed(c: ReturnType<typeof chooser>): string {
  const value = c.below(2) === 0 ? '' : ` with ${c.one(VALUES)}`;
  return c.below(2) === 0
    ? `send ${c.one(TARGETS)} :${c.one(['lit', 'rang', 'unlock_attempt'])}${value}`
    : `broadcast :${c.one(['gust', 'illuminating'])}${value}`;
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
  ['say "after"', 'say'],
  ['move target to self', 'move'],
  ['send lamp :lit', 'send'],
  ['if (a) { self.set(:n, 1) }', 'if'],
  ['let n = 1', 'let'],
] as const;

describe('a send never vanishes silently, and never takes what follows it', () => {
  it('over generated sends, whole and with any one token taken out', () => {
    const c = chooser(20_260_926);
    const reached = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const text = wellFormed(c);
      const whole = readStatement(text);
      expect(
        whole.refusals.map((d) => d.message),
        text,
      ).toEqual([]);
      reached.add(whole.statement!.kind);
      for (const dropped of tokensOf(text)) {
        const before = text.slice(0, dropped.start);
        const after = text.slice(dropped.end);
        const gap = `${before}${/\w$/.test(before) && /^\w/.test(after) ? ' ' : ''}${after}`;
        let read: ReturnType<typeof readStatement> | undefined;
        expect(() => {
          read = readStatement(gap);
        }, gap).not.toThrow();
        const word = text.slice(dropped.start, dropped.end);
        // The word itself taken out leaves a bare name or a symbol, which
        // is an expression standing as a statement or no statement: a
        // reading, not a loss. `with` taken out leaves its value after
        // the message, which is the next thing written.
        if (word === 'send' || word === 'broadcast' || word === 'with') continue;
        // A value's own tokens taken out leave a shorter value, or none.
        if (read!.refusals.length === 0) {
          reached.add('a shorter value');
          continue;
        }
        expect(read!.refusals.length, `${gap}, from ${text}`).toBe(1);
      }
    }
    expect([...reached].sort()).toEqual(['a shorter value', 'broadcast', 'send']);
  });

  it('keeps the statements either side of a defective one, and says one thing', () => {
    const c = chooser(27);
    const DEFECTIVE = [
      'send',
      'send lamp',
      'send lamp lit',
      'broadcast',
      'broadcast lit',
      'broadcast :lit with',
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
