import { describe, expect, it } from 'vitest';

import { unspanned } from '../../source/nodes.js';
import { locationOf, textOf } from '../../source/source.js';
import { parserOver } from '../../fixtures/readers.js';
import { objectPath } from './paths.js';

/** Read a path from the start of `text`, and what comes after it. */
function path(text: string) {
  const { p, diagnostics } = parserOver(text, { name: 'p.sprout' });
  const read = objectPath(p, p.next());
  return {
    read,
    parts: read?.parts.map((part) => part.text) ?? null,
    next: p.peek().text,
    said: diagnostics.refusals.map((d) => [locationOf(d.at), d.message, d.remedy] as const),
  };
}

describe('a path to an object', () => {
  it('is one name, spanning it', () => {
    const { read, parts, next, said } = path('composing_room {');
    expect(said).toEqual([]);
    expect(read!.kind).toBe('path');
    expect(parts).toEqual(['composing_room']);
    expect(textOf(read!.at)).toBe('composing_room');
    expect(next).toBe('{');
  });

  it('is a name and each `.name` after it, spanning all of them, each step its own node', () => {
    const { read, parts, next, said } = path('kiln.shelf.box\nobject x is K');
    expect(said).toEqual([]);
    expect(parts).toEqual(['kiln', 'shelf', 'box']);
    expect(textOf(read!.at)).toBe('kiln.shelf.box');
    expect(read!.parts.map((part) => locationOf(part.at))).toEqual([
      'p.sprout:1:1',
      'p.sprout:1:6',
      'p.sprout:1:12',
    ]);
    expect(unspanned(read)).toEqual([]);
    expect(next).toBe('object');
  });

  it('takes any lower-case word as a step, a word of the language included', () => {
    expect(path('house.in').parts).toEqual(['house', 'in']);
  });
});

describe('a path written wrong is refused at the step it is about', () => {
  const after = 'After a dot comes the name of what is inside the thing before it';

  it('ends in a dot, at the end of the file or before a brace', () => {
    for (const text of ['kiln.', 'kiln. {', 'kiln.\n{']) {
      const { read, said } = path(text);
      expect(read, text).toBeNull();
      expect(said, text).toEqual([
        [
          'p.sprout:1:5',
          'This path ends in a dot.',
          `${after}, as in \`kiln.shelf\`; or take the dot out.`,
        ],
      ]);
    }
  });

  it('ends in a dot before the next declaration or the next line, which are left to be read', () => {
    for (const [text, word] of [
      ['kiln.\nobject shelf is K', 'object'],
      ['kiln.\n  visitors are P', 'visitors'],
      ['kiln.\n  shelf', 'shelf'],
    ] as const) {
      const { said, next } = path(text);
      expect(
        said.map(([at, message]) => [at, message]),
        text,
      ).toEqual([['p.sprout:1:5', 'This path ends in a dot.']]);
      expect(next, text).toBe(word);
    }
  });

  it('has two dots in a row, said once, and the step after them still read', () => {
    const { read, said, next } = path('kiln..shelf {');
    expect(read).toBeNull();
    expect(said).toEqual([
      [
        'p.sprout:1:6',
        'Two dots in a row leave a name out.',
        'Write one name between each pair of dots, as in `kiln.shelf`.',
      ],
    ]);
    expect(next).toBe('{');
  });

  it('has a number for a step', () => {
    const { read, said, next } = path('kiln.4 {');
    expect(read).toBeNull();
    expect(said).toEqual([
      [
        'p.sprout:1:6',
        '`4` is a number, not the name of anything in `kiln`.',
        `${after}, in lower case, as in \`kiln.shelf\`.`,
      ],
    ]);
    expect(next).toBe('{');
  });

  it('has a capitalised step', () => {
    const { said } = path('kiln.shelf.Box');
    expect(said.map(([at, message]) => [at, message])).toEqual([
      [
        'p.sprout:1:12',
        '`Box` starts with a capital, so it is not the name of anything in `kiln.shelf`.',
      ],
    ]);
  });

  it('has a space on either side of a dot', () => {
    for (const [text, at] of [
      ['kiln . shelf', 'p.sprout:1:1'],
      ['kiln .shelf', 'p.sprout:1:1'],
      ['kiln. shelf', 'p.sprout:1:1'],
    ] as const) {
      const { read, said } = path(text);
      expect(read, text).toBeNull();
      expect(said, text).toEqual([
        [at, 'A path is written without spaces around its dots.', 'Write `kiln.shelf`.'],
      ]);
    }
  });
});
