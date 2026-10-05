// What the engine answers a command and says of each arrival (the spec's
// Verbs › Engine verbs; Movement and consent › After the move; Chance ›
// The forms: a description is derived after the turn that moved the
// visitor). A person who moved between places, by `go` or by any `move`,
// reads the place they arrived in, derived once the queue is empty and
// read where the body that moved them ended, before what the queue then
// says. One who typed `look` reads their place, `examine` the thing named
// and then the thing's own `contents` where its kinds write one,
// `inventory` the engine's `inventory`, `wait` its `waited`, and `help`
// its `help`, each found as every engine line is (`engine-lines.ts`),
// `help` given the readings `offers.ts` derives whose consent pass allows
// and some participant plays a part in; these come last. An NPC reads
// nothing. Every answer is carried unrendered, among what the turn says
// (`effects.ts`).

import { SPROUT } from '../declare/enums.js';
import { playsOf } from '../declare/roles.js';
import { ENGINE_VERBS } from '../declare/verbs.js';
import { isPerson } from './audience.js';
import { describeFor, type DescribeContext } from './describe.js';
import { engineSaid } from './engine-lines.js';
import type { Unrendered } from './effects.js';
import { boundObject, boundReadings, type Evaluated } from './evaluate.js';
import type { InstanceId } from './ids.js';
import type { Owed } from './move.js';
import { offersTo, type OfferContext } from './offers.js';
import { answeredByEngine, participantsOf, type Reading, type Said } from './reading.js';

/** What the engine answers `reading`, a person's typed command, once its queue is empty. */
export function engineAnswers(reading: Reading, context: OfferContext): Unrendered[] {
  const { state } = context;
  const answers: Unrendered[] = [];
  const { actor, verb } = reading;
  const here = state.instance(actor)?.container ?? null;
  if (!answeredByEngine(verb) || !isPerson(state, actor) || here === null) return answers;
  switch (verb.name) {
    case 'look':
      answers.push({ description: describeFor(here, actor, context) });
      break;
    case 'examine': {
      const target = [...reading.bindings.values()].find((bound) => 'object' in bound);
      if (target === undefined || !('object' in target)) {
        throw new Error('a reading of `examine` names nothing to examine.');
      }
      answers.push({ description: describeFor(target.object, actor, context) });
      const contents = contentsOf(target.object, actor, here, context);
      if (contents !== null) answers.push({ said: contents });
      break;
    }
    case 'inventory':
      answers.push({ said: inventoryOf(actor, here, context) });
      break;
    case 'wait':
      answers.push({ said: waitedFor(actor, context) });
      break;
    case 'help':
      answers.push({ said: helpFor(actor, here, context) });
      break;
  }
  return answers;
}

/** A description an arrival owes, as its reader reads it, and how many of the turn's lines come before it. */
export interface Arrived {
  readonly after: number;
  readonly line: Unrendered;
}

/**
 * The place each person a move carried between places arrived in, as
 * they read it, once for each place and only where they still stand
 * there, since a later move's arrival stands in for an earlier one's;
 * each placed where the last move that owed it was, in order.
 */
export function arrivalsRead(owed: readonly Owed[], context: DescribeContext): Arrived[] {
  const { state } = context;
  const last = new Map<string, Owed>();
  for (const one of owed) {
    const { mover, place } = one;
    if (!isPerson(state, mover) || state.instance(mover)?.container !== place) continue;
    const key = `${mover} ${place}`;
    last.delete(key);
    last.set(key, one);
  }
  return [...last.values()].map(({ mover, place, after }) => ({
    after,
    line: { description: describeFor(place, mover, context) },
  }));
}

/** `said` as the turn's lines, each of `arrived` read where its `after` falls among them. */
export function withArrivals(said: readonly Said[], arrived: readonly Arrived[]): Unrendered[] {
  const lines: Unrendered[] = [];
  let next = 0;
  const readUpTo = (at: number): void => {
    while (next < arrived.length && arrived[next]!.after <= at) lines.push(arrived[next++]!.line);
  };
  said.forEach((line, at) => {
    readUpTo(at);
    lines.push({ said: line });
  });
  readUpTo(Infinity);
  return lines;
}

/**
 * `thing`'s own `contents`, where its kinds write one, as `examine` says
 * it after the description: from the thing, to the one looking, with
 * `actor` and `here` bound as a description has them (the spec's Engine
 * verbs); null where it writes none.
 */
function contentsOf(
  thing: InstanceId,
  actor: InstanceId,
  here: InstanceId,
  context: OfferContext,
): Said | null {
  const passage = context.state.instance(thing)?.kind.passages.get('contents');
  if (passage === undefined) return null;
  return {
    effect: 'described',
    to: [actor],
    by: thing,
    speaker: null,
    said: { passage },
    bindings: acting(actor, here),
  };
}

/** `actor` and `here`, as the engine binds them for a line said to the one acting. */
function acting(actor: InstanceId, here: InstanceId): Map<string, Evaluated> {
  return new Map([
    ['actor', boundObject(actor)],
    ['here', boundObject(here)],
  ]);
}

/** The engine's `inventory`, whose default `sprout.Actor` writes, to the one who asked. */
function inventoryOf(actor: InstanceId, here: InstanceId, context: OfferContext): Said {
  const { by, said } = engineSaid(context.state, 'inventory', actor, here);
  return { effect: 'said', to: [actor], by, speaker: null, said, bindings: acting(actor, here) };
}

/** `wait`, answered with the world's `waited`, which binds nothing (the spec's Where types come from). */
function waitedFor(actor: InstanceId, context: OfferContext): Said {
  const { state } = context;
  const { by, said } = engineSaid(state, 'waited', actor, state.instance(actor)?.container ?? null);
  return { effect: 'said', to: [actor], by, speaker: null, said, bindings: new Map() };
}

/**
 * What `actor` can do where they stand, through the world's `help`: each
 * reading whose consent pass allows and some participant plays a part
 * in, less those a verb whose roles anything may fill would otherwise
 * offer for every thing in range against every other, once however many
 * are written alike.
 */
function helpFor(actor: InstanceId, here: InstanceId, context: OfferContext): Said {
  const typed: string[] = [];
  for (const offer of offersTo(actor, context)) {
    if (
      offer.refused === null &&
      someParticipantPlays(offer.reading, context) &&
      !typed.includes(offer.typed)
    ) {
      typed.push(offer.typed);
    }
  }
  const bindings = acting(actor, here);
  bindings.set('readings', boundReadings(typed));
  const { by, said } = engineSaid(context.state, 'help', actor, here);
  return { effect: 'notice', to: [actor], by, speaker: null, said, bindings };
}

/**
 * Whether some participant of `reading` plays a part in it: a `permit`
 * or a `do` written for the role they fill. One of the engine's own six
 * verbs needs none, since the engine answers it itself rather than a
 * play (the spec's Engine verbs: `help`; working notes Open 425).
 */
function someParticipantPlays(reading: Reading, context: OfferContext): boolean {
  const { verb } = reading;
  if (verb.library === SPROUT && ENGINE_VERBS.includes(verb.name)) return true;
  return participantsOf(reading).some((participant) => {
    const self = context.state.instance(participant.id);
    return (
      self !== undefined &&
      playsOf(self.kind.plays, verb.library, verb.name, participant.role).length > 0
    );
  });
}
