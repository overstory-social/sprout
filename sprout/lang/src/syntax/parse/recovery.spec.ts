// What `recovery.ts` itself exports, exercised directly with small,
// hand-written cases. `recovery/*.spec.ts` runs the invariant these
// functions exist for — a well-formed neighbour is never lost — over
// hand-picked and generated input; this file is the mechanics: what each
// function leaves the cursor on, and what it reports back.

import { describe, expect, it } from 'vitest';

import { parserOver as over } from '../../fixtures/readers.js';
import {
  closedBracketRun,
  closesAhead,
  recover,
  recoverInBraces,
  separator,
  skipBracketed,
  stepPast,
} from './recovery.js';

/** A parser over some text, for calling a recovery function directly. */
const parserOver = (text: string) => over(text, { name: 'r.sprout' });

describe('separator', () => {
  it('reads the end of the file as `end`', () => {
    const { p } = parserOver('');
    expect(separator(p, ']')).toBe('end');
  });

  it('reads the closing punctuation as `end`, without consuming it', () => {
    const { p } = parserOver(']');
    expect(separator(p, ']')).toBe('end');
    expect(p.at('punct', ']')).toBe(true);
  });

  it('consumes a comma and reads it as `comma`', () => {
    const { p } = parserOver(', b');
    expect(separator(p, ']')).toBe('comma');
    expect(p.at('name', 'b')).toBe(true);
  });

  it('reads a character the lexer already refused as `gap`, without consuming anything', () => {
    const { p, diagnostics } = parserOver('% b');
    expect(separator(p, ']')).toBe('gap');
    expect(diagnostics.refusals).toHaveLength(1);
    expect(p.at('name', 'b')).toBe(true);
  });

  it('reads anything else as `missing`, without consuming it', () => {
    const { p } = parserOver('b');
    expect(separator(p, ']')).toBe('missing');
    expect(p.at('name', 'b')).toBe(true);
  });
});

describe('recover', () => {
  it('steps past whatever is not a declaration and stops right before one', () => {
    const { p } = parserOver('a b enum X');
    recover(p);
    expect(p.at('name', 'enum')).toBe(true);
  });

  it('steps to the end when no declaration follows', () => {
    const { p } = parserOver('a b c');
    recover(p);
    expect(p.done).toBe(true);
  });
});

describe('recoverInBraces', () => {
  it('finds the closing brace and reports it found one', () => {
    const { p } = parserOver('a b }');
    expect(recoverInBraces(p)).toBe(true);
    expect(p.done).toBe(true);
  });

  it('steps over a brace nested inside without mistaking it for the close', () => {
    const { p } = parserOver('a { b } c }');
    expect(recoverInBraces(p)).toBe(true);
    expect(p.done).toBe(true);
  });

  it('reports false when the file runs out first', () => {
    const { p } = parserOver('a b');
    expect(recoverInBraces(p)).toBe(false);
    expect(p.done).toBe(true);
  });

  it('stops at a word that starts a declaration, at the body’s own depth', () => {
    const { p } = parserOver('a enum X');
    expect(recoverInBraces(p)).toBe(false);
    expect(p.at('name', 'enum')).toBe(true);
  });
});

describe('closedBracketRun', () => {
  it('counts the tokens a bracket spans through its own close', () => {
    const { p } = parserOver('[a, b] c');
    expect(closedBracketRun(p)).toBe(5);
    // A probe, not a step: the cursor has not moved.
    expect(p.at('punct', '[')).toBe(true);
  });

  it('counts through brackets nested inside', () => {
    const { p } = parserOver('[[a] b] c');
    expect(closedBracketRun(p)).toBe(6);
  });

  it('reports 0, and remembers it, when the file runs out first', () => {
    const { p } = parserOver('[a');
    expect(closedBracketRun(p)).toBe(0);
    // Asked again from the same start, the answer comes from the cache
    // rather than a second walk to the end of the file.
    expect(closedBracketRun(p)).toBe(0);
  });

  it('reports 0 when a brace stands before the bracket closes', () => {
    const { p } = parserOver('[a { b');
    expect(closedBracketRun(p)).toBe(0);
  });
});

describe('closesAhead', () => {
  it('says yes when a `]` at the bracket’s own depth stands ahead, whatever is in the way', () => {
    for (const text of ['oak, silver]', ':a, silver]', 'oak } silver]', '[oak], silver]']) {
      const { p } = parserOver(text);
      expect(closesAhead(p), text).toBe(true);
    }
  });

  it('says no when only nested closers stand ahead, or nothing does', () => {
    for (const text of ['oak, [silver]', 'oak :b 1 }', '']) {
      const { p } = parserOver(text);
      expect(closesAhead(p), text).toBe(false);
    }
  });

  it('looks no further than the next declaration, whose `]` is its own', () => {
    const { p } = parserOver('oak\nenum Ward { a }\n:x [1]]');
    expect(closesAhead(p)).toBe(false);
  });

  it('consumes nothing', () => {
    const { p } = parserOver('oak, silver]');
    closesAhead(p);
    expect(p.peek().text).toBe('oak');
  });
});

describe('stepPast', () => {
  it('steps over one token that is not a bracket', () => {
    const { p } = parserOver('a b');
    stepPast(p);
    expect(p.at('name', 'b')).toBe(true);
  });

  it('steps over a whole bracket run that closes', () => {
    const { p } = parserOver('[a, b] c');
    stepPast(p);
    expect(p.at('name', 'c')).toBe(true);
  });

  it('steps over just the open bracket when it never closes', () => {
    const { p } = parserOver('[a b');
    stepPast(p);
    expect(p.at('name', 'a')).toBe(true);
  });
});

describe('skipBracketed', () => {
  it('steps past a construct whose opener is already taken, leaving its closer behind it', () => {
    const { p } = parserOver('a, b] c');
    skipBracketed(p, ']');
    expect(p.at('name', 'c')).toBe(true);
  });

  it('counts a bracket nested inside rather than closing on it', () => {
    const { p } = parserOver('[a] b] c');
    skipBracketed(p, ']');
    expect(p.at('name', 'c')).toBe(true);
  });

  it('takes nothing when the construct was never closed', () => {
    const { p } = parserOver('a b');
    skipBracketed(p, ']');
    expect(p.at('name', 'a')).toBe(true);
  });
});
