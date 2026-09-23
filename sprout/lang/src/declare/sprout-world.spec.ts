import { describe, expect, it } from 'vitest';

import type { KindExpr } from '../syntax/ast.js';
import { Diagnostics } from '../source/diagnostics.js';
import { parseDeclarations } from '../syntax/parse.js';
import { locationOf, SourceFile } from '../source/source.js';
import { refuseComposingWorld, WORLD, writesWorld } from './sprout-world.js';

/** The kinds a kind declaration composes, as written. */
function composed(text: string): readonly KindExpr[] {
  return parseDeclarations(new SourceFile('k.sprout', text), new Diagnostics()).flatMap((d) =>
    d.kind === 'kind' ? d.composes : [],
  );
}

describe('`sprout.World` is known by its library and its name, both written', () => {
  it('is named with its library', () => expect(WORLD).toBe('sprout.World'));

  it('is written only as `sprout.World`', () => {
    expect(
      composed('kind A is sprout.World, World, sprout.Worlds, other.World { }').map(writesWorld),
    ).toEqual([true, false, false, false]);
  });
});

describe('composing it anywhere but on a world is refused in one set of words', () => {
  it('refuses at the kind as written, naming what composed it and what to write instead', () => {
    const [world] = composed('kind Crate is sprout.World { }');
    const diagnostics = new Diagnostics();
    refuseComposingWorld('Crate', world!, diagnostics);
    expect(diagnostics.refusals.map((d) => [locationOf(d.at), d.message, d.remedy])).toEqual([
      [
        'k.sprout:1:15',
        '`Crate` composes `sprout.World`, which only a world may.',
        'Take it out of what `Crate` composes: it would make a thing into a world, and a bundle has one world, written `world <name> is sprout.World { … }`.',
      ],
    ]);
  });
});
