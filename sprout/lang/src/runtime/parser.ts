// The command parser: a line a visitor typed, read as a reading (the
// spec's Parsing › Matching a line, Choosing a reading, When nothing
// matches; Verbs › Slots, Set roles, Value roles, Engine verbs; Names ›
// Addressing and display, Articles, Nicknames; Limits › Runtime budgets).
// The modules in `parser/` are its areas: the phrases a visitor may type,
// what a thing is called, where slots fall, what a noun names, how the
// readings rank, and the answers. `parseCommand` is what a command turn
// reads through.
//
// Every line has exactly one outcome: a reading, or one of the world's
// answers, `cannot`, `not_here` or `unknown`, never nothing. A reading
// that a pronoun named a thing in, where the thing declares another, is
// said after the world's `pronoun_correction` (the spec's Parsing ›
// Pronouns). Every phrase is tried
// against the line, and every way it reads is a reading; they are ranked
// whole (`parser/rank.ts`) and the best is the one understood, a tie
// drawn from the turn's stream. A noun resolves only against the actor's
// range (the spec's Range), so no answer names anything out of it: where
// no phrase reads but one would with a thing in range its role cannot
// take, the line is `cannot`, saying what was understood
// (`parser/partial.ts`); where one would with a noun nothing in range
// answers to, `not_here`, which names nothing; and otherwise `unknown`.
// Every noun tried, every way of placing the slots, every reading built,
// every object the range walk visits and every tie drawn is a step, so a
// line that costs too much to read faults the turn as any other work would.

import { typedWords } from '../declare/addressing.js';
import type { ResolvedRole } from '../declare/verbs.js';
import type { Budget } from './budget.js';
import type { Catalogue } from './catalogue.js';
import type { Draw } from './draws.js';
import type { InstanceId } from './ids.js';
import { liveTree } from './live.js';
import { rangeOf, type LiveTree, type PassRule, type Reached } from './range.js';
import { consentPass, type Bound, type Reading, type Said } from './reading.js';
import { engineSaid } from './engine-lines.js';
import { boundObject, boundValue } from './evaluate.js';
import type { ParseContext, Parser } from './command.js';
import type { StateReader } from './state.js';
import { addressOf, type AddressContext } from './parser/address.js';
import { answer, type Answer } from './parser/answers.js';
import type { CommandExit } from './parser/exits.js';
import { exitsFrom } from './exits.js';
import { fillIntentSlot, fillSlot, valueOf, type Filled, type FillOption } from './parser/fill.js';
import { slotSpans, type SlotSpan } from './parser/match.js';
import { pronounIn, pronounNames, writtenAs, type Candidate } from './parser/nouns.js';
import { choosePartial, partialsOf, type Partial } from './parser/partial.js';
import type { TypedPart, TypedPhrase } from './parser/phrases.js';
import type { IntentReading } from './intents.js';
import { chooseReading, type Drawn, type Ranked, type Understood } from './parser/rank.js';

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
  /** What the actor's pronouns name: what their own last command about a thing was done to. */
  readonly referents: readonly InstanceId[];
}

/** A line's one outcome: understood as a reading, drawn where it tied with others, or answered. */
export type CommandOutcome =
  { readonly understood: Understood; readonly drawn: Drawn | null } | Answer;

