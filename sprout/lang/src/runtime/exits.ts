// The exits that apply where an actor stands (the spec's Verbs › Exits,
// An exit may be conditional, Links; The compiler › What absent means).
// Several exits may share a direction, and the first whose guard holds is
// the one that applies, so a direction gives at most one, and a link is
// one of its name; an exit that does not apply is not offered, not
// traversable and not mentioned.
//
// What does not apply, rather than faulting: an unset link; a guard that
// reads through a name out of the place's range, or to a declared object
// destroyed; and a destination that is absent, destroyed, gone or no
// longer a place. A guard only reads, and is charged to the turn's steps
// as any reading is, so a guard too dear to ask faults as any work does.

import type { ObjectPath } from '../syntax/ast.js';
import type { Direction } from '../declare/directions.js';
import { libraryOf } from '../declare/enums.js';
import type { ResolvedExit } from '../declare/exits.js';
import type { Budget } from './budget.js';
import type { Catalogue } from './catalogue.js';
import { evaluateCondition } from './evaluate.js';
import type { InstanceId } from './ids.js';
import { isLive } from './live.js';
import { DestroyedReference, NameOutOfRange, objectNamed } from './named.js';
import type { CommandExit } from './parser/exits.js';
import type { PassRule } from './range.js';
import type { Instance, StateReader } from './state.js';

/** What asking a place's exits reads: the turn's state, the bundle, its meter and pass rules. */
export interface ExitContext {
  readonly state: StateReader;
  readonly catalogue: Catalogue;
  readonly budget: Budget;
  readonly passes: PassRule<InstanceId>;
}

/**
 * The exits and links that apply on `place`, one for each direction that
 * has one and each link set, in the order its kind answers them; one step
 * for each asked.
 */
export function exitsFrom(place: InstanceId, context: ExitContext): CommandExit[] {
  const instance = context.state.instance(place);
  if (instance === undefined) return [];
  const decided = new Set<Direction>();
  const applying: CommandExit[] = [];
  for (const exit of instance.kind.exits) {
    if (exit.kind === 'exit' && decided.has(exit.direction)) continue;
    context.budget.spend();
    const to = destinationOf(exit, instance, context);
    if (to === null) continue;
    const direction = exit.kind === 'exit' ? exit.direction : null;
    if (direction !== null) decided.add(direction);
    applying.push({ direction, label: exit.line.label.text, to });
  }
  return applying;
}

/** Where `exit` leads from `place` now, or null where it does not apply. */
function destinationOf(
  exit: ResolvedExit,
  place: Instance,
  context: ExitContext,
): InstanceId | null {
  const { state } = context;
  const to =
    exit.kind === 'link'
      ? (place.links.get(exit.name) ?? null)
      : pathEnd(exit.line.destination, place, context);
  if (to === null || !isLive(state, to)) return null;
  if (state.instance(to)?.kind.containsActors !== true) return null;
  if (exit.kind === 'exit' && !holds(exit, place, context)) return null;
  return to;
}

/** What an exit's destination names from `place`; null where it reaches nothing now. */
function pathEnd(path: ObjectPath, place: Instance, context: ExitContext): InstanceId | null {
  const named = context.catalogue.names.get(path);
  if (named === undefined) {
    throw new Error(
      "an exit's destination reached the runtime unresolved; the checker resolves it.",
    );
  }
  try {
    return objectNamed(named, context.state, place.id);
  } catch (thrown) {
    if (thrown instanceof DestroyedReference) return null;
    throw thrown;
  }
}

/** Whether an exit's `when` holds, asked of `place`; a read out of its range, or of a destroyed name, does not. */
function holds(
  exit: Extract<ResolvedExit, { readonly kind: 'exit' }>,
  place: Instance,
  context: ExitContext,
): boolean {
  const { line } = exit;
  if (line.when === null) return true;
  try {
    return evaluateCondition(line.when, {
      state: context.state,
      kinds: context.catalogue.lookup,
      library: libraryOf(exit.origin),
      self: place.id,
      bindings: new Map(),
      budget: context.budget,
      caps: context.catalogue.caps,
      names: context.catalogue.names,
      passes: context.passes,
    });
  } catch (thrown) {
    if (thrown instanceof NameOutOfRange || thrown instanceof DestroyedReference) return false;
    throw thrown;
  }
}
