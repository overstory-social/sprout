// The command parser: a line a visitor typed, read as a reading (the
// spec's Verbs › Slots, Set roles, Value roles, Engine verbs; Names ›
// Addressing and display, Articles, Nicknames; Limits › Runtime budgets).
// The modules in `parser/` are its areas: the phrases a visitor may type,
// what a thing is called, where slots fall, what a noun names, and the
// answers. `parseCommand` is what a command turn reads through.
//
// Every line has exactly one outcome: a reading, or one of the world's
// answers, `which`, `not_here` or `unknown`, never nothing. A noun
// resolves only against the actor's range (the spec's Range), so no
// answer names anything out of it: a phrase that reads but has a noun
// nothing in range answers to is `not_here`, which names nothing.
// Phrases are tried in order and the first reading wins; failing one, the
// first `which` asked; failing that, `not_here` if any phrase read; and
// failing that, `unknown`. Every noun tried, every way of placing the
// slots, every object the range walk visits and every tie drawn is a
// step, so a line that costs too much to read faults the turn as any
// other work would. A tie is drawn from the turn's stream, so a line
// reads the same for the same seed.

import { typedWords } from '../declare/addressing.js';
import type { ResolvedRole } from '../declare/verbs.js';
import type { Budget } from './budget.js';
import type { Catalogue } from './catalogue.js';
import type { Draw } from './draws.js';
import type { InstanceId } from './ids.js';
import { liveTree } from './live.js';
import { rangeOf, type LiveTree, type PassRule, type Reached } from './range.js';
import type { Bound, Reading } from './reading.js';
import type { Parser } from './command.js';
import type { StateReader } from './state.js';
import { addressOf, type AddressContext } from './parser/address.js';
import { answer, type Answer, type Choice } from './parser/answers.js';
import type { CommandExit } from './parser/exits.js';
import { exitsFrom } from './exits.js';
import { fillSlot, valueOf, type Filled } from './parser/fill.js';
import { slotSpans, type SlotSpan } from './parser/match.js';
import type { Candidate } from './parser/nouns.js';
import type { TypedPhrase } from './parser/phrases.js';

/** What reading a line reads: the turn's state, the bundle, the pass rules, the meter and the draws. */
export interface CommandContext {
  readonly state: StateReader;
  readonly catalogue: Catalogue;
  readonly budget: Budget;
  /** The turn's stream, which breaks a tie among things written alike. */
  readonly draws: Draw;
  readonly passes: PassRule<InstanceId>;
  /** Each visitor's nickname, by the instance that is them. */
  readonly nicknames: ReadonlyMap<InstanceId, string>;
  /** The exits that apply where the actor stands, in the order the place declares them. */
  readonly exits: readonly CommandExit[];
}

/** A line's one outcome: understood as a reading, or answered. */
export type CommandOutcome = { readonly understood: Reading } | Answer;

/** `line`, typed by `actor`, as a reading or the world's answer to it. */
export function readCommand(
  line: string,
  actor: InstanceId,
  context: CommandContext,
): CommandOutcome {
  const { state, catalogue, budget } = context;
  const here = placeOf(state, actor);
  const words = typedWords(line);
  if (words.length === 0) return answer(state, 'unknown', actor, here);

  const addressing: AddressContext = { world: state.world, nicknames: context.nicknames };
  const tree = liveTree(state);
  const range = rangeOf({ tree, passes: context.passes, budget }, actor, 'any');
  const candidates = candidatesOf(state, tree, range.reached, addressing);
  const fill = { candidates, exits: context.exits, budget, draws: context.draws };

  let which: Answer | null = null;
  let notHere = false;
  for (const phrase of catalogue.phrases) {
    const filled = new Map<string, Filled>();
    const fillOf = (span: SlotSpan): Filled => {
      const key = `${span.role}:${span.start}:${span.end}`;
      let found = filled.get(key);
      if (found === undefined) {
        found = fillSlot(phrase.verb.roles[span.role]!, words.slice(span.start, span.end), fill);
        filled.set(key, found);
      }
      return found;
    };
    for (const spans of slotSpans(phrase.parts, words)) {
      budget.spend();
      const fills = spans.map(fillOf);
      if (fills.some((one) => one.fills === 'unfit')) continue;
      const asked = spans.findIndex((_, at) => fills[at]!.fills === 'which');
      if (asked >= 0) {
        which ??= whichAnswer(
          context,
          actor,
          here,
          words,
          spans[asked]!,
          fills[asked]!,
          addressing,
        );
        continue;
      }
      if (fills.some((one) => one.fills === 'nothing')) {
        notHere = true;
        continue;
      }
      return { understood: readingOf(phrase, actor, spans, fills, context) };
    }
  }
  return which ?? answer(state, notHere ? 'not_here' : 'unknown', actor, here);
}

