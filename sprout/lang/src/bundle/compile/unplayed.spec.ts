// The warnings for a verb no object plays a role for, and a role in a
// verb nothing fills (the spec's What it warns about).

import { describe, expect, it } from 'vitest';

import type { Declaration } from '../../syntax/ast.js';
import { resolveDeclarations } from '../declarations.js';
import { STANDARD_LIBRARY } from '../standard-library.js';
import { Diagnostics } from '../../source/diagnostics.js';
import { parseDeclarations } from '../../syntax/parse.js';
import { locationOf, SourceFile } from '../../source/source.js';
import { warnUnplayed } from './unplayed.js';
import { spawnedKinds } from './written.js';
import { Report } from './report.js';

/** What the warnings say of the world `shop` written as `own`, and of a library `lib`, and which verbs they call unplayed. */
function warned(own: string, lib = ''): { said: string[]; unplayed: string[] } {
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
  const kinds = [
    ...tables.kinds.all(),
    ...tables.composed.flatMap(({ kind }) => (kind === null ? [] : [kind])),
  ];
  const diagnostics = new Diagnostics();
  const unplayed = warnUnplayed({
    takingPart: [
      ...new Set([
        ...tables.composed.flatMap(({ kind }) => (kind === null ? [] : [kind])),
        ...spawnedKinds(kinds, tables.kinds).map(({ kind }) => kind),
      ]),
    ],
    kinds,
    verbs: tables.verbs.all(),
    namespace: 'shop',
    diagnostics,
  });
  expect(diagnostics.refusals).toEqual([]);
  return {
    said: diagnostics.all.map((d) => `${locationOf(d.at)} ${d.message} ${d.remedy}`),
    unplayed: [...unplayed].map((verb) => verb.name),
  };
}

const WORLD = 'world shop is sprout.World { visitors arrive at hall object hall is sprout.Place {';
const PULL = 'verb pull { role target  "pull [target]" }';
const LEVER = 'kind Lever { as target for pull { do { say "It gives." } } }';

describe('a verb no object plays a role for', () => {
  it('is warned about at its name, with a part to write, and given back', () => {
    expect(warned(`${PULL}\n${WORLD} } }`)).toEqual({
      said: [
        'shop.sprout:1:6 Nothing in this world plays a part in `pull`, so typing it is answered with the world\'s `nothing_happens`. Give the kind of what it is done to a part, as in `as target for pull { do { say "…" } }`.',
      ],
      unplayed: ['pull'],
    });
  });

  it('says what `act` does of a verb with no phrases, and who plays a verb with no roles', () => {
    expect(warned(`verb creak { role target }\nverb purr { "purr" }\n${WORLD} } }`).said).toEqual([
      'shop.sprout:1:6 Nothing in this world plays a part in `creak`, so `act creak` does nothing. Give the kind of what it is done to a part, as in `as target for creak { do { say "…" } }`.',
      'shop.sprout:2:6 Nothing in this world plays a part in `purr`, so typing it is answered with the world\'s `nothing_happens`. Give the kind of whoever does it a part, as in `as actor for purr { do { say "…" } }` in a kind that composes `sprout.Actor`.',
    ]);
  });

  it('counts a kind that plays it only where something in the world is made of it', () => {
    // Declared, but nothing is a Lever: nothing takes part.
    expect(warned(`${PULL}\n${LEVER}\n${WORLD} } }`).unplayed).toEqual(['pull']);
    // A declared lever plays it.
    expect(warned(`${PULL}\n${LEVER}\n${WORLD} object lever is Lever } }`).said).toEqual([]);
    // So does a lever some body spawns.
    const spawning = 'kind Crate { contains  on :stir { spawn Lever in self } }\nmessage :stir';
    expect(
      warned(`${PULL}\n${LEVER}\n${spawning}\n${WORLD} object crate is Crate } }`).said,
    ).toEqual([]);
  });

  it('counts the actor’s part', () => {
    const hand = 'kind Hand is sprout.Actor { as actor for pull { do { say "Heave." } } }';
    expect(warned(`${PULL}\n${hand}\n${WORLD} object hand is Hand } }`).said).toEqual([]);
  });

  it('leaves a library’s verbs alone', () => {
    expect(warned(`${WORLD} } }`, PULL).said).toEqual([]);
  });
});

describe('a role in a verb nothing fills', () => {
  it('is warned about at its kind where nothing in the world is one', () => {
    const pry = 'verb pry { role target  role tool: Crowbar  "pry [target] with [tool]" }';
    const played = 'kind Lid { as target for pry { do { say "It gives." } } }';
    expect(
      warned(`${pry}\n${played}\nkind Crowbar { }\n${WORLD} object lid is Lid } }`).said,
    ).toEqual([
      "shop.sprout:1:36 Nothing in this world is a `Crowbar`, so nothing can be `pry`'s `tool`. Put one in a place, as in `object crowbar is Crowbar`, or `spawn Crowbar` where one should appear; or give `tool` a kind something here is made of.",
    ]);
    // One crowbar in the world fills it.
    expect(
      warned(
        `${pry}\n${played}\nkind Crowbar { }\n${WORLD} object lid is Lid  object bar is Crowbar } }`,
      ).said,
    ).toEqual([]);
  });

  it('warns at a value role no part narrows and no `act` names, and at nothing else', () => {
    const ask = 'verb quiz { role target  role topic: symbol  "quiz [target] about [topic]" }';
    const deaf = 'kind Guard { as target for quiz { do { say "Hm." } } }';
    expect(warned(`${ask}\n${deaf}\n${WORLD} object guard is Guard } }`).said).toEqual([
      'shop.sprout:1:31 Nothing that plays a part in `quiz` says which options `topic` takes, so it is never bound. Say it with `from` in the body of a part that hears it, as in `as target for quiz { topic from :<a list property> … }`.',
    ]);
    const hearing =
      'enum Topic { toll }\nkind Guard { :knows [Topic] default [toll]  as target for quiz { topic from :knows  do { say "Hm." } } }';
    expect(warned(`${ask}\n${hearing}\n${WORLD} object guard is Guard } }`).said).toEqual([]);
    // `mew` has no phrases and no part narrows `mood`: the `act` gives it.
    const acting = `enum Topic { toll }
verb mew { role target  role mood: symbol }
kind Guard is sprout.Actor {
  :knows [Topic] default [toll]
  as target for quiz { topic from :knows  do { if (bound topic) { act mew (target: actor, mood: topic) } } }
  as actor for mew { do { say "Mew." } }
}`;
    expect(warned(`${ask}\n${acting}\n${WORLD} object guard is Guard } }`).said).toEqual([]);
  });

  it('never warns at an open role, which any thing fills', () => {
    expect(warned(`${PULL}\n${LEVER}\n${WORLD} object lever is Lever } }`).said).toEqual([]);
  });
});
