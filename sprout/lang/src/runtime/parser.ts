// The command parser: a line a visitor typed, read as a reading (the
// spec's Parsing › Matching a line, Choosing a reading, When nothing
// matches; Verbs › Slots, Set roles, Value roles, Engine verbs; Names ›
// Addressing and display, Articles, Nicknames; Limits › Runtime budgets).
// The modules in `parser/` are its areas: the phrases a visitor may type,
// what a thing is called, where slots fall, what a noun names, how the
// readings rank, and the answers. `parseCommand` is what a command turn
// reads through. In the dark a noun resolves only against the actor and
// what they carry (the spec's Range › Sight).
//
// `again` or `g` alone runs the actor's last reading again, where what it
// binds is still in reach. A run of things in a role that takes one thing
// is read as its first item, each item after it a turn of its own
// (`parser/runs.ts`); `and` or a comma before a verb joins two commands
// where no reading takes the line whole (`parser/chain.ts`), the second
// read on its own turn (the spec's Parsing › Sequences, again and all).
//
// Every line has exactly one outcome: a reading, or one of the world's
// answers, `cannot`, `not_carrying`, `no_way`, `not_here` or `unknown`, or
// an exit's refusal, never nothing. A reading
// that a pronoun named a thing in, where the thing declares another, is
// said after the world's `pronoun_correction` (the spec's Parsing ›
// Pronouns). Every phrase is tried
// against the line, and every way it reads is a reading; they are ranked
// whole (`parser/rank.ts`) and the best is the one understood, a tie
// drawn from the turn's stream. A noun resolves only against the actor's
// range (the spec's Range), so no answer names anything out of it: where
// no phrase reads but one would with a thing in range its role cannot
// take, the line is `cannot`, saying what was understood
// (`parser/partial.ts`), or `not_carrying` where a carried role's noun
// names only what the actor does not carry (the spec's Verbs › Carried
// roles); where an exit role's words name an exit that refuses, its words,
// or are a direction no exit that applies answers, `no_way` (the spec's
// Verbs › Exits); where one would with a noun nothing in range answers
// to, `not_here`, which names nothing, and so where an object's synonym
// would with its object in reach (`parser/offered.ts`); and otherwise
// `unknown`.
// Every noun tried, every way of placing the slots, every reading built,
// every object the range walk visits and every tie drawn is a step, so a
// line that costs too much to read faults the turn as any other work would.

import { typedWords } from '../declare/addressing.js';
import type { ResolvedRole } from '../declare/verbs.js';
import type { Budget } from './budget.js';
import type { Catalogue } from './catalogue.js';
import type { Draw } from './draws.js';
import type { InstanceId } from './ids.js';
import type { PassRule } from './range.js';
import { consentPass, type Bound, type Reading, type Said } from './reading.js';
import { engineSaid } from './engine-lines.js';
import { boundObject, boundValue } from './evaluate.js';
import type { Following, ParseContext, Parser } from './command.js';
import type { StateReader } from './state.js';
import { addressOf, type Address, type AddressContext } from './parser/address.js';
import { answer, refused, type Answer } from './parser/answers.js';
import type { AppliedWay, RefusingExit } from './parser/exits.js';
import type { Direction } from '../declare/directions.js';
import { waysFrom } from './exits.js';
import {
  fillIntentSlot,
  fillSlot,
  valueOf,
  type FillContext,
  type Filled,
  type FillOption,
  type LaterItem,
} from './parser/fill.js';
import { slotSpans, type SlotSpan } from './parser/match.js';
import { fits, writtenAs, type Candidate, type PronounNamed } from './parser/nouns.js';
import { allIn, allowedOf, type AllContext } from './parser/all.js';
import { reachOf } from './parser/reach.js';
import { readItem } from './parser/item.js';
import { inReach } from './parser/planned.js';
import { chainPoints, commandAfter, commandBefore, stretchAfter } from './parser/chain.js';
import { namesOutright } from './parser/runs.js';
import { choosePartial, partialsOf, type Partial } from './parser/partial.js';
import { offeredOutOfReach, type OfferedContext } from './parser/offered.js';
import type { TypedPart, TypedPhrase } from './parser/phrases.js';
import type { IntentReading } from './intents.js';
import {
  chooseReading,
  compareRanked,
  type Drawn,
  type Ranked,
  type Understood,
} from './parser/rank.js';

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
  /** The exits that apply where the actor stands, in the order the place declares them, those that refuse among them. */
  readonly exits: readonly AppliedWay[];
  /** What the actor's pronouns name: what their own last command about a thing was done to. */
  readonly referents: readonly InstanceId[];
  /** The reading the actor's own last command ran, which `again` runs again; null before one. */
  readonly lastReading: Reading | null;
}

