// An item of a run read on its own turn (the spec's Parsing › Sequences,
// again and all): where an item named nothing in reach, or named things
// that tie, the line planned its reading with every other role filled
// as the line began, and only the item's words are read afresh, against
// the world as this turn finds it. So a pronoun in another role still
// names what it named when the line was typed, and the item's own answer,
// draw and `meant` belong to its own turn. A value role's words bind
// against what the item names, and its pronouns name what they named when
// the line began. What the line bound must still be in reach, or the turn
// is `not_here`, as a planned turn's is. It is answered as any line's
// noun is: `not_here` where it names nothing, `unknown` where a word of
// it names nothing in the world, `not_carrying` where a carried role
// names only what the actor does not carry, and `cannot` where what it
// names cannot fill the role, written through a phrase of the verb as the
// visitor would type it.

import { typedWords } from '../../declare/addressing.js';
import { humanisedOption } from '../../declare/enums.js';
import type { InstanceId } from '../ids.js';
import { consentPass, type Bound, type Reading } from '../reading.js';
import type { CommandContext, CommandOutcome } from '../parser.js';
import { addressOf, type Address } from './address.js';
import { answer } from './answers.js';
import { wayLabels } from './exits.js';
import { numberText } from '../values.js';
import { fillSlot, valueOf } from './fill.js';
import type { ParseContext } from '../command.js';
import { writtenAs } from './nouns.js';
import { boundWords } from './partial.js';
import { chooseReading, type Ranked } from './rank.js';
import { inReach } from './planned.js';
import { reachOf } from './reach.js';
import { inVocabulary, worldWords } from './vocabulary.js';

/** The item a turn reads: the reading the line planned, the role its words fill, and each value role's words. */
type ItemOf = NonNullable<ParseContext['item']>;

/**
 * `words`, typed by `actor`, as the item filling `role` of `within`, each
 * value role bound from its words against what the item names; or the
 * world's answer to them.
 */
export function readItem(
  words: string,
  actor: InstanceId,
  { within, role, values }: ItemOf,
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
  // What the line bound must still be in reach, as a planned turn's must.
  if (!inReach(within, candidates, context.exits)) return answer(state, 'not_here', actor, here);
  const fill = {
    candidates,
    exits: context.exits,
    labels: wayLabels(context.catalogue),
    budget,
    referents: context.referents,
  };
  const filled = fillSlot(filling, typed, fill);
  const filledWith = (bound: Bound): Reading => {
    const bindings = new Map([...within.bindings, [role, bound]]);
    const things: Reading = { verb: within.verb, actor, bindings: new Map(bindings) };
    for (const value of values) {
      const valued = within.verb.roles.find((one) => one.name === value.role);
      if (valued === undefined) continue;
      const bound = valueOf(valued, typedWords(value.words), things, state);
      if (bound !== null) bindings.set(value.role, { value: bound });
    }
    return { verb: within.verb, actor, bindings };
  };
  if (filled.fills === 'options') {
    const ranked = filled.options.map((option): Ranked => {
      budget.spend();
      const reading = filledWith(option.bound);
      return {
        reading,
        allowed: consentPass(reading, context) === null,
        literal: option.literal,
        near: [option.near],
        byName: option.byName,
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
  // A word nothing in the world is named by is the grammar's failure, not reach's.
  if (
    filled.fills === 'nothing' &&
    !inVocabulary(
      typed.slice(filled.start, filled.end),
      worldWords({ catalogue: context.catalogue, state, address, budget }),
    )
  ) {
    return answer(state, 'unknown', actor, here);
  }
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
            : typeof bound.value === 'number'
              ? numberText(bound.value)
              : String(bound.value);
        return boundWords(bound, address);
      })
      .filter((one) => one !== '')
      .join(' ');
    best = { words, unfilled };
  }
  return best?.words ?? verb.name;
}
