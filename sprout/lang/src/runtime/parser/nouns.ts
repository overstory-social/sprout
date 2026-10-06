// A noun a visitor typed, resolved against what they can reach (the
// spec's Names › Articles; Verbs › Slots, Set roles; Properties › Where
// types come from; Parsing › Matching a line). An article or a
// determiner is optional before it, so the words are tried as typed and
// then without their first word where that is one. A thing is named by
// one of its nouns, with any of its adjectives before it, or by
// adjectives alone, which names it weakly: those words count as none
// matched literally. A relative phrase narrows a name by what holds it,
// `the key in the cabinet`, `the key that is on the shelf`, `the one in
// the cabinet`: `in` and `on` both mean held directly by. A pronoun alone,
// `it`, `them`, `him` or `her`, names what the visitor's own last command
// was done to, where it is in reach (the spec's Parsing › Pronouns). A role's kind
// narrows what may fill it and is never a source of refusal text: a thing
// that answers and is not of the kind makes the phrase not match.
// Adjectives alone name a thing only where nothing that fits is named by
// a noun or its whole name (Matching a line: `red` names the red box
// "only where nothing else is named better"). Every thing left is a way
// to read the noun, with how near it is, how many words it matched and
// whether its whole name was typed, and the parser ranks the readings
// they make whole (Choosing a reading), so no thing named outright is
// dropped here that a reading's consent pass or nearness would choose.
// Every candidate a noun is tried against is one step.

import { isActor } from '../../declare/actors.js';
import { DETERMINERS, CONNECTORS } from '../../declare/addressing.js';
import { kindName } from '../../declare/kinds.js';
import type { ResolvedRole } from '../../declare/verbs.js';
import { TYPED_PRONOUNS, type Pronoun } from '../../syntax/ast-grammar.js';
import type { Budget } from '../budget.js';
import type { InstanceId } from '../ids.js';
import type { Instance } from '../state.js';
import type { Address } from './address.js';

/** One thing a noun may name, with how it is addressed and how near it is. */
export interface Candidate {
  readonly instance: Instance;
  readonly address: Address;
  /** Its nearness in the range walk: smaller is nearer, and equal only among the equally near. */
  readonly near: number;
  /** Whether the one typing carries it, through open containers they carry (the spec's Carried roles). */
  readonly carried: boolean;
}

/** What resolving a noun reads besides the candidates: the turn's meter, and what the visitor's pronouns name. */
export interface NounContext {
  readonly budget: Budget;
  /** What the one typing's own last command about a thing was done to (the spec's Parsing › Pronouns). */
  readonly referents: readonly InstanceId[];
}

/** One thing a noun may name: how near it is, and how many of the typed words its name matched. */
export interface Named {
  readonly id: InstanceId;
  readonly near: number;
  readonly literal: number;
  /** Whether its whole name was typed. */
  readonly byName: boolean;
  /** The pronoun typed for it, where a pronoun named it. */
  readonly pronoun?: Pronoun;
}

/** A thing a pronoun named, and the pronoun, which a correction is said for where it declares another. */
export interface PronounNamed {
  readonly id: InstanceId;
  readonly pronoun: Pronoun;
}

/** What a run of words names among candidates. */
export type NounFound =
  /** Every thing that fits, nearest first. */
  | { readonly found: 'some'; readonly things: readonly Named[] }
  /** Nothing among the candidates answers to the words. */
  | { readonly found: 'nothing' }
  /** Something answers, and none of what answers may fill the role: what answers, nearest first. */
  | { readonly found: 'unfit'; readonly things: readonly Named[] };

/** One set a run may name: its things in the order typed, duplicates collapsed, and how they matched. */
export interface NamedSet {
  readonly ids: readonly InstanceId[];
  /** The sum of its things' nearness. */
  readonly near: number;
  readonly literal: number;
  /** How many of its things were named by their whole name. */
  readonly byName: number;
  /** Those of its things a pronoun named. */
  readonly pronounNamed: readonly PronounNamed[];
}

/**
 * What a set role's run names: every set its nouns may make together;
 * or what its first noun that names nothing it may take found, with
 * where that noun runs among the run's words.
 */
export type RunFound =
  | { readonly found: 'sets'; readonly sets: readonly NamedSet[] }
  | ({ readonly found: 'nothing' | 'unfit' } & { readonly start: number; readonly end: number });

/** Whether `instance` may fill `role`: any thing an open role, one composing its kind a kind's. */
export function fits(role: ResolvedRole, instance: Instance): boolean {
  const filler = role.filler;
  if (filler === null) return false;
  if (filler.fills === 'open') return true;
  if (filler.fills === 'kind') return instance.kind.composes.has(kindName(filler.kind));
  return false;
}