/** A line's one outcome: understood as a reading, drawn where it tied with others, or answered. */
export type CommandOutcome =
  | {
      readonly understood: Understood;
      /** The turns the line runs after it, in order: `all`'s or a run's, and a command `and` or a comma joined. */
      readonly rest: readonly Following[];
      readonly drawn: Drawn | null;
      /** What it binds that a pronoun named, and the pronoun typed. */
      readonly pronounNamed: readonly PronounNamed[];
    }
  | Answer;

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
  const candidates = reachOf(actor, context);
  if (words.length === 1 && AGAIN.includes(words[0]!)) {
    return again(context.lastReading, actor, here, candidates, context);
  }
  const fill = { candidates, exits: context.exits, budget, referents: context.referents };
  const reader: LineReader = {
    actor,
    here,
    fill,
    everything: { ...fill, actor, here, kinds: catalogue.kinds.values() },
    address: (id) => addressOf(state.instance(id)!, addressing),
    context,
  };
  const written = (id: InstanceId): string => writtenAs(reader.address(id));
  const understood = (readings: readonly Ranked[], after: readonly Following[]) => {
    const chosen = chooseReading(readings, written, context.draws, budget);
    return {
      understood: chosen.reading,
      rest: [...chosen.rest(), ...after],
      drawn: chosen.drawn,
      pronounNamed: chosen.pronounNamed,
    };
  };
  // Where `and` or a comma may join two commands, the line is one command
  // where a reading reads all of it; otherwise it splits at the first such
  // `and` or comma whose words after it, up to the next `and` or comma, name nothing
  // outright, so a name that begins with a verb stays whole, and what
  // follows is read on a turn of its own. A turn reads its line at most
  // twice, so a long chain costs each turn no more than its own line.
  const points = chainPoints(words, catalogue);
  const whole = readingsOf(words, reader);
  const answering = (read: Read, after: readonly Following[]) =>
    read.readings.length === 0 ? read.answered() : understood(read.readings, after);
  if (points.length === 0) return answering(whole, []);
  const reads = whole.readings.filter((one) => one.whole);
  if (reads.length > 0) return understood(reads, []);
  const at = points.find((point) => !namesOutright(stretchAfter(words, point), candidates, fill));
  if (at === undefined) return answering(whole, []);
  return answering(readingsOf(commandBefore(words, at), reader), [
    { text: commandAfter(words, at) },
  ]);
}

/** What reading a line's words needs besides them: who typed it, where, what they can name, and the turn. */
interface LineReader {
  readonly actor: InstanceId;
  readonly here: InstanceId;
  readonly fill: FillContext;
  readonly everything: AllContext;
  readonly address: (id: InstanceId) => Address;
  readonly context: CommandContext;
}

/** What one command's words make: every reading, and the answer where they make none. */
interface Read {
  readonly readings: readonly Ranked[];
  /** The world's answer to words no reading reads, which may draw among partial readings. */
  readonly answered: () => Answer;
}

