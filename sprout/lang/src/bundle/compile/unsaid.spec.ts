// The warning for a verb nobody speaks for (the spec's What it warns about).

import { describe, expect, it } from 'vitest';

import type { Declaration } from '../../syntax/ast.js';
import { resolveDeclarations } from '../declarations.js';
import { STANDARD_LIBRARY } from '../standard-library.js';
import { Diagnostics } from '../../source/diagnostics.js';
import { parseDeclarations } from '../../syntax/parse.js';
import { locationOf, SourceFile } from '../../source/source.js';
import { warnUnsaid } from './unsaid.js';
import { Report } from './report.js';

/** What the warning says of the world `shop` written as `own`, and of a library `lib`. */
function warned(own: string, lib = ''): string[] {
  const parsing = new Diagnostics();
  const byLibrary = new Map<string, Declaration[]>([
    ['shop', parseDeclarations(new SourceFile('world.sprout', own), parsing)],
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
  warnUnsaid({
    kinds: tables.kinds.all(),
    verbs: tables.verbs.all(),
    namespace: 'shop',
    diagnostics,
  });
  expect(diagnostics.refusals).toEqual([]);
  return diagnostics.all.map((d) => `${locationOf(d.at)} ${d.message} ${d.remedy}`);
}

const PULL = 'verb pull { role target  "pull [target]" }';

describe('a verb with phrases that nothing `say`s for', () => {
  it('is warned about at its name, with a play to write', () => {
    expect(
      warned(`${PULL}\nkind Lever { as target for pull { do { tell "It gives." } } }`),
    ).toEqual([
      'world.sprout:1:6 Nothing that takes part in `pull` ever `say`s anything, so typing it is answered with the world\'s `nothing_happens`. Say what happens in a role\'s `do`, as in `as target for pull { do { say "…" } }`.',
    ]);
  });

  it('is not warned about where any play says something, for any role, however deep', () => {
    expect(
      warned(`${PULL}\nkind Lever { as target for pull { do { if (true) { say "It gives." } } } }`),
    ).toEqual([]);
    expect(
      warned(
        `${PULL}\nkind Hand is sprout.Actor { as actor for pull { do { if (false) { } else { say "Heave." } } } }`,
      ),
    ).toEqual([]);
  });

  it('counts a `refuse` for nothing, since it is said only when the reading is refused', () => {
    expect(
      warned(`${PULL}\nkind Lever { as target for pull { permit { refuse "Stuck." } } }`),
    ).toHaveLength(1);
  });

  it('leaves a verb with no phrases, which only an NPC performs, and a library’s verbs alone', () => {
    expect(warned('verb purr { role target }')).toEqual([]);
    expect(warned('', PULL)).toEqual([]);
  });
});
