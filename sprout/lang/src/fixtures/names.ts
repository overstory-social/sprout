// The world the name specs resolve identifiers in: a tree placed with what
// its kinds give, as a bundle places one, so that a name read from a
// declared object's body, a kind's, and a kind's content's can each be
// asked. `declare/names.spec.ts` and `check/names.spec.ts` share it.
// Spec support: the package build leaves it out.

import type { KindDeclaration, WorldDeclaration } from '../syntax/ast.js';
import { Diagnostics } from '../source/diagnostics.js';
import { SourceFile } from '../source/source.js';
import { parseDeclarations } from '../syntax/parse.js';
import { contentAt, resolveContents } from '../declare/contents.js';
import { EnumTable } from '../declare/enums.js';
import { KindTable } from '../declare/kinds.js';
import type { NameSource, Vantage } from '../declare/names.js';
import { resolveObjects } from '../declare/objects.js';
import { placeObjects } from '../declare/tree.js';

/**
 * `shop`: a hall holding a lamp, a bench holding a cushion, and a lantern
 * whose kind gives each lantern a wick holding a flame; a cellar beside
 * the hall; and a lamp directly in the world, which the hall's hides.
 */
export const SHOP_TEXT = `world shop is sprout.World {
  object hall is Room {
    object lamp is Thing
    object bench is Holder { object cushion is Thing }
    object lantern is Lantern
  }
  object cellar is Room
  object lamp is Thing
}
kind World { contains }
kind Room { contains actors }
kind Holder { contains }
kind Thing { }
kind Lantern {
  contains
  object wick is Wick { object flame is Thing }
}
kind Wick { contains }
`;

/** The tree and contents of `text`, in the library `shop`; anything refused throws. */
export function nameSource(text: string = SHOP_TEXT): NameSource & { kinds: KindTable } {
  const diagnostics = new Diagnostics();
  const declared = parseDeclarations(new SourceFile('shop.sprout', text), diagnostics);
  const kinds = new KindTable();
  const own = declared.filter((d): d is KindDeclaration => d.kind === 'kind');
  kinds.add('shop', own, diagnostics);
  const enums = new EnumTable();
  kinds.resolve('shop', enums, diagnostics);
  const contents = resolveContents(new Map([['shop', own]]), {
    enums,
    kinds,
    world: 'shop',
    diagnostics,
  });
  const root = declared.find((d): d is WorldDeclaration => d.kind === 'world');
  const composed = resolveObjects('shop', root, { enums, kinds, diagnostics }, contents);
  const tree = placeObjects(composed, { world: 'shop', diagnostics });
  if (diagnostics.refusals.length > 0) {
    throw new Error(diagnostics.refusals.map((d) => d.message).join('\n'));
  }
  return { tree, contents, kinds };
}

/**
 * The vantage of `giver`'s body, or of the content it writes at `path`,
 * with what the instance running it is made of; throws where either is
 * not in `source`.
 */
export function inKind(
  source: ReturnType<typeof nameSource>,
  giver: string,
  ...path: string[]
): Vantage {
  const dot = giver.lastIndexOf('.');
  const self =
    path.length === 0
      ? source.kinds.qualified(giver.slice(0, dot), giver.slice(dot + 1))
      : (contentAt(source.contents, giver, path)?.kind ?? null);
  if (self === null) throw new Error(`\`${giver}\` writes nothing at \`${path.join('.')}\`.`);
  return { in: 'kind', giver, path, self };
}
