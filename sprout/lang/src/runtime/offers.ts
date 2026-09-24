// What an actor can do where they stand (the spec's Verbs › Engine verbs:
// `help`; The runtime › The view). Every verb a visitor may type is
// offered once for each way its roles fill from what is in range: a role a
// thing fills, by each thing in range it fits but the actor, a set role by
// each such thing alone, and `go`'s way by each exit that applies. A tool
// is left out and a value role left unbound, which a body reads only
// inside `if (bound …)` and a `from` may leave so anyway. Each offer is
// typed by its verb's first phrase that fits, with the consent pass's
// answer beside it, and costs a step, so a world too large to list faults
// as any work does.

import type { ResolvedRole, ResolvedVerb } from '../declare/verbs.js';
import type { InstanceId } from './ids.js';
import { liveTree } from './live.js';
import { rangeOf } from './range.js';
import {
  consentPass,
  type Bound,
  type ConsentContext,
  type PermitRefusal,
  type Reading,
} from './reading.js';
import { exitsFrom } from './exits.js';
import { addressOf, type AddressContext } from './parser/address.js';
import { fits } from './parser/nouns.js';
import type { TypedPhrase } from './parser/phrases.js';
import type { Instance } from './state.js';

/** What offering reads: what the consent pass does, and each visitor's nickname. */
export interface OfferContext extends ConsentContext {
  readonly nicknames: ReadonlyMap<InstanceId, string>;
}

/** One reading the actor could type now. */
export interface Offer {
  readonly reading: Reading;
  /** The line that types it, each filled slot as a visitor types it and a value role's as `…`. */
  readonly typed: string;
  /** Its consent pass's refusal; null where every participant consents. */
  readonly refused: PermitRefusal | null;
}

/** One way to fill one role: bound, with the words that type it, or left unbound. */
type Filling = { readonly bound: Bound; readonly words: string } | null;

/** Every reading `actor` could type where they stand, in the order the parser tries the verbs. */
export function offersTo(actor: InstanceId, context: OfferContext): Offer[] {
  const { state, budget, passes } = context;
  const here = state.instance(actor)?.container ?? null;
  if (here === null) throw new Error(`\`${actor}\` is away, and an away visitor can do nothing.`);
  const addressing: AddressContext = { world: state.world, nicknames: context.nicknames };
  const range = rangeOf({ tree: liveTree(state), passes, budget }, actor, 'any');
  const things = range.reached.flatMap(({ node }) => {
    const instance = node === state.world || node === actor ? undefined : state.instance(node);
    return instance === undefined ? [] : [instance];
  });
  const exits = exitsFrom(here, context);

  const offers: Offer[] = [];
  for (const [verb, phrases] of byVerb(context.catalogue.phrases)) {
    const each = verb.roles.map((role): Filling[] => {
      if (role.filler?.fills === 'exit') {
        return exits.map((exit) => ({ bound: { exit }, words: exit.direction }));
      }
      if (role.optional || role.filler?.fills === 'symbol' || role.filler?.fills === 'integer') {
        return [null];
      }
      return things
        .filter((thing) => fits(role, thing))
        .map((thing) => ({
          bound: role.many ? { set: [thing.id] } : { object: thing.id },
          words: wordsFor(thing, addressing),
        }));
    });
    for (const filled of product(each)) {
      budget.spend();
      if (fillsTwice(filled)) continue;
      const phrase = phrases.find((one) => typesAll(one, verb.roles, filled));
      if (phrase === undefined) continue;
      const bindings = new Map<string, Bound>();
      verb.roles.forEach((role, at) => {
        const filling = filled[at];
        if (filling !== null && filling !== undefined) bindings.set(role.name, filling.bound);
      });
      const reading: Reading = { verb, actor, bindings };
      offers.push({
        reading,
        typed: typed(phrase, filled),
        refused: consentPass(reading, context),
      });
    }
  }
  return offers;
}

/** The phrases of each verb, in the order the parser tries them, each verb at its first. */
function byVerb(phrases: readonly TypedPhrase[]): Map<ResolvedVerb, TypedPhrase[]> {
  const verbs = new Map<ResolvedVerb, TypedPhrase[]>();
  for (const phrase of phrases) {
    const known = verbs.get(phrase.verb) ?? [];
    known.push(phrase);
    verbs.set(phrase.verb, known);
  }
  return verbs;
}

/** Every combination of one filling from each role's, in order; one empty one for a verb with no roles. */
function product(each: readonly (readonly Filling[])[]): Filling[][] {
  let combined: Filling[][] = [[]];
  for (const options of each) {
    combined = combined.flatMap((partial) => options.map((one) => [...partial, one]));
  }
  return combined;
}

/** Whether one thing fills two of an offer's roles. */
function fillsTwice(filled: readonly Filling[]): boolean {
  const things = filled.flatMap((one) =>
    one === null
      ? []
      : 'object' in one.bound
        ? [one.bound.object]
        : 'set' in one.bound
          ? one.bound.set
          : [],
  );
  return new Set(things).size < things.length;
}

/** Whether `phrase` types every role `filled` binds, and has no slot for one it leaves unbound but a value role's. */
function typesAll(
  phrase: TypedPhrase,
  roles: readonly ResolvedRole[],
  filled: readonly Filling[],
): boolean {
  const slots = new Set(phrase.parts.flatMap((part) => ('slot' in part ? [part.slot] : [])));
  return roles.every((role, at) => {
    const value = role.filler?.fills === 'symbol' || role.filler?.fills === 'integer';
    return filled[at] === null ? value || !slots.has(at) : slots.has(at);
  });
}

/** The line a phrase types with `filled` in its slots, a value role's written as `…`. */
function typed(phrase: TypedPhrase, filled: readonly Filling[]): string {
  return phrase.parts
    .map((part) => ('slot' in part ? (filled[part.slot]?.words ?? '…') : part.words.join(' ')))
    .join(' ');
}

/** A thing as a visitor types it: its name, as the engine writes it after its article. */
function wordsFor(thing: Instance, addressing: AddressContext): string {
  return addressOf(thing, addressing).name;
}
