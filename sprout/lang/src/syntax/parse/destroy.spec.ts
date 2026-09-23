import { describe, expect, it } from 'vitest';

import { Diagnostics } from '../../source/diagnostics.js';
import { locationOf, SourceFile, textOf } from '../../source/source.js';
import { readStatement } from '../../fixtures/parse.js';
import { DECLARATION_READERS } from './declarations.js';
import { Parser } from './parser.js';
import { destroyStatement, finallyStatement } from './destroy.js';

/** One reader, run over a string on its own. */
function readWith<T>(read: (p: Parser) => T, text: string) {
  const diagnostics = new Diagnostics();
  const p = new Parser(new SourceFile('body.sprout', text), diagnostics, DECLARATION_READERS);
  return { read: read(p), refusals: diagnostics.refusals, p };
}

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

describe('`finally destroy self` waits for the queue to empty', () => {
  it('is a `destroy` marked `finally`, spanning both words', () => {
    const { statement, refusals } = readStatement('finally destroy self');
    expect(refusals).toEqual([]);
    expect(statement).toMatchObject({ kind: 'destroy', finally: true });
    expect(textOf(statement!.at)).toBe('finally destroy self');
    expect(readStatement('destroy self').statement).toMatchObject({ finally: false });
  });

  it('is read by its own reader, directly', () => {
    const diagnostics = new Diagnostics();
    const p = new Parser(
      new SourceFile('body.sprout', 'finally destroy self'),
      diagnostics,
      DECLARATION_READERS,
    );
    expect(finallyStatement(p)).toMatchObject({ kind: 'destroy', finally: true });
    expect(diagnostics.refusals).toEqual([]);
  });

  it('refuses anything but `destroy self` after `finally`', () => {
    for (const [text, at] of [
      ['finally', 'body.sprout:1:8'],
      ['finally say "Bye."', 'body.sprout:1:9'],
    ] as const) {
      const { refusals } = readStatement(text);
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
    expect(readStatement('finally destroy lamp').refusals.map((d) => d.message)).toEqual([
      '`destroy` removes only the object whose body runs it.',
    ]);
  });
});
