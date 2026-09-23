// The warning for destroying a declared object (the spec's The world
// model › Destroying; The compiler › What it warns about). A declared
// object destroyed is gone for good, and destroying is meant for what was
// spawned, so a `destroy self` that a declared object runs is warned
// about at the `destroy`: in its own body, or in a kind it is made of,
// directly or through composition, what a kind gives it included.
//
// A `destroy` is warned about once, naming the first declared object in
// declared order that runs it; one that no declared object runs, because
// none composes its kind or each leaves the play out with `without`, is
// not. A body that may destroy is a play's `do`, a handler or a hook.

import type { Block, DestroyStatement, Statement } from '../../syntax/ast.js';
import type { Diagnostics } from '../../source/diagnostics.js';
import { kindName, type KindRef } from '../../declare/kinds.js';
import type { ComposedObject } from '../../declare/objects.js';
import type { ObjectTree } from '../../declare/tree.js';

/** Warn at each `destroy self` a declared object in `composed` runs, as `tree` places them. */
export function warnDestroyingDeclared(
  composed: readonly ComposedObject[],
  tree: ObjectTree,
  diagnostics: Diagnostics,
): void {
  const warned = new Set<DestroyStatement>();
  for (const object of composed) {
    const placement = tree.placements.get(object);
    if (object.kind === null || placement === undefined) continue;
    const path = `\`${placement.path.join('.')}\``;
    const own = kindName(object.kind);
    for (const { origin, body } of acting(object.kind)) {
      for (const destroy of destroysIn(body)) {
        if (warned.has(destroy)) continue;
        warned.add(destroy);
        const made = origin === own ? '' : ` is made of \`${shown(origin)}\` and`;
        diagnostics.warn(
          destroy.at,
          `${path}${made} is declared in the world, so once it is destroyed it never comes back.`,
          'Destroying is meant for what was spawned. To have something come and go, `spawn` it when it should appear; to keep this one, change one of its properties instead.',
        );
      }
    }
  }
}

/** Every body a kind runs that may destroy, with the kind that wrote it, in run order. */
function acting(kind: KindRef): { readonly origin: string; readonly body: Block | null }[] {
  return [
    ...[...kind.plays.values()]
      .flat()
      .map((play) => ({ origin: play.origin, body: play.declaration.do })),
    ...[...kind.handlers.values()]
      .flat()
      .map((one) => ({ origin: one.origin, body: one.declaration.body })),
    ...[...kind.hooks.values()]
      .flat()
      .map((one) => ({ origin: one.origin, body: one.declaration.body })),
  ];
}

/** Every `destroy` in `block`, however deep inside an `if`, in the order written. */
function destroysIn(block: Block | null): DestroyStatement[] {
  const found: DestroyStatement[] = [];
  const pending: Statement[] = [...(block?.statements ?? [])].reverse();
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (next.kind === 'destroy') found.push(next);
    if (next.kind !== 'if') continue;
    const otherwise =
      next.otherwise === null
        ? []
        : next.otherwise.kind === 'if'
          ? [next.otherwise]
          : next.otherwise.statements;
    pending.push(...[...next.then.statements, ...otherwise].reverse());
  }
  return found;
}

/** A kind as the warning names it: its own name, as an author most often writes it. */
function shown(qualified: string): string {
  return qualified.slice(qualified.lastIndexOf('.') + 1);
}
