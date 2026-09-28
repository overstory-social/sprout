// What the engine answers once a command's queue is empty (the spec's
// Verbs › Engine verbs; Chance › The forms: a description is derived
// after the turn that moved the visitor). A person who moved between
// places, by `go` or by any `move`, reads the place they arrived in; one
// who typed `look` reads their place, `examine` the thing named,
// `inventory` the engine's `inventory`, `wait` its `waited`, and `help`
// its `help`, each found as every engine line is (`engine-lines.ts`),
// `help` given the readings `offers.ts` derives whose consent pass allows
// and some participant plays a part in. An NPC
// reads nothing. Every answer is carried unrendered, among what the turn
// says (`effects.ts`).

import { SPROUT } from '../declare/enums.js';
import { playsOf } from '../declare/roles.js';
import { ENGINE_VERBS } from '../declare/verbs.js';
import { isPerson } from './audience.js';
import { describeFor, type DescribeContext } from './describe.js';
import { engineSaid } from './engine-lines.js';
import type { Unrendered } from './effects.js';
import { boundObject, boundReadings, type Evaluated } from './evaluate.js';
import type { InstanceId } from './ids.js';
import type { Notice } from './move.js';
import { offersTo, type OfferContext } from './offers.js';
import { answeredByEngine, participantsOf, type Reading, type Said } from './reading.js';

/**
 * What the engine answers `reading`, a person's typed command, and every
 * person the turn's moves carried between places, in order: each arrival
 * first, then the command's own answer.
 */
export function engineAnswers(
  reading: Reading,
  notices: readonly Notice[],
  context: OfferContext,
): Unrendered[] {
  const { state } = context;
  const answers = arrivalsRead(notices, context);
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

/**
 * The place each person a move carried between places arrived in, as
 * they read it, in the order the moves were made, once for each place and
 * only where they still stand there, since a later move's arrival stands
 * in for an earlier one's.
 */
export function arrivalsRead(notices: readonly Notice[], context: DescribeContext): Unrendered[] {
  const { state } = context;
  const answers: Unrendered[] = [];
  const described = new Set<string>();
  for (const notice of notices) {
    if (notice.notice !== 'described') continue;
    const [mover] = notice.audience;
    if (!isPerson(state, mover) || state.instance(mover)?.container !== notice.place) continue;
    const key = `${mover} ${notice.place}`;
    if (described.has(key)) continue;
    described.add(key);
    answers.push({ description: describeFor(notice.place, mover, context) });
  }
  return answers;
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
