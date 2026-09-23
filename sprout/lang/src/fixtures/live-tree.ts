// What the range specs read a declared world through: a `LiveTree` over
// the tree as declared, ids built by `declaredId` as stored state builds
// them (`shop.kiln.shelf`), and a pass rule standing where B32's
// evaluated ones will. Spec support: the package build leaves it out.

import type { KindDeclaration, ObjectDeclaration } from '../syntax/ast.js';
import type { LiveTree, PassRule } from '../runtime/range.js';
import { declaredId } from '../runtime/ids.js';
import { Diagnostics } from '../source/diagnostics.js';
import { EnumTable } from '../declare/enums.js';
import { KindTable } from '../declare/kinds.js';
import { resolveObjects } from '../declare/objects.js';
import { parseDeclarations } from '../syntax/parse.js';
import { placeObjects, type ObjectTree, type Placement } from '../declare/tree.js';
import { SourceFile } from '../source/source.js';
import { WORLD_PASSES_ANYTHING } from '../declare/world.js';

/**
 * Place the kinds and objects in `text` in the world `world`. A kind
 * nothing declares leaves its object absent; anything else wrong throws,
 * since a fixture that does not declare cleanly proves nothing.
 */
export function declaredTree(world: string, text: string): ObjectTree {
  const diagnostics = new Diagnostics();
  const declared = parseDeclarations(new SourceFile(`${world}.sprout`, text), diagnostics);
  const kinds = new KindTable();
  kinds.add(
    world,
    declared.filter((d): d is KindDeclaration => d.kind === 'kind'),
    diagnostics,
  );
  const enums = new EnumTable();
  kinds.resolve(world, enums, diagnostics);
  const composed = resolveObjects(
    world,
    declared.filter((d): d is ObjectDeclaration => d.kind === 'object'),
    { enums, kinds, diagnostics, onUnknown: () => {} },
  );
  const tree = placeObjects(composed, { world, diagnostics });
  if (diagnostics.refusals.length > 0) {
    throw new Error(diagnostics.refusals.map((refusal) => refusal.message).join('\n'));
  }
  return tree;
}

/**
 * The declared tree as a live one. An object whose kind is absent is
 * left out, and so is everything under it: not in range, not listed.
 */
export function liveTreeOf(tree: ObjectTree): LiveTree<string> {
  const contents = new Map<string, string[]>([[tree.world, []]]);
  const containers = new Map<string, string | null>([[tree.world, null]]);
  const queue: [string, ReadonlyMap<string, Placement>][] = [[tree.world, tree.holds]];
  for (let head = 0; head < queue.length; head++) {
    const [holder, holds] = queue[head]!;
    for (const placement of holds.values()) {
      if (placement.kind === null) continue;
      const id = declaredId(tree.world, placement.path);
      contents.get(holder)!.push(id);
      contents.set(id, []);
      containers.set(id, holder);
      queue.push([id, placement.holds]);
    }
  }
  return {
    contents: (node) => contents.get(node) ?? [],
    containerOf: (node) => containers.get(node) ?? null,
  };
}

/** The world refuses, as its unwritten rule does; the ids in `shut` refuse; everything else relays. */
export function passRuleOf(tree: ObjectTree, shut: Iterable<string> = []): PassRule<string> {
  const closed = new Set(shut);
  return (container) => (container === tree.world ? WORLD_PASSES_ANYTHING : !closed.has(container));
}