/** The words as typed, and without a leading article or determiner where one leads more words. */
export function forms(words: readonly string[]): (readonly string[])[] {
  const first = words[0];
  if (first !== undefined && words.length > 1 && DETERMINERS.includes(first)) {
    return [words, words.slice(1)];
  }
  return [words];
}

/** How a thing answers to a name: its whole name, a noun, or adjectives alone. */
type By = 'name' | 'noun' | 'adjective';

/** How `address` answers to `words`: by its whole name, by a noun, by adjectives alone, or not at all. */
export function answersTo(words: readonly string[], address: Address): By | null {
  return answering(words, address)?.by ?? null;
}

/**
 * How `address` answers to `words`, and how many of them it matched
 * literally: a name or a noun, with any adjectives before it, all of
 * them; adjectives alone, none.
 */
function answering(
  words: readonly string[],
  address: Address,
): { readonly by: By; readonly literal: number } | null {
  const name = address.nouns[0]?.join(' ');
  let byNoun: { readonly by: By; readonly literal: number } | null = null;
  let byAdjectives: { readonly by: By; readonly literal: number } | null = null;
  for (const form of forms(words)) {
    if (form.join(' ') === name) return { by: 'name', literal: form.length };
    const adjectives = (run: readonly string[]) =>
      run.every((word) => address.adjectives.includes(word));
    for (const noun of address.nouns) {
      const head = form.length - noun.length;
      if (head < 0 || form.slice(head).join(' ') !== noun.join(' ')) continue;
      if (adjectives(form.slice(0, head))) byNoun ??= { by: 'noun', literal: form.length };
    }
    if (adjectives(form)) byAdjectives ??= { by: 'adjective', literal: 0 };
  }
  return byNoun ?? byAdjectives;
}

/** A candidate a name reaches, and how. */
interface Answered {
  readonly candidate: Candidate;
  readonly by: By;
  readonly literal: number;
  readonly pronoun?: Pronoun;
}

/** How strongly each way of answering names a thing, the strongest first. */
const STRENGTH: readonly By[] = ['name', 'noun', 'adjective'];

/**
 * Every candidate `words` name, directly or through a relative phrase,
 * each once by its strongest reading, in the order the candidates stand.
 */
function named(
  words: readonly string[],
  candidates: readonly Candidate[],
  context: NounContext,
): Answered[] {
  const found = new Map<InstanceId, Answered>();
  const keep = (one: Answered): void => {
    const known = found.get(one.candidate.instance.id);
    const stronger =
      known === undefined ||
      STRENGTH.indexOf(one.by) < STRENGTH.indexOf(known.by) ||
      (one.by === known.by && one.literal > known.literal);
    if (stronger) found.set(one.candidate.instance.id, one);
  };
  const pronoun = words.length === 1 ? pronounIn(words[0]!) : null;
  if (pronoun !== null) {
    return candidates.flatMap((candidate) => {
      context.budget.spend();
      const named = context.referents.includes(candidate.instance.id);
      return named && pronounNames(pronoun, candidate.instance, candidate.address)
        ? [{ candidate, by: 'name', literal: 1, pronoun }]
        : [];
    });
  }
  for (const candidate of candidates) {
    context.budget.spend();
    const answer = answering(words, candidate.address);
    if (answer !== null) keep({ candidate, ...answer });
  }
  for (const one of relatives(words, candidates, context)) keep(one);
  return candidates.flatMap((candidate) => found.get(candidate.instance.id) ?? []);
}

/** The pronoun `word` is, as a thing declares it; null where it is none a visitor types. */
export function pronounIn(word: string): Pronoun | null {
  return Object.hasOwn(TYPED_PRONOUNS, word) ? TYPED_PRONOUNS[word]! : null;
}

/**
 * Whether `pronoun`, typed, names `thing`, which the visitor's last
 * command was done to: `it` and `they` always, `he` and `she` where it is
 * a person or declares that pronoun.
 */
function pronounNames(pronoun: Pronoun, thing: Instance, address: Address): boolean {
  if (pronoun === 'it' || pronoun === 'they') return true;
  return isActor(thing.kind) || address.pronoun === pronoun;
}

/**
 * What `words` name through a relative phrase: at each `in` or `on`, the
 * words before it, less a `that is`, name what stands directly in what
 * the words after it name, `one` anything that does.
 */
