// What a composed kind's bodies write: every body it runs, every
// statement in one, and every kind a body spawns.

import { describe, expect, it } from 'vitest';

import type { KindDeclaration } from '../../syntax/ast.js';
import { Diagnostics } from '../../source/diagnostics.js';
import { parseDeclarations } from '../../syntax/parse.js';
import { SourceFile } from '../../source/source.js';
import { EnumTable } from '../../declare/enums.js';
import { KindTable } from '../../declare/kinds.js';
import { bodiesOf, spawnedKinds, statementsIn } from './written.js';

/** The kinds of `text`, composed in `shop`. */
function composed(text: string): KindTable {
  const setup = new Diagnostics();
  const declared = parseDeclarations(new SourceFile('shop.sprout', text), setup);
  const kinds = new KindTable();
  kinds.add(
    'shop',
    declared.filter((d): d is KindDeclaration => d.kind === 'kind'),
    setup,
  );
  kinds.resolve('shop', new EnumTable(), setup);
  expect(
    setup.refusals.map((d) => d.message),
    'the fixture composes',
  ).toEqual([]);
  return kinds;
}

const TEXT = `kind Bowl { }
kind Cup { }
kind Jug { }
kind Shelf {
  contains
  on :entered (item, from) {
    if (true) { spawn Cup in self } else if (false) { let jug = spawn Jug in self } else { spawn Cup in self }
    wake in 3 minutes
    each thing in self { spawn Bowl in self }
  }
  changed :full (was) { spawn Cup in self }
  :full false
}
kind Tall is Shelf { on :woke (elapsed) { } }`;

describe('what a kind’s bodies write', () => {
  it('reads every body a kind runs, the ones it composes included', () => {
    const tall = composed(TEXT).qualified('shop', 'Tall')!;
    expect(bodiesOf(tall).map((body) => body.origin)).toEqual([
      'shop.Shelf',
      'shop.Tall',
      'shop.Shelf',
    ]);
  });

  it('reads every statement of a body, however deep inside an `if` or an `each`, in the order written', () => {
    const shelf = composed(TEXT).qualified('shop', 'Shelf')!;
    const [stir] = bodiesOf(shelf);
    expect(statementsIn(stir!.block).map((statement) => statement.kind)).toEqual([
      'if',
      'spawn',
      'if',
      'let',
      'spawn',
      'wake',
      'each',
      'spawn',
    ]);
    expect(statementsIn(null)).toEqual([]);
  });

  it('finds each kind a body spawns once, first spawned first', () => {
    const kinds = composed(TEXT);
    expect(spawnedKinds(kinds.all(), kinds).map(({ kind }) => kind.name)).toEqual([
      'Cup',
      'Jug',
      'Bowl',
    ]);
  });
});