/** `line`, typed by `actor`, as a reading or the world's answer to it. */
export function readCommand(
  line: string,
  actor: InstanceId,
  context: CommandContext,
): CommandOutcome {
  const { state, catalogue, budget } = context;
  const here = placeOf(state, actor);
  const words = typedWords(withoutQuestion(line));
  if (words.length === 0) return answer(state, 'unknown', actor, here);

  const addressing: AddressContext = { world: state.world, nicknames: context.nicknames };
  const tree = liveTree(state);
  const range = rangeOf({ tree, passes: context.passes, budget }, actor, 'any');
  const candidates = candidatesOf(state, tree, range.reached, addressing);
  const fill = { candidates, exits: context.exits, budget, referents: context.referents };

  const readings = new Map<string, Ranked>();
  const partials: Partial[] = [];
  const address = (id: InstanceId) => addressOf(state.instance(id)!, addressing);
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
      // An object's synonym reads only where the object takes part, so a
      // noun nothing answers to, or that the role cannot take, is not about it.
      if (phrase.only === null)
        partials.push(...partialsOf(phrase.parts, spans, fills, address, budget));
      if (fills.some((one) => one.fills === 'unfit')) continue;
      if (fills.some((one) => one.fills === 'nothing')) {
        if (phrase.only === null) notHere = true;
        continue;
      }
      for (const choice of choicesOf(fills)) {
        budget.spend();
        const reading = readingOf(phrase, actor, spans, choice, context);
        if (phrase.only !== null && !takesPart(phrase.only, reading)) continue;
        const ranked: Ranked = {
          reading,
          allowed: consentPass(reading, context) === null,
          literal: literalOf(phrase) + matchedIn(choice, spans, reading),
          near: reading.verb.roles.map((_, role) => {
            const at = spans.findIndex((span) => span.role === role);
            return at < 0 ? 0 : choice[at]!.near;
          }),
        };
        // One reading made two ways is one reading: the way that matched more words.
        const key = readingKey(reading);
        const known = readings.get(key);
        if (known === undefined || ranked.literal > known.literal) readings.set(key, ranked);
      }
    }
  }
  for (const phrase of catalogue.intentPhrases) {
    const { intent } = phrase;
    const filled = new Map<string, Filled>();
    const fillOf = (span: SlotSpan): Filled => {
      const key = `${span.role}:${span.start}:${span.end}`;
      let found = filled.get(key);
      if (found === undefined) {
        const roles = intent.slotRoles[span.role]!;
        found = fillIntentSlot(roles, words.slice(span.start, span.end), fill);
        filled.set(key, found);
      }
      return found;
    };
    for (const spans of slotSpans(phrase.parts, words)) {
      budget.spend();
      const fills = spans.map(fillOf);
      partials.push(...partialsOf(phrase.parts, spans, fills, address, budget));
      if (fills.some((one) => one.fills === 'unfit')) continue;
      if (fills.some((one) => one.fills === 'nothing')) {
        notHere = true;
        continue;
      }
      for (const choice of choicesOf(fills)) {
        budget.spend();
        const bindings = new Map<string, Bound>();
        spans.forEach((span, at) => {
          const chosen = choice[at]!;
          if (chosen.words === undefined) bindings.set(intent.slots[span.role]!, chosen.bound);
        });
        const reading: IntentReading = { intent, actor, bindings };
        // An intent asks no consent of its own: each step asks its own as it runs.
        const ranked: Ranked = {
          reading,
          allowed: true,
          literal: literalOf(phrase) + choice.reduce((sum, one) => sum + one.literal, 0),
          near: intent.slots.map((_, slot) => {
            const at = spans.findIndex((span) => span.role === slot);
            return at < 0 ? 0 : choice[at]!.near;
          }),
        };
        const key = readingKey(reading);
        const known = readings.get(key);
        if (known === undefined || ranked.literal > known.literal) readings.set(key, ranked);
      }
    }
  }
  if (readings.size === 0) {
    if (partials.length > 0) {
      return answer(state, 'cannot', actor, here, choosePartial(partials, context.draws, budget));
    }
    return answer(state, notHere ? 'not_here' : 'unknown', actor, here);
  }
  const written = (id: InstanceId): string => writtenAs(address(id));
  const chosen = chooseReading([...readings.values()], written, context.draws, budget);
  return { understood: chosen.reading, drawn: chosen.drawn };
}

/** One slot's part in one reading: what it binds and how near and literally, or a value role's words. */
type Choice =
  | (FillOption & { readonly words?: undefined })
  | { readonly words: readonly string[]; readonly near: 0; readonly literal: number };

/** Every way to take one option from each slot's, in order: a value role's words once. */
function choicesOf(fills: readonly Filled[]): Choice[][] {
  let combined: Choice[][] = [[]];
  for (const filled of fills) {
    const options: Choice[] =
      filled.fills === 'options'
        ? [...filled.options]
        : filled.fills === 'words'
          ? [{ words: filled.words, near: 0, literal: filled.words.length }]
          : [];
    combined = combined.flatMap((partial) => options.map((one) => [...partial, one]));
  }
  return combined;
}

/**
 * How many of the line's words `choice` matched literally in `reading`:
 * each thing's and exit's, and a value role's only where they bound a value.
 */
function matchedIn(
  choice: readonly Choice[],
  spans: readonly SlotSpan[],
  reading: Reading,
): number {
  return choice.reduce((sum, one, at) => {
    if (one.words === undefined) return sum + one.literal;
    const role = reading.verb.roles[spans[at]!.role]!;
    return reading.bindings.has(role.name) ? sum + one.literal : sum;
  }, 0);
}

/** How many words a phrase writes, each matched literally wherever it reads. */
function literalOf(phrase: { readonly parts: readonly TypedPart[] }): number {
  return phrase.parts.reduce((sum, part) => sum + ('words' in part ? part.words.length : 0), 0);
}

