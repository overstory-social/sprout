// What a capacity measures by (the spec's Containment is a declaration;
// What it refuses): an integer property some kind declares, an integer
// wherever one does, judged once at the line that writes it.

import { describe, expect, it } from 'vitest';

import type { Declaration } from '../../syntax/ast.js';
import { resolveDeclarations } from '../declarations.js';
import { STANDARD_LIBRARY } from '../standard-library.js';
import { Diagnostics } from '../../source/diagnostics.js';
import { parseDeclarations } from '../../syntax/parse.js';
import { locationOf, SourceFile } from '../../source/source.js';
import { checkMeasures } from './measured.js';
import { Report } from './report.js';

/** What `checkMeasures` refuses of the kinds `own` declares, each as `line:column message`. */
function refused(own: string): string[] {
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
  checkMeasures(
    [
      ...tables.kinds.all(),
      ...tables.composed.flatMap(({ kind }) => (kind === null ? [] : [kind])),
    ],
    diagnostics,
  );
  return diagnostics.refusals.map(
    (d) => `${locationOf(d.at).split(':').slice(1).join(':')} ${d.message}`,
  );
}

const SACK = 'kind Sack is sprout.Container {\n  capacity 20 by :size\n}\n';

describe('the property a capacity measures by', () => {
  it('is allowed where an integer property of that name is declared, on any kind', () => {
    expect(refused(`${SACK}kind Brick { :size 3 }\nkind Feather { }\n`)).toEqual([]);
  });

  it('is refused where nothing declares it, at the property as written', () => {
    expect(refused(SACK)).toEqual([
      '2:18 Nothing declares `:size`, so nothing could be measured by it.',
    ]);
  });

  it('is not declared by a remembered entry, which is held per actor and measures nothing', () => {
    expect(refused(`${SACK}kind Brick { remembers { :size 0 } }\n`)).toEqual([
      '2:18 Nothing declares `:size`, so nothing could be measured by it.',
    ]);
  });

  it('is refused where any kind declares it as other than an integer, naming that kind', () => {
    expect(refused(`${SACK}kind Brick { :size 3 }\nkind Scroll { :size "long" }\n`)).toEqual([
      '2:18 `:size` holds string in `Scroll`, and a capacity measures by a whole number.',
    ]);
  });

  it('is judged once, however many kinds take the capacity by composing it', () => {
    expect(refused(`${SACK}kind Pouch is Sack { }\nkind Purse is Sack { }\n`)).toEqual([
      '2:18 Nothing declares `:size`, so nothing could be measured by it.',
    ]);
  });
});
