// The import lines a world's files need, worked out from what each writes.

import { describe, expect, it } from 'vitest';

import { SourceFile } from '../source/source.js';
import { STANDARD_LIBRARY } from './standard-library.js';
import { neededImports } from './needed-imports.js';

/** A single quote, as an import's specifier is written between them. */
const Q = "'";

const needed = (files: Record<string, string>) =>
  Object.fromEntries(
    neededImports(
      Object.entries(files).map(([name, text]) => new SourceFile(name, text)),
      [STANDARD_LIBRARY],
    ),
  );

describe('the imports a file needs', () => {
  it('brings a name another file declares from that file, and a library’s from the library', () => {
    expect(
      needed({
        'shop.sprout': 'world shop is sprout.World {\n  visitors are Creature\n}\n',
        'creature.sprout': 'kind Creature is Visitor { }\n',
      }),
    ).toEqual({
      'shop.sprout': [
        `import * as sprout from ${Q}sprout${Q}`,
        `import {Creature} from ${Q}creature${Q}`,
      ],
      'creature.sprout': [`import {Visitor} from ${Q}sprout${Q}`],
    });
  });

  it('brings a verb and a message a file names, but not an engine message', () => {
    expect(
      needed({
        'bell.sprout':
          'kind Bell {\n  on :ring { tell "Hum." }\n  on :tick (elapsed) { tell "Tick." }\n  as target for strike { do { say "Dong." } }\n}\n',
        'verbs.sprout': 'message :ring\nverb strike { role target  "strike [target]" }\n',
      }),
    ).toEqual({ 'bell.sprout': [`import {:ring, strike} from ${Q}verbs${Q}`] });
  });

  it('leaves out what a file declares, imports already, or nothing declares', () => {
    expect(
      needed({
        'lamp.sprout': `import {Fixture} from ${Q}sprout${Q}\n\nkind Lamp is Fixture { :glow Glow default dim }\nenum Glow { dim, bright }\nkind Wick is Nowhere { }\n`,
        'lamp.prose': 'passage glow { It glows. }\n',
      }),
    ).toEqual({});
  });
});