/** A reading as a key two ways of making it share: its verb and what fills each role. */
function readingKey(reading: Understood): string {
  const { bindings } = reading;
  const what =
    'verb' in reading
      ? ['verb', reading.verb.library, reading.verb.name]
      : ['intent', reading.intent.library, reading.intent.name];
  return JSON.stringify([...what, [...bindings]]);
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

/** The reading one placement of a phrase's slots makes, every slot filled by `choice`. */
function readingOf(
  phrase: TypedPhrase,
  actor: InstanceId,
  spans: readonly SlotSpan[],
  choice: readonly Choice[],
  context: CommandContext,
): Reading {
  const { verb } = phrase;
  const bindings = new Map<string, Bound>();
  const values: { role: ResolvedRole; words: readonly string[] }[] = [];
  spans.forEach((span, at) => {
    const role = verb.roles[span.role]!;
    const chosen = choice[at]!;
    if (chosen.words !== undefined) values.push({ role, words: chosen.words });
    else bindings.set(role.name, chosen.bound);
  });
  // A value is bound once the things are, since who hears it depends on them.
  const things: Reading = { verb, actor, bindings: new Map(bindings) };
  for (const { role, words } of values) {
    const value = valueOf(role, words, things, context.state);
    if (value !== null) bindings.set(role.name, { value });
  }
  return { verb, actor, bindings };
}

/**
 * `line` without a trailing `?`, which is read as nothing (`what is in the
 * cabinet?`); a `?` alone is kept, since it is a phrase of `help`.
 */
function withoutQuestion(line: string): string {
  const trimmed = line.trimEnd();
  if (!trimmed.endsWith('?')) return line;
  const rest = trimmed.slice(0, -1);
  return rest.trim() === '' ? line : rest;
}

/** Whether `object` is `reading`'s actor or fills one of its roles. */
function takesPart(object: InstanceId, reading: Reading): boolean {
  if (object === reading.actor) return true;
  return [...reading.bindings.values()].some(
    (bound) =>
      ('object' in bound && bound.object === object) ||
      ('set' in bound && bound.set.includes(object)),
  );
}

/** The actor's place: its container, since an actor is only ever inside something that holds actors. */
function placeOf(state: StateReader, actor: InstanceId): InstanceId {
  const container = state.instance(actor)?.container ?? null;
  if (container === null) throw new Error(`\`${actor}\` is not in the world, and types nothing.`);
  return container;
}

/**
 * The parser a command turn reads through: `readCommand`, over the exits
 * that apply where the actor stands, with an answer, or the engine's
 * `meant` for a reading drawn, said to the actor as a notice.
 */
export const parseCommand: Parser = (text, actor, context) => {
  const here = placeOf(context.state, actor);
  const exits = exitsFrom(here, context);
  const outcome = readCommand(text, actor, { ...context, exits });
  if ('understood' in outcome) {
    const { understood, drawn } = outcome;
    const meant = drawn?.meant == null ? null : meantLine(context.state, actor, here, drawn.meant);
    const was = drawn === null ? null : { among: drawn.among, meant };
    const corrected = correctionsOf(text, understood, actor, here, context);
    return 'intent' in understood
      ? { intended: understood, drawn: was, corrected }
      : { reading: understood, drawn: was, corrected };
  }
  const { by, said, bindings } = outcome;
  return { answered: { effect: 'notice', to: [actor], by, speaker: null, said, bindings } };
};

/**
 * The world's `pronoun_correction` for each thing `understood` binds that
 * a pronoun in `line` named and that declares a pronoun none typed agrees
 * with (the spec's Parsing › Pronouns); none where no pronoun was typed.
 */
function correctionsOf(
  line: string,
  understood: Understood,
  actor: InstanceId,
  here: InstanceId,
  context: ParseContext,
): Said[] {
  const typed = typedWords(line).flatMap((word) => pronounIn(word) ?? []);
  if (typed.length === 0) return [];
  const addressing = { world: context.state.world, nicknames: context.nicknames };
  const things = [...understood.bindings.values()].flatMap((bound) =>
    'object' in bound ? [bound.object] : 'set' in bound ? bound.set : [],
  );
  return [...new Set(things)].flatMap((id) => {
    const thing = context.state.instance(id);
    if (thing === undefined || !context.referents.includes(id)) return [];
    const address = addressOf(thing, addressing);
    const declared = address.pronoun;
    if (declared === null || typed.includes(declared)) return [];
    if (!typed.some((pronoun) => pronounNames(pronoun, thing, address))) return [];
    return [
      {
        effect: 'notice',
        to: [actor],
        ...engineSaid(context.state, 'pronoun_correction', actor, here),
        speaker: null,
        bindings: new Map([
          ['actor', boundObject(actor)],
          ['here', boundObject(here)],
          ['thing', boundObject(id)],
          ['pronoun', boundValue(declared)],
        ]),
      },
    ];
  });
}

/** The engine's `meant`, telling `actor` the thing a reading drawn from a tie names. */
function meantLine(
  state: StateReader,
  actor: InstanceId,
  here: InstanceId,
  thing: InstanceId,
): Said {
  return {
    effect: 'notice',
    to: [actor],
    ...engineSaid(state, 'meant', actor, here),
    speaker: null,
    bindings: new Map([
      ['actor', boundObject(actor)],
      ['here', boundObject(here)],
      ['thing', boundObject(thing)],
    ]),
  };
}