/**
 * What may be named among what the walk reached, nearest first: every
 * live thing but the world, each with its nearness (`nearnessOf`).
 */
function candidatesOf(
  state: StateReader,
  tree: LiveTree<InstanceId>,
  reached: readonly Reached<InstanceId>[],
  addressing: AddressContext,
): Candidate[] {
  const near = nearnessOf(tree, reached);
  return reached.flatMap(({ node }) => {
    const instance = node === state.world ? undefined : state.instance(node);
    if (instance === undefined) return [];
    return [{ instance, address: addressOf(instance, addressing), near: near.get(node)! }];
  });
}

/**
 * How near each thing reached is, as the spec's Range counts it: first by
 * the ring it is in, how far out the container is that it is reached
 * through, then by how deep inside that container it lies. Two things
 * are equally near only where both agree; the walk is nearest first, so
 * the rank rises with it and each node's container is ranked before it.
 */
function nearnessOf(
  tree: LiveTree<InstanceId>,
  reached: readonly Reached<InstanceId>[],
): Map<InstanceId, number> {
  const where = new Map<InstanceId, { ring: number; depth: number }>();
  const rank = new Map<InstanceId, number>();
  // The last of the asker and its containers outward that the walk reached.
  let outer: InstanceId | null = null;
  let last: { ring: number; depth: number } | null = null;
  let at = -1;
  for (const { node, via } of reached) {
    let here: { ring: number; depth: number };
    if (via === 'self') {
      here = { ring: 0, depth: 0 };
      outer = node;
    } else if (outer !== null && node === tree.containerOf(outer)) {
      here = { ring: where.get(outer)!.ring + 1, depth: 0 };
      outer = node;
    } else {
      const inside = where.get(tree.containerOf(node)!);
      if (inside === undefined) throw new Error(`\`${node}\` was reached before what holds it.`);
      here = { ring: inside.ring, depth: inside.depth + 1 };
    }
    where.set(node, here);
    if (last === null || here.ring !== last.ring || here.depth !== last.depth) at++;
    last = here;
    rank.set(node, at);
  }
  return rank;
}

/** The reading one placement of a phrase's slots makes, every slot filled. */
function readingOf(
  phrase: TypedPhrase,
  actor: InstanceId,
  spans: readonly SlotSpan[],
  fills: readonly Filled[],
  context: CommandContext,
): Reading {
  const { verb } = phrase;
  const bindings = new Map<string, Bound>();
  const values: { role: ResolvedRole; words: readonly string[] }[] = [];
  spans.forEach((span, at) => {
    const role = verb.roles[span.role]!;
    const filled = fills[at]!;
    if (filled.fills === 'bound') bindings.set(role.name, filled.bound);
    else if (filled.fills === 'words') values.push({ role, words: filled.words });
  });
  // A value is bound once the things are, since who hears it depends on them.
  const things: Reading = { verb, actor, bindings: new Map(bindings) };
  for (const { role, words } of values) {
    const value = valueOf(role, words, things, context.state);
    if (value !== null) bindings.set(role.name, { value });
  }
  return { verb, actor, bindings };
}

/** The `which` one ambiguous slot asks, each candidate with the line that means it. */
function whichAnswer(
  context: CommandContext,
  actor: InstanceId,
  here: InstanceId,
  words: readonly string[],
  span: SlotSpan,
  filled: Filled,
  addressing: AddressContext,
): Answer {
  if (filled.fills !== 'which') return answer(context.state, 'which', actor, here);
  const start = span.start + filled.start;
  const end = span.start + filled.end;
  const choices: Choice[] = filled.candidates.map((id) => {
    const instance = context.state.instance(id)!;
    const name = typedWords(addressOf(instance, addressing).name);
    const line = [...words.slice(0, start), ...name, ...words.slice(end)];
    return { id, line: line.join(' ').replaceAll(' ,', ',') };
  });
  return answer(context.state, 'which', actor, here, choices);
}

/** The actor's place: its container, since an actor is only ever inside something that holds actors. */
function placeOf(state: StateReader, actor: InstanceId): InstanceId {
  const container = state.instance(actor)?.container ?? null;
  if (container === null) throw new Error(`\`${actor}\` is not in the world, and types nothing.`);
  return container;
}

/**
 * The parser a command turn reads through: `readCommand`, over the exits
 * that apply where the actor stands, with an answer said to the actor as
 * a notice from the world.
 */
export const parseCommand: Parser = (text, actor, context) => {
  const exits = exitsFrom(placeOf(context.state, actor), context);
  const outcome = readCommand(text, actor, { ...context, exits });
  if ('understood' in outcome) return { reading: outcome.understood };
  const { said, bindings, choices } = outcome;
  return {
    answered: {
      effect: 'notice',
      to: [actor],
      by: context.state.world,
      speaker: null,
      said,
      bindings,
    },
    choices,
  };
};
