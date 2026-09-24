// What the engine answers once a command's queue is empty (the spec's
// Verbs › Engine verbs; Chance › The forms: a description is derived
// after the turn that moved the visitor). A person who moved between
// places, by `go` or by any `move`, reads the place they arrived in; one
// who typed `look` reads their place, `examine` the thing named,
// `inventory` their own kind's `inventory`, and `help` what they can do
// there, the readings `offers.ts` derives whose consent pass allows. An
// NPC reads nothing. Every answer is carried unrendered, among what the
// turn says (`effects.ts`).

import { SPROUT } from '../declare/enums.js';
import { isPerson } from './audience.js';
import { describeFor, type DescribeContext } from './describe.js';
import type { Unrendered } from './effects.js';
import { engineLine } from './engine-lines.js';
import { boundObject, type Evaluated } from './evaluate.js';
import type { InstanceId } from './ids.js';
import type { Notice } from './move.js';
import { offersTo, type OfferContext } from './offers.js';
import { answeredByEngine, type Reading, type Said } from './reading.js';

/** The passage `inventory` says, on the kind of the actor who asked. */
const INVENTORY = 'inventory';

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

/** The actor's own `inventory`, which `sprout.Actor` writes, said from them. */
function inventoryOf(actor: InstanceId, here: InstanceId, context: OfferContext): Said {
  const passage = context.state.instance(actor)?.kind.passages.get(INVENTORY);
  if (passage === undefined) {
    throw new Error(
      `\`${actor}\` has no \`${INVENTORY}\` passage, which \`${SPROUT}.Actor\` writes.`,
    );
  }
  return {
    effect: 'said',
    to: [actor],
    by: actor,
    speaker: null,
    said: { passage },
    bindings: acting(actor, here),
  };
}

/**
 * What `actor` can do where they stand, as the engine's fixed words: each
 * reading whose consent pass allows, typed, once however many things are
 * written alike.
 */
function helpFor(actor: InstanceId, here: InstanceId, context: OfferContext): Said {
  const typed: string[] = [];
  for (const offer of offersTo(actor, context)) {
    if (offer.refused === null && !typed.includes(offer.typed)) typed.push(offer.typed);
  }
  return {
    effect: 'notice',
    to: [actor],
    by: context.state.world,
    speaker: null,
    said: engineLine(`You can type: ${typed.map(escaped).join(', ')}.`),
    bindings: acting(actor, here),
  };
}

/** Words as a one-line passage holds them literally: a brace or a backslash escaped. */
function escaped(words: string): string {
  return words.replace(/[\\{}]/g, (ch) => `\\${ch}`);
}
