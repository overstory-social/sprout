import { describe, expect, it } from 'vitest';

import { locationOf, textOf } from '../../source/source.js';
import { readWith as over, rest } from '../../fixtures/readers.js';
import type { Parser } from './parser.js';
import { destroyStatement, finallyStatement } from './destroy.js';

/** One reader, run over a string on its own. */
const readWith = <T>(read: (p: Parser) => T, text: string) =>
  over(read, text, { name: 'body.sprout' });

describe('`destroy self` is the only form', () => {
  it('reads it, spanning both words', () => {
    const { read, refusals } = readWith(destroyStatement, 'destroy   self');
    expect(refusals).toEqual([]);
    expect(read!.kind).toBe('destroy');
    expect(textOf(read!.at)).toBe('destroy   self');
  });

  it('says what is missing when nothing follows', () => {
    const { read, refusals } = readWith(destroyStatement, 'destroy');
    expect(read).toBeNull();
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
      const { read, refusals } = readWith(destroyStatement, text);
      expect(read, text).toBeNull();
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

describe('`finally destroy self` waits for the queue to empty', () => {
  it('is a `destroy` marked `finally`, spanning both words', () => {
    const { read, refusals, p } = readWith(finallyStatement, 'finally destroy self\nsay "Bye."');
    expect(refusals).toEqual([]);
    expect(read).toMatchObject({ kind: 'destroy', finally: true });
    expect(textOf(read!.at)).toBe('finally destroy self');
    expect(rest(p)).toBe('say "Bye."');
    expect(readWith(destroyStatement, 'destroy self').read).toMatchObject({ finally: false });
  });

  it('refuses anything but `destroy self` after `finally`', () => {
    for (const [text, at] of [
      ['finally', 'body.sprout:1:8'],
      ['finally say "Bye."', 'body.sprout:1:9'],
    ] as const) {
      const { refusals } = readWith(finallyStatement, text);
      expect(
        refusals.map((d) => [locationOf(d.at), d.message, d.remedy]),
        text,
      ).toEqual([
        [
          at,
          'Only `destroy self` may follow `finally`.',
          'Write `finally destroy self`, which destroys the object once every message the turn has sent has been handled.',
        ],
      ]);
    }
    expect(
      readWith(finallyStatement, 'finally destroy lamp').refusals.map((d) => d.message),
    ).toEqual(['`destroy` removes only the object whose body runs it.']);
  });
});
