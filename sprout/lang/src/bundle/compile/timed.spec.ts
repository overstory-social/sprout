// The warnings about `:tick` and `:woke` (the spec's What it warns
// about): an `on :tick` on an object that is not a place, a `wake`
// nothing answers, and an `on :woke` nothing asks for.

import { describe, expect, it } from 'vitest';

import type { Declaration } from '../../syntax/ast.js';
import { resolveDeclarations } from '../declarations.js';
import { STANDARD_LIBRARY } from '../standard-library.js';
import { Diagnostics } from '../../source/diagnostics.js';
import { parseDeclarations } from '../../syntax/parse.js';
import { locationOf, SourceFile } from '../../source/source.js';
import { warnUntimed } from './timed.js';
import { Report } from './report.js';

/** What the warnings say of the world `shop` written as `own`, and of a library `lib`, each as `line:column message`. */
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
  warnUntimed({
    kinds: [
      ...tables.kinds.all(),
      ...tables.composed.flatMap(({ kind, giver }) =>
        kind === null || giver !== null ? [] : [kind],
      ),
    ],
    lookup: tables.kinds,
    composed: tables.composed,
    tree: tables.tree,
    namespace: 'shop',
    diagnostics,
  });
  expect(diagnostics.refusals).toEqual([]);
  return diagnostics.all.map(
    (d) => `${locationOf(d.at).split(':').slice(1).join(':')} ${d.message}`,
  );
}

const WORLD = 'world shop is sprout.World { visitors arrive at hall object hall is sprout.Place {';
const VERB = 'verb poke { role target  "poke [target]" }';

describe('an `on :tick` on something that is not a place', () => {
  it('is warned about at the handler, naming the first declared object that runs it', () => {
    const text = `${WORLD}
  object cat is Cat
  object dog is Cat
} }
kind Cat { on :tick { } }`;
    expect(warned(text)).toEqual(['5:15 `hall.cat` is not a place, so `on :tick` never runs.']);
  });

  it('is warned about in an object’s own body, and names a spawned kind by what the spawn writes', () => {
    const text = `${WORLD}
  object cat is Thing { on :tick { } }
  object tin is Thing { as target for poke { do { let e = spawn Ember in self } } }
} }
kind Ember { on :tick (elapsed) { } }
kind Thing { contains }
${VERB}`;
    expect(warned(text)).toEqual([
      '2:28 `hall.cat` is not a place, so `on :tick` never runs.',
      '5:17 A spawned `Ember` is not a place, so `on :tick` never runs.',
    ]);
  });

  it('is quiet on a place, on a kind nothing is made of, and on a library’s handler', () => {
    const text = `${WORLD}
  object hut is Hut
  object cat is lib.Ticking
} }
kind Hut { contains actors  on :tick { } }
kind Unused { on :tick { } }`;
    expect(warned(text, 'kind Ticking { on :tick { } }')).toEqual([]);
  });
});

describe('a `wake` nothing answers', () => {
  it('is warned about at the `wake`, however deep inside an `if`', () => {
    const text = `${WORLD} object kiln is Kiln } }
kind Kiln { as target for poke { do { if (true) { } else { wake in 3 hours } } } }
${VERB}`;
    expect(warned(text)).toEqual([
      '2:60 Nothing here answers `:woke`, so this `wake` comes to nothing.',
    ]);
  });

  it('is quiet where a kind that runs it answers `:woke`, the composer bringing the other half', () => {
    const text = `${WORLD} object kiln is Kiln } }
kind Timer { as target for poke { do { wake in 3 hours } } }
kind Kiln is Timer { on :woke (elapsed) { } }
${VERB}`;
    expect(warned(text)).toEqual([]);
  });
});

describe('an `on :woke` nothing asks for', () => {
  it('is warned about at the handler', () => {
    const text = `${WORLD} object kiln is Kiln } }
kind Kiln { on :woke (elapsed) { } }`;
    expect(warned(text)).toEqual(['2:16 Nothing here asks to be woken, so `on :woke` never runs.']);
  });

  it('is quiet where a kind that runs it writes `wake` in any of its bodies, a hook included', () => {
    const text = `${WORLD} object kiln is Kiln } }
kind Waking { :lit true  changed :lit { wake in 1 minutes } }
kind Kiln is Waking { on :woke { } }`;
    expect(warned(text)).toEqual([]);
  });

  it('is quiet on a library’s handler', () => {
    expect(warned(`${WORLD} object kiln is lib.Kiln } }`, 'kind Kiln { on :woke { } }')).toEqual(
      [],
    );
  });
});