function relatives(
  words: readonly string[],
  candidates: readonly Candidate[],
  context: NounContext,
): Answered[] {
  const found: Answered[] = [];
  for (let at = 1; at < words.length - 1; at++) {
    if (words[at] !== 'in' && words[at] !== 'on') continue;
    const thatIs = at >= 3 && words[at - 2] === 'that' && words[at - 1] === 'is';
    const inner = words.slice(0, thatIs ? at - 2 : at);
    const joining = thatIs ? 3 : 1;
    const holders = new Map(
      named(words.slice(at + 1), candidates, context).map((one) => [
        one.candidate.instance.id,
        one,
      ]),
    );
    if (holders.size === 0) continue;
    const held = (candidate: Candidate): Answered | undefined =>
      candidate.instance.container === null ? undefined : holders.get(candidate.instance.container);
    const any = forms(inner).some((form) => form.length === 1 && form[0] === 'one');
    const things: Answered[] = any
      ? candidates.map((candidate) => ({ candidate, by: 'noun', literal: 1 }))
      : named(inner, candidates, context);
    for (const thing of things) {
      const holder = held(thing.candidate);
      if (holder === undefined) continue;
      found.push({
        candidate: thing.candidate,
        by: thing.by === 'name' ? 'noun' : thing.by,
        literal: thing.literal + joining + holder.literal,
      });
    }
  }
  return found;
}

/** What one noun names among `candidates`, nearest first, for `role`. */
export function nounIn(
  words: readonly string[],
  role: ResolvedRole,
  candidates: readonly Candidate[],
  context: NounContext,
): NounFound {
  return thingsIn(words, (instance) => fits(role, instance), candidates, context);
}

/** What one noun names among `candidates`, nearest first, of what `fitting` says may fill its slot. */
export function thingsIn(
  words: readonly string[],
  fitting: (instance: Instance) => boolean,
  candidates: readonly Candidate[],
  context: NounContext,
): NounFound {
  const answered = named(words, candidates, context);
  if (answered.length === 0) return { found: 'nothing' };
  const fit = answered.filter(({ candidate }) => fitting(candidate.instance));
  const pool = fit.length === 0 ? answered : fit;
  const outright = pool.filter(({ by }) => by !== 'adjective');
  const found = outright.length > 0 ? outright : pool;
  const things = found.map(({ candidate, by, literal, pronoun }) => ({
    id: candidate.instance.id,
    near: candidate.near,
    literal,
    byName: by === 'name' && pronoun === undefined,
    ...(pronoun === undefined ? {} : { pronoun }),
  }));
  return fit.length === 0 ? { found: 'unfit', things } : { found: 'some', things };
}

/**
 * What a set role's run names: split on `and` and commas literally, each
 * noun resolved on its own (the spec's Set roles), and every set its
 * nouns' things make together, each set a step. The first noun that
 * names nothing it may take decides.
 */
export function runIn(
  words: readonly string[],
  role: ResolvedRole,
  candidates: readonly Candidate[],
  context: NounContext,
): RunFound {
  let sets: NamedSet[] = [{ ids: [], near: 0, literal: 0, byName: 0, pronounNamed: [] }];
  for (const { start, end } of nounsOfRun(words)) {
    if (start === end) return { found: 'unfit', start, end };
    const found = nounIn(words.slice(start, end), role, candidates, context);
    if (found.found !== 'some') return { found: found.found, start, end };
    sets = sets.flatMap((set) =>
      found.things.map((thing) => {
        context.budget.spend();
        return {
          ids: set.ids.includes(thing.id) ? set.ids : [...set.ids, thing.id],
          near: set.near + thing.near,
          literal: set.literal + thing.literal,
          byName: set.byName + (thing.byName ? 1 : 0),
          pronounNamed:
            thing.pronoun === undefined
              ? set.pronounNamed
              : [...set.pronounNamed, { id: thing.id, pronoun: thing.pronoun }],
        };
      }),
    );
  }
  return { found: 'sets', sets };
}

/**
 * Where a run's nouns stand among its words, split at every connector, a
 * comma before `and` counting as one; an empty one where connectors stand
 * together otherwise, or at an end.
 */
export function nounsOfRun(words: readonly string[]): { start: number; end: number }[] {
  const nouns = [{ start: 0, end: 0 }];
  words.forEach((word, at) => {
    const last = nouns.at(-1)!;
    if (!CONNECTORS.includes(word)) last.end = at + 1;
    else if (word === 'and' && words[at - 1] === ',') last.start = last.end = at + 1;
    else nouns.push({ start: at + 1, end: at + 1 });
  });
  return nouns;
}

/** How the engine writes a thing, which is all a visitor has to tell two apart by. */
export function writtenAs(address: Address): string {
  return `${address.article} ${address.name.toLowerCase()}`;
}
