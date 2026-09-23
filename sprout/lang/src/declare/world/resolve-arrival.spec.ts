// `resolveArrival`: walks the path `arrivalOf` reads through the tree
// already placed, and finds a place directly in the world, deeper by a
// dotted path, or whatever a kind's own body says is one. A step that is
// not there is a gap for the caller; a step that is there but is not a
// place, or the world's own name written mid-path, is refused.

import { describe, expect, it } from 'vitest';

import { writtenPath, type KindDeclaration, type WorldDeclaration } from '../../syntax/ast.js';
import { KindTable } from '../kinds.js';
import { Diagnostics } from '../../source/diagnostics.js';
import { parseDeclarations } from '../../syntax/parse.js';
import { SourceFile, textOf } from '../../source/source.js';
import { objectsIn, resolveObjects } from '../objects.js';
import { placeObjects } from '../tree.js';
import { resolveArrival } from '../world.js';
import { ENUMS } from '../../fixtures/world.js';

describe('`resolveArrival` finds a place, read from the world’s body', () => {
  /** The world `shop` and its own files' kinds and objects, placed; the text must parse. */
  function arriving(text: string, libraries: Readonly<Record<string, string>> = {}) {
    const parsing = new Diagnostics();
    const declarations = parseDeclarations(new SourceFile('shop.sprout', text), parsing);
    expect(parsing.refusals.map((d) => d.message)).toEqual([]);
    const diagnostics = new Diagnostics();
    const kinds = new KindTable();
    for (const [library, source] of Object.entries(libraries)) {
      kinds.add(
        library,
        parseDeclarations(new SourceFile(`${library}.sprout`, source), parsing).filter(
          (d): d is KindDeclaration => d.kind === 'kind',
        ),
        diagnostics,
      );
    }
    kinds.add(
      'shop',
      declarations.filter((d): d is KindDeclaration => d.kind === 'kind'),
      diagnostics,
    );
    kinds.resolve('shop', ENUMS, diagnostics);
    const world = declarations.find((d): d is WorldDeclaration => d.kind === 'world')!;
    const objects = resolveObjects('shop', objectsIn(world), {
      enums: ENUMS,
      kinds,
      diagnostics,
    });
    const tree = placeObjects(objects, { world: 'shop', diagnostics });
    const before = diagnostics.all.length;
    const found = resolveArrival(world, { tree, objects, kinds, from: 'shop', diagnostics });
    const said = diagnostics.all.slice(before);
    return {
      found,
      said: said.map((d) => d.message),
      remedies: said.map((d) => d.remedy),
      where: said.map((d) => textOf(d.at)),
    };
  }

  const PLACES = `kind Room {
  contains actors
}
kind Bench {
  contains
}
`;

  it('finds a place directly in the world, by its path', () => {
    const { found, said } = arriving(`${PLACES}
world shop is sprout.World {
  visitors arrive at hall
  object hall is Room
}
`);
    expect(said).toEqual([]);
    expect(found).toEqual({ found: 'place', path: ['hall'] });
  });

  it('finds a place deeper in the tree by its dotted path', () => {
    const { found, said } = arriving(`${PLACES}
world shop is sprout.World {
  visitors arrive at hall.wardrobe
  object hall is Room {
    object wardrobe is Room
  }
}
`);
    expect(said).toEqual([]);
    expect(found).toEqual({ found: 'place', path: ['hall', 'wardrobe'] });
  });

  it('takes a place whose own body says `contains actors`', () => {
    const { found, said } = arriving(`${PLACES}
world shop is sprout.World {
  visitors arrive at bench
  object bench is Bench {
    contains actors
  }
}
`);
    expect(said).toEqual([]);
    expect(found).toEqual({ found: 'place', path: ['bench'] });
  });

  it('refuses something that is not a place, at the last step, in either mode', () => {
    const { found, said, remedies, where } = arriving(`${PLACES}
world shop is sprout.World {
  visitors arrive at hall.bench
  object hall is Room {
    object bench is Bench
  }
}
`);
    expect(found).toEqual({ found: 'refused' });
    expect(said).toEqual(['`bench` is not a place, and visitors arrive in one.']);
    expect(remedies).toEqual([
      'Name a place, or make `bench` one: compose `sprout.Place`, or write `contains actors` in its body.',
    ]);
    expect(where).toEqual(['bench']);
  });

  it('gives an unknown step to the caller as a gap, with the remedy written after `visitors arrive at`', () => {
    const { found, said } = arriving(`${PLACES}
world shop is sprout.World {
  visitors arrive at hal
  object hall is Room
}
`);
    // Nothing is said here: whether it refuses is the mode's.
    expect(said).toEqual([]);
    expect(found).toMatchObject({
      found: 'absent',
      message: 'Nothing here is called `hal`. Did you mean `hall`?',
      remedy: 'Write `visitors arrive at hall`, or declare an object called `hal`.',
      said: false,
    });
    if (found.found !== 'absent') return;
    expect(textOf(found.at)).toBe('hal');
    expect(writtenPath(found.path)).toBe('hal');
  });

  it('points at the deeper place of that name, written after `visitors arrive at`', () => {
    const { found } = arriving(`${PLACES}
world shop is sprout.World {
  visitors arrive at wardrobe
  object hall is Room {
    object wardrobe is Room
  }
}
`);
    expect(found).toMatchObject({
      found: 'absent',
      message: 'Nothing here is called `wardrobe`.',
      remedy: '`wardrobe` is inside `hall`, so write `visitors arrive at hall.wardrobe`.',
    });
  });

  it('calls a place absent, and already told, when its kind is absent', () => {
    const { found, said } = arriving(`world shop is sprout.World {
  visitors arrive at hall
  object hall is Nope
}
`);
    // What is said is the kind's, which is not `resolveArrival`'s to say.
    expect(said).toEqual([]);
    expect(found).toMatchObject({
      found: 'absent',
      message: '`hall` is absent, so visitors have nowhere to arrive.',
      said: true,
    });
  });

  it('calls a place absent, and already told, when it did not place', () => {
    // The second `hall` is refused as a second of one name in one body,
    // so the nook it holds is absent, and the step naming it is too.
    const { found } = arriving(`${PLACES}
world shop is sprout.World {
  visitors arrive at hall.nook
  object hall is Room
  object hall is Room {
    object nook is Room
  }
}
`);
    expect(found).toMatchObject({
      found: 'absent',
      message: '`hall.nook` is absent, so visitors have nowhere to arrive.',
      said: true,
    });
  });

  it('refuses the world’s name as a step of the path', () => {
    const { found, said, remedies } = arriving(`${PLACES}
world shop is sprout.World {
  visitors arrive at shop.hall
  object hall is Room
}
`);
    expect(found).toEqual({ found: 'refused' });
    expect(said).toEqual([
      '`shop` is the world, which is named on its own and never as a step of a path.',
    ]);
    expect(remedies).toEqual([
      'A path starts from something directly in the world: write `visitors arrive at hall`.',
    ]);
  });

  it('refuses what `arrivalOf` refuses, and says it once', () => {
    const { found, said } = arriving('world shop is sprout.World {\n  visitors are P\n}');
    expect(found).toEqual({ found: 'refused' });
    expect(said).toEqual(['`shop` does not say where a visitor arrives.']);
  });
});
