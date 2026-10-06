// An item of a run read on its own turn (the spec's Parsing › Sequences,
// again and all): where an item named nothing in reach, or named things
// that tie, the line planned its reading with every other role filled
// as the line began, and only the item's words are read afresh, against
// the world as this turn finds it. So a pronoun in another role still
// names what it named when the line was typed, and the item's own answer,
// draw and `meant` belong to its own turn. It is answered as any line's
// noun is: `not_here` where it names nothing, `not_carrying` where a
// carried role names only what the actor does not carry, and `cannot`
// where what it names cannot fill the role, written through a phrase of
// the verb as the visitor would type it.

import { typedWords } from '../../declare/addressing.js';
import { humanisedOption } from '../../declare/enums.js';
import type { InstanceId } from '../ids.js';
import { consentPass, type Bound, type Reading } from '../reading.js';
import type { CommandContext, CommandOutcome } from '../parser.js';
import { addressOf, type Address } from './address.js';
import { answer } from './answers.js';
import { fillSlot } from './fill.js';
import { writtenAs } from './nouns.js';
import { boundWords } from './partial.js';
import { chooseReading, type Ranked } from './rank.js';
import { reachOf } from './reach.js';

/** `words`, typed by `actor`, as the item filling `role` of `within`, or the world's answer to them. */
export function readItem(
  words: string,
  actor: InstanceId,
  within: Reading,
  role: string,
  context: CommandContext,
): CommandOutcome {
  const { state, budget } = context;
  const here = state.instance(actor)!.container!;
  const filling = within.verb.roles.find((one) => one.name === role);
  const typed = typedWords(words);
  if (filling === undefined || typed.length === 0) return answer(state, 'unknown', actor, here);
  const addressing = { world: state.world, nicknames: context.nicknames };
  const address = (id: InstanceId): Address => addressOf(state.instance(id)!, addressing);
  const candidates = reachOf(actor, context);
  const fill = { candidates, exits: context.exits, budget, referents: context.referents };
  const filled = fillSlot(filling, typed, fill);
  const filledWith = (bound: Bound): Reading => ({
    verb: within.verb,
    actor,
    bindings: new Map([...within.bindings, [role, bound]]),
  });
  if (filled.fills === 'options') {
    const ranked = filled.options.map((option): Ranked => {
      budget.spend();
      const reading = filledWith(option.bound);
      return {
        reading,
        allowed: consentPass(reading, context) === null,
        literal: option.literal,
        near: [option.near],
        pronounNamed: option.pronounNamed ?? [],
        whole: true,
        rest: () => [],
      };
    });
    const written = (id: InstanceId): string => writtenAs(address(id));
    const chosen = chooseReading(ranked, written, context.draws, budget);
    return {
      understood: chosen.reading,
      rest: [],
      drawn: chosen.drawn,
      pronounNamed: chosen.pronounNamed,
    };
  }
  const [first] = filled.fills === 'outward' || filled.fills === 'unfit' ? filled.things : [];
  if (first === undefined) return answer(state, 'not_here', actor, here);
  if (filled.fills === 'outward' && 'object' in first.bound) {
    return answer(state, 'not_carrying', actor, here, { thing: first.bound.object });
  }
  const reading = written(filledWith(first.bound), role, address, context);
  return answer(state, 'cannot', actor, here, { reading });
}

/**
 * `reading` as a visitor would type it, through the first phrase of its
 * verb that writes `role` and leaves the fewest of its slots unfilled,
 * each phrase a step.
 */
function written(
  reading: Reading,
  role: string,
  address: (id: InstanceId) => Address,
  context: CommandContext,
): string {
  const { verb, bindings } = reading;
  const same = (one: Reading['verb']) => one.library === verb.library && one.name === verb.name;
  let best: { readonly words: string; readonly unfilled: number } | null = null;
  for (const phrase of context.catalogue.phrases) {
    context.budget.spend();
    if (phrase.only !== null || !same(phrase.verb)) continue;
    const names = phrase.parts.flatMap((part) =>
      'slot' in part ? [verb.roles[part.slot]!.name] : [],
    );
    if (!names.includes(role)) continue;
    const unfilled = names.filter((name) => !bindings.has(name)).length;
    if (best !== null && best.unfilled <= unfilled) continue;
    const words = phrase.parts
      .map((part) => {
        if ('words' in part) return part.words.join(' ');
        const bound = bindings.get(verb.roles[part.slot]!.name);
        if (bound === undefined) return '';
        if ('value' in bound)
          return typeof bound.value === 'string'
            ? humanisedOption(bound.value)
            : String(bound.value);
        return boundWords(bound, address);
      })
      .filter((one) => one !== '')
      .join(' ');
    best = { words, unfilled };
  }
  return best?.words ?? verb.name;
}
