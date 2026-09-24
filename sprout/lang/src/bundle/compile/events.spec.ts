// The two warnings about messages: a handler nothing sends to, and a
// message nothing handles (the spec's What it warns about).

import { describe, expect, it } from 'vitest';

import type { Declaration } from '../../syntax/ast.js';
import { resolveDeclarations } from '../declarations.js';
import { STANDARD_LIBRARY } from '../standard-library.js';
import { Diagnostics } from '../../source/diagnostics.js';
import { parseDeclarations } from '../../syntax/parse.js';
import { locationOf, SourceFile } from '../../source/source.js';
import { warnUnsentAndUnhandled } from './events.js';
import { Report } from './report.js';

/** What the warnings say of the world `shop` written as `own`, and of a library `lib`. */
function warned(own: string, lib = ''): string[] {
  const parsing = new Diagnostics();
  const byLibrary = new Map<string, Declaration[]>([
    ['shop', parseDeclarations(new SourceFile('shop.sprout', own), parsing)],
    ['lib', parseDeclarations(new SourceFile('lib.sprout', lib), parsing)],
    ['sprout', STANDARD_LIBRARY.files.flatMap((file) => parseDeclarations(file, parsing))],
  ]);
  expect(
    parsing.refusals.map((d) => d.message),
    'the fixture parses',
  ).toEqual([]);
  const report = new Report('publish', new SourceFile('sprout.json', '').span(0, 0));
  const tables = resolveDeclarations(byLibrary, { namespace: 'shop', name: 'shop' }, report);
  expect(
    report.diagnostics.refusals.map((d) => d.message),
    'the fixture resolves',
  ).toEqual([]);
  const diagnostics = new Diagnostics();
  warnUnsentAndUnhandled({
    kinds: tables.kinds.all(),
    messages: tables.messages,
    namespace: 'shop',
    diagnostics,
  });
  expect(diagnostics.refusals).toEqual([]);
  return diagnostics.all.map((d) => `${locationOf(d.at)} ${d.message} ${d.remedy}`);
}

describe('a message nothing handles, and a handler nothing sends to', () => {
  it('are each warned about, at the declaration and at the handler', () => {
    expect(
      warned('message :stir\nmessage :creak\nkind Cat { on :stir { send self :creak } }'),
    ).toEqual([
      'shop.sprout:3:15 Nothing sends `:stir`, so `on :stir` never runs. Send it with `send <thing> :stir` or `broadcast :stir`, or take the handler out.',
      'shop.sprout:2:9 Nothing handles `:creak`, so sending it does nothing. Write `on :creak { … }` in the kind that should hear it, or take the message out.',
    ]);
  });

  it('are quiet where a body anywhere sends it and a kind anywhere answers it', () => {
    expect(
      warned(
        'message :stir\nkind Cat { on :stir { } }\nkind Room { contains on :entered (item, from) { if (true) { broadcast :stir } } }',
      ),
    ).toEqual([]);
  });

  it('never warn about the engine’s messages, which the engine sends', () => {
    expect(warned('kind Room { contains on :entered (item, from) { } on :tick { } }')).toEqual([]);
  });

  it('warn only of the world’s own, not of a library’s', () => {
    expect(warned('kind Cat { }', 'message :stir\nkind Dog { on :stir { } }')).toEqual([]);
  });
});
