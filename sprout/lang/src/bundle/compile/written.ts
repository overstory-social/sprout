// What a composed kind's bodies write, for the warnings that ask what
// the bundle does rather than what one body means (the spec's The
// compiler › What it warns about): every body a kind runs, every
// statement in one, and every kind a body spawns. A statement inside an
// `if` or an `each` is written as surely as one outside it, so all are read.

import type { Block, SpawnStatement, Statement } from '../../syntax/ast.js';
import { statementsWithin } from '../../syntax/ast.js';
import { libraryOf } from '../../declare/enums.js';
import type { KindLookup, KindRef } from '../../declare/kinds.js';

/** A body a kind runs, with the kind that wrote it. */
export interface Body {
  readonly origin: string;
  readonly block: Block | null;
}

/** Every body a kind runs: its plays' `do`s, its handlers and its hooks. */
export function bodiesOf(kind: KindRef): Body[] {
  return [
    ...[...kind.plays.values()]
      .flat()
      .map((play) => ({ origin: play.origin, block: play.declaration.do })),
    ...[...kind.handlers.values()]
      .flat()
      .map((one) => ({ origin: one.origin, block: one.declaration.body })),
    ...[...kind.hooks.values()]
      .flat()
      .map((one) => ({ origin: one.origin, block: one.declaration.body })),
  ];
}

/** Every statement in `block`, however deep inside an `if` or an `each`, in the order written. */
export function statementsIn(block: Block | null): Statement[] {
  const found: Statement[] = [];
  const pending: Statement[] = [...(block?.statements ?? [])].reverse();
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    found.push(next);
    pending.push(...[...statementsWithin(next)].reverse());
  }
  return found;
}

/** A kind some body spawns, with the `spawn` that first names it. */
export interface Spawned {
  readonly kind: KindRef;
  readonly spawn: SpawnStatement;
}

/** Each kind a body of `kinds` spawns, once, in the order first spawned; one that did not resolve is left out. */
export function spawnedKinds(kinds: readonly KindRef[], lookup: KindLookup): Spawned[] {
  const found: Spawned[] = [];
  const seen = new Set<KindRef>();
  for (const kind of kinds) {
    for (const { origin, block } of bodiesOf(kind)) {
      for (const statement of statementsIn(block)) {
        const spawn =
          statement.kind === 'spawn'
            ? statement
            : statement.kind === 'let' && statement.value.kind === 'spawn'
              ? statement.value
              : null;
        if (spawn === null) continue;
        const written = spawn.spawned;
        const made =
          written.library === null
            ? lookup.unqualified(written.name.text, libraryOf(origin))
            : lookup.qualified(written.library.text, written.name.text);
        if (made === null || seen.has(made)) continue;
        seen.add(made);
        found.push({ kind: made, spawn });
      }
    }
  }
  return found;
}
