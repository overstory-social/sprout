// A phrase an object's synonym gives, typed where that object is out of
// reach (the spec's Parsing › Synonyms, When nothing matches). The phrase
// reads only in readings its object takes part in, so where a noun it
// took names nothing in reach, the line is answered with `not_here`, not
// `unknown`, when every such noun would name the object were it in reach.
// The object is tried alone, live in the world, by what it is called
// (`nouns.ts`), so no answer says where it is.

import type { InstanceId } from '../ids.js';
import { isLive } from '../live.js';
import type { StateReader } from '../state.js';
import type { Address } from './address.js';
import { fillSlot, type FillContext, type Filled } from './fill.js';
import type { SlotSpan } from './match.js';
import type { TypedPhrase } from './phrases.js';

/** What asking after an out-of-reach object reads: the turn's state, how a thing is addressed, and how a slot fills. */
export interface OfferedContext {
  readonly state: StateReader;
  readonly address: (id: InstanceId) => Address;
  readonly fill: FillContext;
}

/**
 * Whether `phrase`, an object's synonym's, would read `words` with its
 * object in reach: the object is live, and each slot whose noun named
 * nothing in reach names it, in a role it may fill. Each noun tried is a step.
 */
export function offeredOutOfReach(
  phrase: TypedPhrase,
  spans: readonly SlotSpan[],
  fills: readonly Filled[],
  words: readonly string[],
  context: OfferedContext,
): boolean {
  const { only } = phrase;
  if (only === null || !isLive(context.state, only)) return false;
  const instance = context.state.instance(only)!;
  const alone: FillContext = {
    ...context.fill,
    candidates: [{ instance, address: context.address(only), near: 0, carried: false }],
  };
  const missing = fills.flatMap((filled, at) =>
    filled.fills === 'nothing' ? [{ span: spans[at]!, start: filled.start, end: filled.end }] : [],
  );
  return (
    missing.length > 0 &&
    missing.every(({ span, start, end }) => {
      const typed = words.slice(span.start + start, span.start + end);
      const named = fillSlot(phrase.verb.roles[span.role]!, typed, alone).fills;
      return named === 'options' || named === 'outward';
    })
  );
}
