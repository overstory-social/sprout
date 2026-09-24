// The warning for a `destroy self` a declared object runs (the spec's
// Destroying; What it warns about), said at the `destroy`.

import { describe, expect, it } from 'vitest';

import type { Declaration } from '../../syntax/ast.js';
import { resolveDeclarations } from '../declarations.js';
import { STANDARD_LIBRARY } from '../standard-library.js';
import { Diagnostics, type Diagnostic } from '../../source/diagnostics.js';
import { parseDeclarations } from '../../syntax/parse.js';
import { locationOf, SourceFile } from '../../source/source.js';
import { warnDestroyingDeclared } from './destroyed.js';
import { Report } from './report.js';

/** What the warning says of the world `shop` written as `own`. */
function said(own: string): readonly Diagnostic[] {
  const parsing = new Diagnostics();
  const byLibrary = new Map<string, Declaration[]>([
    ['shop', parseDeclarations(new SourceFile('shop.sprout', own), parsing)],
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
  warnDestroyingDeclared(tables.composed, tables.tree, diagnostics);
  return diagnostics.all;
}

/** The same, each as `line:column message`. */
const warned = (own: string): string[] =>
  said(own).map((d) => `${locationOf(d.at).split(':').slice(1).join(':')} ${d.message}`);

const WORLD = 'world shop is sprout.World { visitors arrive at hall object hall is sprout.Place {';
const VERB = 'verb snuff { role target  "snuff [target]" }\nkind Thing { }';
const REMEDY =
  'Destroying is meant for what was spawned. To have something come and go, `spawn` it when it should appear; to keep this one, change one of its properties instead.';

describe('a declared object that destroys itself is warned about at the `destroy`', () => {
  it('in its own body, naming it by its path', () => {
    const text = `${WORLD}
  object lamp is Thing { as target for snuff { do { destroy self } } }
} }
${VERB}`;
    expect(warned(text)).toEqual([
      '2:53 `hall.lamp` is declared in the world, so once it is destroyed it never comes back.',
    ]);
  });

  it('in a handler or a hook, as in a play', () => {
    const text = `${WORLD}
  object lamp is Thing { :lit true  on :snuffed { destroy self }  changed :lit { destroy self } }
} }
${VERB}
message :snuffed`;
    expect(warned(text)).toEqual([
      '2:51 `hall.lamp` is declared in the world, so once it is destroyed it never comes back.',
      '2:82 `hall.lamp` is declared in the world, so once it is destroyed it never comes back.',
    ]);
  });

  it('in a kind it is made of, directly or through composition, naming the kind', () => {
    const text = `${WORLD}
  object lamp is Lantern
} }
${VERB}
kind Candle { as target for snuff { do { if (true) { destroy self } } } }
kind Lantern is Candle { }`;
    expect(warned(text)).toEqual([
      '6:54 `hall.lamp` is made of `Candle` and is declared in the world, so once it is destroyed it never comes back.',
    ]);
  });

  it('inside an `each`, as inside an `if`', () => {
    const text = `${WORLD}
  object lamp is Candle
} }
${VERB}
kind Candle { contains  as target for snuff { do { each thing in self { destroy self } } } }`;
    expect(warned(text)).toEqual([
      '6:73 `hall.lamp` is made of `Candle` and is declared in the world, so once it is destroyed it never comes back.',
    ]);
  });

  it('in a kind that gives a declared object a copy, naming the copy', () => {
    const text = `${WORLD}
  object lamp is Lantern
} }
${VERB}
kind Lantern { contains object wick is Thing { as target for snuff { do { destroy self } } } }`;
    expect(warned(text)).toEqual([
      '6:75 `hall.lamp.wick` is declared in the world, so once it is destroyed it never comes back.',
    ]);
  });

  it('once per `destroy`, naming the first declared object that runs it', () => {
    const text = `${WORLD}
  object candle is Candle
  object taper is Candle
} }
${VERB}
kind Candle { as target for snuff { do { destroy self } } }`;
    expect(warned(text)).toEqual([
      '7:42 `hall.candle` is made of `Candle` and is declared in the world, so once it is destroyed it never comes back.',
    ]);
  });

  it('not for a kind only spawns are made of, nor one every declared object leaves the play out of', () => {
    const text = `${WORLD}
  object lamp is Candle { without as target for snuff from Candle }
} }
${VERB}
kind Candle { as target for snuff { do { destroy self } } }
kind Spark { as target for snuff { do { destroy self } } }`;
    expect(warned(text)).toEqual([]);
  });
});

describe('what the warning tells an author to do instead', () => {
  it('is a warning, saying destroying is for what was spawned, and what to write', () => {
    const text = `${WORLD} object lamp is Thing { as target for snuff { do { destroy self } } } } }\n${VERB}`;
    expect(said(text).map((d) => [d.severity, d.remedy])).toEqual([['warning', REMEDY]]);
  });
});