/** Every reading `words` make as one command, each phrase tried against them. */
function readingsOf(words: readonly string[], reader: LineReader): Read {
  const { actor, here, fill, everything, address, context } = reader;
  const { state, catalogue, budget } = context;
  const readings = new Map<string, Ranked>();
  const partials: Partial[] = [];
  let notHere = false;
  // A way out the words name that does not go: an exit that refuses, or a direction none answers.
  let noGoing: RefusingExit | Direction | null = null;
  const offered: OfferedContext = { state, address, fill };
  for (const phrase of catalogue.phrases) {
    const filled = new Map<string, Filled>();
    const fillOf = (span: SlotSpan): Filled => {
      const key = `${span.role}:${span.start}:${span.end}`;
      let found = filled.get(key);
      if (found === undefined) {
        const role = phrase.verb.roles[span.role]!;
        const typed = words.slice(span.start, span.end);
        found = allIn(typed, role, phrase.verb, everything) ?? fillSlot(role, typed, fill);
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
      if (fills.some((one) => one.fills === 'unfit' || one.fills === 'outward')) continue;
      const going = fills.find((one) => one.fills === 'refused' || one.fills === 'no_way');
      if (going !== undefined) {
        if (phrase.only === null && noGoing === null) {
          noGoing = going.fills === 'refused' ? going.way : going.direction;
        }
        continue;
      }
      if (fills.some((one) => one.fills === 'nothing')) {
        // An object's synonym typed where the object is out of reach.
        if (phrase.only === null || offeredOutOfReach(phrase, spans, fills, words, offered)) {
          notHere = true;
        }
        continue;
      }
      // One role runs once for each of several things, never two.
      const several = fills.filter((one) => one.fills === 'all' || one.fills === 'run').length;
      if (several > 1) continue;
      for (const choice of choicesOf(fills)) {
        budget.spend();
        const each = eachOf(phrase, actor, spans, choice, context);
        if (each.length === 0) {
          // `all` that leaves nothing to run names nothing.
          notHere = true;
          continue;
        }
        const [reading, ...rest] = each as [Reading, ...Reading[]];
        if (phrase.only !== null && !takesPart(phrase.only, reading)) continue;
        const ranked: Ranked = {
          reading,
          rest: () => [
            ...rest.map((planned) => ({ planned })),
            ...laterOf(phrase, actor, spans, choice, words, context),
          ],
          allowed: consentPass(reading, context) === null,
          literal: literalOf(phrase) + matchedIn(choice, spans, reading),
          near: reading.verb.roles.map((_, role) => {
            const at = spans.findIndex((span) => span.role === role);
            return at < 0 ? 0 : choice[at]!.near;
          }),
          byName: byNameIn(choice),
          pronounNamed: pronounsIn(choice),
          whole: readsWhole(choice, spans, reading),
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
      if (fills.some((one) => one.fills === 'unfit' || one.fills === 'outward')) continue;
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
          byName: byNameIn(choice),
          pronounNamed: pronounsIn(choice),
          whole: true,
          rest: () => [],
        };
        const key = readingKey(reading);
        const known = readings.get(key);
        if (known === undefined || ranked.literal > known.literal) readings.set(key, ranked);
      }
    }
  }
  const answered = (): Answer => {
    if (partials.length > 0) {
      const partial = choosePartial(partials, context.draws, budget);
      return partial.uncarried === null
        ? answer(state, 'cannot', actor, here, { reading: partial.words })
        : answer(state, 'not_carrying', actor, here, { thing: partial.uncarried });
    }
    if (noGoing !== null) {
      return typeof noGoing === 'string'
        ? answer(state, 'no_way', actor, here, { way: noGoing })
        : refused(noGoing, actor, here);
    }
    return answer(state, notHere ? 'not_here' : 'unknown', actor, here);
  };
  return { readings: [...readings.values()], answered };
}

/**
 * Whether `reading`, which `choice` made, reads every word it was given:
 * each item of its run names something, and every value typed is bound.
 */
function readsWhole(
  choice: readonly Choice[],
  spans: readonly SlotSpan[],
  reading: Reading,
): boolean {
  return choice.every((one, at) => {
    if (one.words !== undefined) {
      return reading.bindings.has(reading.verb.roles[spans[at]!.role]!.name);
    }
    return (one.later ?? []).every((item) => item.filled.fills === 'options');
  });
}

/**
 * The turns a run's items after its first make, in the order written,
 * each a reading planned now with every other role as this one binds
 * them: the item's role filled by the thing it names best; or, where it
 * names nothing it may fill or ties between things, left for its own
 * turn to read the item's words afresh (`parser/item.ts`), which
 * answers it or draws as any line does. Each thing tried is a step.
 */
function laterOf(
  phrase: TypedPhrase,
  actor: InstanceId,
  spans: readonly SlotSpan[],
  choice: readonly Choice[],
  words: readonly string[],
  context: CommandContext,
): Following[] {
  const at = choice.findIndex((one) => one.words === undefined && one.later !== undefined);
  const run = choice[at];
  if (run === undefined || run.words !== undefined || run.later === undefined) return [];
  const span = spans[at]!;
  const role = phrase.verb.roles[span.role]!.name;
  const slot = words.slice(span.start, span.end);
  // Every thing but the item's, and each value role's words, which bind against the item's thing.
  const values = spans.flatMap((one, other) => {
    const typed = choice[other]!.words;
    return typed === undefined
      ? []
      : [{ role: phrase.verb.roles[one.role]!.name, words: typed.join(' ') }];
  });
  const first = readingOf(phrase, actor, spans, choice, context);
  const kept = new Set([role, ...values.map((one) => one.role)]);
  const within: Reading = {
    ...first,
    bindings: new Map([...first.bindings].filter(([name]) => !kept.has(name))),
  };
  const { referents } = context;
  return run.later.map((item): Following => {
    const words = slot.slice(item.start, item.end).join(' ');
    const reread = { role, words, values, referents };
    if (item.filled.fills !== 'options') return { planned: within, reread };
    const ranked = item.filled.options.map((option): Ranked => {
      context.budget.spend();
      const one = choice.map((chosen, other) => (other === at ? option : chosen));
      const reading = readingOf(phrase, actor, spans, one, context);
      return {
        reading,
        allowed: consentPass(reading, context) === null,
        literal: option.literal,
        near: [option.near],
        byName: option.byName,
        pronounNamed: [],
        whole: true,
        rest: () => [],
      };
    });
    const [best, next] = [...ranked].sort(compareRanked);
    if (best === undefined || (next !== undefined && compareRanked(best, next) === 0)) {
      return { planned: within, reread };
    }
    return { planned: best.reading as Reading };
  });
}

/** How many of the things `choice` binds were named by their whole name. */
function byNameIn(choice: readonly Choice[]): number {
  return choice.reduce((sum, one) => sum + one.byName, 0);
}

/** What a pronoun named among what `choice` binds. */
function pronounsIn(choice: readonly Choice[]): PronounNamed[] {
  return choice.flatMap((one) => (one.words === undefined ? (one.pronounNamed ?? []) : []));
}

/** The words that run the actor's last reading again (the spec's Parsing › Sequences, again and all). */
const AGAIN: readonly string[] = ['again', 'g'];

/**
 * `last` run again by `actor`: the same verb and the same things, whatever
 * its words would mean now, where every thing and way out it binds is
 * still in reach; `not_here` where one is not, and `unknown` where there
 * is no last reading.
 */
function again(
  last: Reading | null,
  actor: InstanceId,
  here: InstanceId,
  candidates: readonly Candidate[],
  context: CommandContext,
): CommandOutcome {
  if (last === null || !stillFits(last, context.state)) {
    return answer(context.state, 'unknown', actor, here);
  }
  if (!inReach(last, candidates, context.exits)) {
    return answer(context.state, 'not_here', actor, here);
  }
  return { understood: { ...last, actor }, rest: [], drawn: null, pronounNamed: [] };
}

/**
 * Whether `reading` is still one its verb takes: each binding names one of
 * its roles and fills it with what that role takes, each thing still of
 * the role's kind, and every role a thing or a way out fills that is not
 * optional is bound. A reading
 * kept from before may not be, where the verb's roles have changed since.
 */
function stillFits(reading: Reading, state: StateReader): boolean {
  const { roles } = reading.verb;
  for (const [name, bound] of reading.bindings) {
    const role = roles.find((one) => one.name === name);
    const fills = role?.filler?.fills;
    if (role === undefined || fills === undefined) return false;
    const thing = (id: InstanceId): boolean => {
      const instance = state.instance(id);
      return instance !== undefined && fits(role, instance);
    };
    const fitting =
      'object' in bound
        ? !role.many && thing(bound.object)
        : 'set' in bound
          ? role.many && bound.set.every(thing)
          : 'exit' in bound
            ? fills === 'exit'
            : fills === 'symbol'
              ? typeof bound.value === 'string'
              : fills === 'integer' && typeof bound.value === 'number';
    if (!fitting) return false;
  }
  // A value role is bound only where a participant hears its value, so it may be unbound.
  return roles.every((role) => {
    const fills = role.filler?.fills;
    const value = fills === 'symbol' || fills === 'integer';
    return role.optional || value || reading.bindings.has(role.name);
  });
}

/** One slot's part in one reading: what it binds and how near and literally, or a value role's words. */
type Choice =
  | (FillOption & {
      readonly words?: undefined;
      /** For `all` in a role that takes one thing, each thing it takes, this one first. */
      readonly each?: readonly FillOption[];
      /** For a run in a role that takes one thing, each item after this one. */
      readonly later?: readonly LaterItem[];
    })
  | {
      readonly words: readonly string[];
      readonly near: 0;
      readonly literal: number;
      readonly byName: 0;
    };

/** Every way to take one option from each slot's, in order: a value role's words once. */
function choicesOf(fills: readonly Filled[]): Choice[][] {
  let combined: Choice[][] = [[]];
  for (const filled of fills) {
    const options: Choice[] =
      filled.fills === 'options'
        ? [...filled.options]
        : filled.fills === 'all'
          ? [{ ...filled.things[0]!, each: filled.things }]
          : filled.fills === 'run'
            ? filled.options.map((one) => ({ ...one, later: filled.later }))
            : filled.fills === 'words'
              ? [{ words: filled.words, near: 0, literal: filled.words.length, byName: 0 }]
              : [];
    combined = combined.flatMap((partial) => options.map((one) => [...partial, one]));
  }
  return combined;
}

/**
 * How many of the line's words `choice` matched literally in `reading`:
 * each thing's and exit's, each later item's of a run as its best match,
 * and a value role's only where they bound a value.
 */
function matchedIn(
  choice: readonly Choice[],
  spans: readonly SlotSpan[],
  reading: Reading,
): number {
  return choice.reduce((sum, one, at) => {
    if (one.words === undefined) return sum + one.literal + laterLiteral(one.later ?? []);
    const role = reading.verb.roles[spans[at]!.role]!;
    return reading.bindings.has(role.name) ? sum + one.literal : sum;
  }, 0);
}

/** How many words a run's later items matched literally, each by the best thing it names. */
function laterLiteral(later: readonly LaterItem[]): number {
  return later.reduce((sum, { filled }) => {
    if (filled.fills !== 'options') return sum;
    return sum + Math.max(0, ...filled.options.map((one) => one.literal));
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
 * The readings one placement of a phrase's slots makes: the one `choice`
 * fills every slot with, or, where a slot is `all`, one for each thing it
 * takes that no other slot names and whose consent pass allows, in order,
 * each a step; none where `all` leaves nothing.
 */
function eachOf(
  phrase: TypedPhrase,
  actor: InstanceId,
  spans: readonly SlotSpan[],
  choice: readonly Choice[],
  context: CommandContext,
): Reading[] {
  const at = choice.findIndex((one) => one.words === undefined && one.each !== undefined);
  if (at < 0) return [readingOf(phrase, actor, spans, choice, context)];
  const named = new Set(
    choice.flatMap((one, other) =>
      other === at || one.words !== undefined
        ? []
        : 'object' in one.bound
          ? [one.bound.object]
          : 'set' in one.bound
            ? one.bound.set
            : [],
    ),
  );
  const taken = choice[at]!;
  const things = (taken.words === undefined ? (taken.each ?? []) : []).filter(
    (one) => !('object' in one.bound && named.has(one.bound.object)),
  );
  const readings = things.map((thing) => {
    context.budget.spend();
    const one = choice.map((chosen, slot) => (slot === at ? thing : chosen));
    return readingOf(phrase, actor, spans, one, context);
  });
  return allowedOf(readings, context);
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
 * that apply where the actor stands. An answer is said to the actor as a
 * notice, and an exit's refusal as `refused`, as a consent pass's is (the
 * spec's Runtime › Effects); the engine's `meant` for a reading drawn, as a notice.
 */
export const parseCommand: Parser = (text, actor, context) => {
  const here = placeOf(context.state, actor);
  const exits = waysFrom(here, context);
  const { item } = context;
  const outcome =
    item === undefined
      ? readCommand(text, actor, { ...context, exits })
      : readItem(text, actor, item, { ...context, exits });
  if ('understood' in outcome) {
    const { understood, drawn } = outcome;
    const meant = drawn?.meant == null ? null : meantLine(context.state, actor, here, drawn.meant);
    const was = drawn === null ? null : { among: drawn.among, meant };
    const corrected = correctionsOf(outcome.pronounNamed, actor, here, context);
    const { rest } = outcome;
    return 'intent' in understood
      ? { intended: understood, rest, drawn: was, corrected }
      : { reading: understood, rest, drawn: was, corrected };
  }
  const { by, said, bindings } = outcome;
  const effect = outcome.answer === 'refused' ? 'refused' : 'notice';
  return { answered: { effect, to: [actor], by, speaker: null, said, bindings } };
};

/**
 * The world's `pronoun_correction` for each thing a pronoun named that
 * declares another pronoun (the spec's Parsing › Pronouns), each once.
 */
function correctionsOf(
  named: readonly PronounNamed[],
  actor: InstanceId,
  here: InstanceId,
  context: ParseContext,
): Said[] {
  const addressing = { world: context.state.world, nicknames: context.nicknames };
  const corrected = new Set<InstanceId>();
  return named.flatMap(({ id, pronoun }) => {
    const thing = context.state.instance(id);
    if (thing === undefined || corrected.has(id)) return [];
    const declared = addressOf(thing, addressing).pronoun;
    if (declared === null || declared === pronoun) return [];
    corrected.add(id);
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
