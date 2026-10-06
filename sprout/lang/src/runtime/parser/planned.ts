// A reading an earlier turn of a line planned, as its own turn runs it
// (the spec's Parsing › Sequences, again and all; Intents): an intent's
// step, a thing of `all` or of a run. The world may have changed since
// the line was read, so before it runs every thing and way out it binds
// must still be in the actor's reach, as `again` asks of the last
// reading; where one is not, the turn is answered with `not_here`, which
// stops the line.

import type { ParseContext, Parsed } from '../command.js';
import { waysFrom } from '../exits.js';
import type { InstanceId } from '../ids.js';
import type { Reading } from '../reading.js';
import { answer } from './answers.js';
import type { AppliedWay } from './exits.js';
import type { Candidate } from './nouns.js';
import { reachOf } from './reach.js';

/** Whether every thing and way out `reading` binds is among `candidates` and the exits that apply. */
export function inReach(
  reading: Reading,
  candidates: readonly Candidate[],
  exits: readonly AppliedWay[],
): boolean {
  const reached = new Set(candidates.map((one) => one.instance.id));
  return [...reading.bindings.values()].every((bound) => {
    if ('object' in bound) return reached.has(bound.object);
    if ('set' in bound) return bound.set.every((id) => reached.has(id));
    if ('exit' in bound) {
      const { direction, label, to } = bound.exit;
      return exits.some(
        (exit) =>
          'to' in exit && exit.to === to && exit.label === label && exit.direction === direction,
      );
    }
    return true;
  });
}

/**
 * A reading an earlier turn of the line planned, as its own turn runs it:
 * as planned where every thing and way out it binds is still in the
 * actor's reach, and otherwise answered with `not_here`, as `again` is
 * (the spec's Parsing › Sequences, again and all).
 */
export function plannedOf(planned: Reading, actor: InstanceId, context: ParseContext): Parsed {
  const here = context.state.instance(actor)!.container!;
  const exits = waysFrom(here, context);
  const candidates = reachOf(actor, { ...context, exits });
  if (inReach(planned, candidates, exits)) {
    return { reading: planned, rest: [], drawn: null, corrected: [] };
  }
  const { by, said, bindings } = answer(context.state, 'not_here', actor, here);
  return { answered: { effect: 'notice', to: [actor], by, speaker: null, said, bindings } };
}
