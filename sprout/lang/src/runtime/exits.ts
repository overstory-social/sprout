// The exits that apply where an actor stands (the spec's Verbs › Exits,
// An exit may be conditional, Links; The compiler › What absent means).
// Several exits may share a direction, and the first whose guard holds is
// the one that applies, so a direction gives at most one, and a link is
// one of its name; an exit that does not apply is not offered, not
// traversable and not mentioned. An exit that refuses applies as any exit
// does, deciding its direction, and is never offered: going that way is
// answered with its words, and nothing moves. An exit that leads may say
// words to whoever takes it, which the one taking it asks for as it goes.
//
// What does not apply, rather than faulting: an unset link; a guard that
// reads through a name out of the place's range, or to a declared object
// destroyed; and a destination that is absent, destroyed, gone or no
// longer a place. A guard only reads, and is charged to the turn's steps
// as any reading is, so a guard too dear to ask faults as any work does.

import type { Ident, ObjectPath } from '../syntax/ast.js';
import type { ProseLiteral } from '../syntax/ast-prose.js';
import type { Direction } from '../declare/directions.js';
import { libraryOf } from '../declare/enums.js';
import type { ResolvedExit } from '../declare/exits.js';
import type { Budget } from './budget.js';
import type { Catalogue } from './catalogue.js';
import { evaluateCondition } from './evaluate.js';
import type { InstanceId } from './ids.js';
import { isLive } from './live.js';
import { DestroyedReference, NameOutOfRange, objectNamed } from './named.js';
import type { Speech } from './body.js';
import type { AppliedWay, CommandExit } from './parser/exits.js';
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
 * The exits and links that lead somewhere from `place`: those of
 * `waysFrom` that do not refuse, which are what a visitor is offered.
 */
export function exitsFrom(place: InstanceId, context: ExitContext): CommandExit[] {
  return waysFrom(place, context).filter((way): way is CommandExit => 'to' in way);
}

/**
 * The exits and links that apply on `place`, one for each direction that
 * has one and each link set, in the order its kind answers them, an exit
 * that refuses among them; one step for each asked.
 */
export function waysFrom(place: InstanceId, context: ExitContext): AppliedWay[] {
  const instance = context.state.instance(place);
  if (instance === undefined) return [];
  return applying(instance, instance.kind.exits, context).map(({ way }) => way);
}

/** What an exit says as it is taken, and the place that says it, which is `self` as it renders. */
export interface Saying {
  readonly by: InstanceId;
  readonly said: Speech;
}

/**
 * What `way`, taken from `place`, says to whoever takes it; null where it
 * says nothing. The exits of its direction are asked again, a step for
 * each, only where one of them says something.
 */
export function sayingThrough(
  place: InstanceId,
  way: CommandExit,
  context: ExitContext,
): Saying | null {
  const instance = context.state.instance(place);
  const { direction } = way;
  if (instance === undefined || direction === null) return null;
  const run = instance.kind.exits.filter(
    (exit) => exit.kind === 'exit' && exit.direction === direction,
  );
  if (!run.some((exit) => exit.kind === 'exit' && exit.line.says !== null)) return null;
  const [taken] = applying(instance, run, context);
  if (taken === undefined || !('to' in taken.way)) return null;
  if (taken.way.to !== way.to || taken.way.label !== way.label) return null;
  const says = taken.exit.kind === 'exit' ? taken.exit.line.says : null;
  return says === null
    ? null
    : { by: place, said: spokenBy(says.said, taken.exit.origin, instance) };
}

/**
 * Which of `exits`, written on `place`, apply, each beside the way it
 * gives: the first in each direction whose guard holds and each link set;
 * one step for each asked.
 */
function applying(
  place: Instance,
  exits: readonly ResolvedExit[],
  context: ExitContext,
): { readonly way: AppliedWay; readonly exit: ResolvedExit }[] {
  const decided = new Set<Direction>();
  const applied: { readonly way: AppliedWay; readonly exit: ResolvedExit }[] = [];
  for (const exit of exits) {
    if (exit.kind === 'exit' && decided.has(exit.direction)) continue;
    context.budget.spend();
    if (exit.kind === 'exit' && exit.line.leads.kind === 'grammar-refusal') {
      if (!holds(exit, place, context)) continue;
      decided.add(exit.direction);
      const said = spokenBy(exit.line.leads.said, exit.origin, place);
      applied.push({
        way: {
          direction: exit.direction,
          label: exit.line.label.text,
          refuses: { by: place.id, said },
        },
        exit,
      });
      continue;
    }
    const to = destinationOf(exit, place, context);
    if (to === null) continue;
    const direction = exit.kind === 'exit' ? exit.direction : null;
    if (direction !== null) decided.add(direction);
    applied.push({ way: { direction, label: exit.line.label.text, to }, exit });
  }
  return applied;
}

/**
 * What an exit says, as `origin` wrote it: its words in quotes, or the
 * passage of that name as `place`'s kind has it, so a composer's own
 * line replaces its kind's.
 */
function spokenBy(said: ProseLiteral | Ident, origin: string, place: Instance): Speech {
  if (said.kind === 'prose-literal') {
    return { text: said.value, prose: said.prose, library: libraryOf(origin) };
  }
  const passage = place.kind.passages.get(said.text);
  return passage === undefined ? { absent: said.text } : { passage };
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
      : exit.line.leads.kind === 'path'
        ? pathEnd(exit.line.leads, place, context)
        : null;
  if (to === null || !isLive(state, to)) return null;
  if (state.instance(to)?.kind.containsActors !== true) return null;
  if (exit.kind === 'exit' && !holds(exit, place, context)) return null;
  return to;
}

/**
 * What an exit's destination names from `place`; null where it reaches
 * nothing now. It names its target by identifier, which a spawned place
 * has none of (the spec's Spawning), so only what has one answers.
 */
function pathEnd(path: ObjectPath, place: Instance, context: ExitContext): InstanceId | null {
  const named = context.catalogue.names.get(path);
  if (named === undefined) {
    throw new Error(
      "an exit's destination reached the runtime unresolved; the checker resolves it.",
    );
  }
  try {
    return objectNamed(named, context.state, place.id, 'identifiers');
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
