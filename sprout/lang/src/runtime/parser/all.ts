// `all` and `except` in a slot (the spec's Parsing › Sequences, again and
// all): `take all`, `take all except the bronze key and the lamp`. `all`
// fills a role with everything in reach it may take: a role of a kind
// takes what composes it; an open role that some kind plays takes what
// plays a part in the verb; and an open role only the actor plays, as
// `take`'s target, takes every thing that is not a person and not the
// actor's own place. `except` leaves out each thing a noun after it names,
// and every thing of a kind it names. A set role takes them all at once,
// and a role that takes one thing takes each in turn, in the order the
// range walk reached them; either way no more than a set role may bind.

import { isActor } from '../../declare/actors.js';
import { DETERMINERS, humanisedKind } from '../../declare/addressing.js';
import { playsOf } from '../../declare/roles.js';
import type { KindRef } from '../../declare/kinds.js';
import type { ResolvedRole, ResolvedVerb } from '../../declare/verbs.js';
import type { Budget } from '../budget.js';
import type { InstanceId } from '../ids.js';
import type { Instance } from '../state.js';
import type { Filled } from './fill.js';
import { fits, nounsOfRun, thingsIn, type Candidate, type NounContext } from './nouns.js';

/** What `all` reads: what the actor can reach, who they are and where, and every kind there is. */
export interface AllContext extends NounContext {
  readonly candidates: readonly Candidate[];
  readonly actor: InstanceId;
  readonly here: InstanceId;
  readonly kinds: Iterable<KindRef>;
}

/**
 * What `words` fill `role` of `verb` with where they are `all`, alone or
 * with `except` and what it leaves out: null where they do not begin with
 * `all`, or the role takes a value or a way out, so the slot is read as
 * any other.
 */
export function allIn(
  words: readonly string[],
  role: ResolvedRole,
  verb: ResolvedVerb,
  context: AllContext,
): Filled | null {
  const fills = role.filler?.fills;
  if (words[0] !== 'all' || !(fills === 'open' || fills === 'kind')) return null;
  let literal = 1;
  const left = new Set<InstanceId>();
  if (words.length > 1) {
    if (words[1] !== 'except' || words.length === 2) return { fills: 'unfit', things: [] };
    literal += 1;
    const named = words.slice(2);
    for (const { start, end } of nounsOfRun(named)) {
      const noun = named.slice(start, end);
      if (noun.length === 0) return { fills: 'unfit', things: [] };
      const out = leftOut(noun, context);
      if (out.length === 0) return { fills: 'nothing', start: 2 + start, end: 2 + end };
      for (const id of out) left.add(id);
      literal += noun.length;
    }
  }
  const actorOnly = onlyTheActorPlays(verb, role, context.kinds, context.budget);
  const taken = context.candidates
    .filter(({ instance, carried }) => {
      context.budget.spend();
      if (left.has(instance.id) || instance.id === context.actor || instance.id === context.here) {
        return false;
      }
      if (role.carried && !carried) return false;
      return takes(role, verb, instance, actorOnly);
    })
    .slice(0, context.budget.limits.setRoleObjects);
  if (taken.length === 0) return { fills: 'nothing', start: 0, end: words.length };
  if (role.many) {
    return {
      fills: 'options',
      options: [
        {
          bound: { set: taken.map(({ instance }) => instance.id) },
          near: taken.reduce((sum, one) => sum + one.near, 0),
          literal,
        },
      ],
    };
  }
  return {
    fills: 'all',
    things: taken.map(({ instance, near }) => ({ bound: { object: instance.id }, near, literal })),
  };
}

/** Whether `all` takes `thing` for `role`: as the role's kind says, or as the verb's plays do. */
function takes(
  role: ResolvedRole,
  verb: ResolvedVerb,
  thing: Instance,
  actorOnly: boolean,
): boolean {
  if (role.filler?.fills === 'kind') return fits(role, thing);
  if (actorOnly) return !isActor(thing.kind);
  return verb.roles.some(
    (one) => playsOf(thing.kind.plays, verb.library, verb.name, one.name).length > 0,
  );
}

/**
 * Whether only the actor plays a part in `role` of `verb`: no kind there
 * is plays it, each kind a step. `all` never fills such a role with the
 * actor's own place, nor does an offer where the actor's part moves it.
 */
export function onlyTheActorPlays(
  verb: ResolvedVerb,
  role: ResolvedRole,
  kinds: Iterable<KindRef>,
  budget: Budget,
): boolean {
  for (const kind of kinds) {
    budget.spend();
    if (playsOf(kind.plays, verb.library, verb.name, role.name).length > 0) return false;
  }
  return true;
}

/** What a noun after `except` leaves out: every thing it names, and every thing of a kind it names, each thing a step. */
function leftOut(noun: readonly string[], context: AllContext): InstanceId[] {
  const named = thingsIn(noun, () => true, context.candidates, context);
  const out = new Set(named.found === 'nothing' ? [] : named.things.map((one) => one.id));
  const bare = noun.length > 1 && DETERMINERS.includes(noun[0]!) ? noun.slice(1) : noun;
  const written = bare.join(' ');
  for (const { instance } of context.candidates) {
    context.budget.spend();
    for (const kind of instance.kind.composes) {
      if (humanisedKind(kind.slice(kind.lastIndexOf('.') + 1)) === written) out.add(instance.id);
    }
  }
  return [...out];
}
