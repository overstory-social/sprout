import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { isReserved, RESERVED_WORDS } from './reserved.js';

const SPEC = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../docs/design/sprout-design-spec.md',
);

/**
 * The spec's own sentence under The compiler › Lexical rules, read as
 * the list of words it puts in code marks. The set is checked against
 * the spec rather than against a second copy of the list, because a
 * second copy is the thing that drifts.
 */
function reservedInSpec(): string[] {
  const line = readFileSync(SPEC, 'utf8')
    .split('\n')
    .find((l) => l.startsWith('- The reserved words are'));
  if (line === undefined) throw new Error('the spec no longer states the reserved words');
  return [...line.matchAll(/`([a-z]+)`/g)].map((m) => m[1]!);
}

describe('the reserved words are the spec’s, exactly', () => {
  const inSpec = reservedInSpec();

  it('found the sentence, and it lists a great many words', () => {
    expect(inSpec.length).toBeGreaterThan(60);
  });

  it('holds every word the spec lists', () => {
    expect([...new Set(inSpec)].filter((word) => !RESERVED_WORDS.has(word))).toEqual([]);
  });

  it('holds nothing the spec does not list', () => {
    expect([...RESERVED_WORDS].filter((word) => !inSpec.includes(word))).toEqual([]);
  });

  it('keeps the spec’s order, with each word written once', () => {
    expect([...RESERVED_WORDS]).toEqual([...new Set(inSpec)]);
  });
});

describe('asking whether a word is the language’s own', () => {
  it('says so for a type name, a literal and a word of the syntax', () => {
    expect(isReserved('string')).toBe(true);
    expect(isReserved('false')).toBe(true);
    expect(isReserved('default')).toBe(true);
  });

  it('says no for an ordinary word an author would write', () => {
    expect(isReserved('oak')).toBe(false);
    expect(isReserved('touch_dry')).toBe(false);
    expect(isReserved('the_press')).toBe(false);
  });

  it('is about the whole word, not a word that starts with one', () => {
    expect(isReserved('default_glaze')).toBe(false);
    expect(isReserved('Default')).toBe(false);
  });
});
