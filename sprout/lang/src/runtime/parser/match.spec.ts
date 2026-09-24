import { describe, expect, it } from 'vitest';

import { typedWords } from '../../declare/addressing.js';
import { slotSpans } from './match.js';
import type { TypedPart } from './phrases.js';

/** A phrase as parts: words in the text, `[n]` a slot for role `n`. */
function parts(phrase: string): TypedPart[] {
  return phrase.split(/(\[\d\])/).flatMap((piece): TypedPart[] => {
    const slot = /^\[(\d)\]$/.exec(piece);
    if (slot !== null) return [{ slot: Number(slot[1]) }];
    const words = typedWords(piece);
    return words.length === 0 ? [] : [{ words }];
  });
}

/** Every placement, each slot as the words it takes. */
function placed(phrase: string, line: string): string[][] {
  const words = typedWords(line);
  return [...slotSpans(parts(phrase), words)].map((spans) =>
    spans.map((span) => `${span.role}:${words.slice(span.start, span.end).join(' ')}`),
  );
}

describe('where a phrase’s slots fall', () => {
  it('between the phrase’s words, which must stand where they are written', () => {
    expect(placed('unlock [0] with [1]', 'unlock oak door with brass key')).toEqual([
      ['0:oak door', '1:brass key'],
    ]);
    expect(placed('use [1] on [0]', 'use key on door')).toEqual([['1:key', '0:door']]);
    expect(placed('unlock [0] with [1]', 'open door with key')).toEqual([]);
    expect(placed('look', 'look')).toEqual([[]]);
    expect(placed('look', 'look around')).toEqual([]);
  });

  it('each taking at least one word', () => {
    expect(placed('take [0]', 'take')).toEqual([]);
    expect(placed('unlock [0] with [1]', 'unlock with key')).toEqual([]);
  });

  it('by position where the words do not pin them, the longer run tried first', () => {
    expect(placed('ask [0] [1]', 'ask old guard toll')).toEqual([
      ['0:old guard', '1:toll'],
      ['0:old', '1:guard toll'],
    ]);
    expect(placed('put [0] in [1]', 'put coin in in box')).toEqual([
      ['0:coin in', '1:box'],
      ['0:coin', '1:in box'],
    ]);
  });

  it('with no placement at all for a line the phrase cannot cover', () => {
    expect(placed('[0]', '')).toEqual([]);
    expect(placed('go [0]', 'go')).toEqual([]);
  });
});
