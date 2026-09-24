// The harbour the arrival and departure specs are written about, one kind
// per file, and what they run a turn with. Visitors arrive at the quay,
// which counts who comes and goes, faults either way once it is set to,
// and turns everyone away while it is closed; a gull on the quay counts
// who it sees arrive and leave; the loft bars its door while it is shut;
// the cellar's kind lives in `cellar.sprout`, so withholding it at load
// leaves the cellar absent. A person counts every move they make.
// `runtime/arrival.spec.ts`, `runtime/departure.spec.ts` and core's turn
// specs share it. Spec support: the package build leaves it out.

import type { Bundle } from '../bundle/bundle.js';
import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { compiledWorld } from './bundle.js';
import type { Arrival } from '../runtime/arrival.js';
import { catalogueOf, type Catalogue } from '../runtime/catalogue.js';
import type { CommandHost } from '../runtime/command.js';
import type { Departure } from '../runtime/departure.js';
import { Draft } from '../runtime/draft.js';
import { declaredId, visitKey, type InstanceId, type VisitKey } from '../runtime/ids.js';
import { initialState } from '../runtime/load.js';
import { parseCommand } from '../runtime/parser.js';
import { newInstance, type WorldState } from '../runtime/state.js';
import type { Value } from '../runtime/values.js';

export const HARBOUR_FILES: Readonly<Record<string, string>> = {
  'world.sprout': `world harbour is sprout.World {
  visitors are Person
  visitors arrive at quay

  object quay is Quay {
    object gull is Gull
  }
  object loft is Gated { }
  object cellar is Cellar { }
}
`,
  'quay.sprout': `kind Quay is sprout.Place {
  :arrivals 0 min 0 max 99
  :departures 0 min 0 max 99
  :boom false
  :closed false
  accept (item, from) { if (self.get(:closed)) { refuse "The quay is closed for the tide." } }
  on :entered (item, from) {
    self.adjust(:arrivals, 1)
    if (self.get(:boom) && 2147483647 + 1 > 0) { self.adjust(:arrivals, 1) }
  }
  on :left (item, to) {
    self.adjust(:departures, 1)
    if (self.get(:boom) && 2147483647 + 1 > 0) { self.adjust(:departures, 1) }
  }
}
`,
  'gull.sprout': `kind Gull is sprout.Actor {
  :seen 0 min 0 max 99
  :gone 0 min 0 max 99
  on :arrived (actor, from) { self.adjust(:seen, 1) }
  on :departed (actor, to) { self.adjust(:gone, 1) }
}
`,
  'gated.sprout': `kind Gated is sprout.Place {
  :shut false
  accept (item, from) { if (self.get(:shut)) { refuse "The door is barred." } }
}
`,
  'cellar.sprout': 'kind Cellar is sprout.Place { }\n',
  'traveller.sprout': `kind Traveller is sprout.Actor {
  :moves 0 min 0 max 99
  on :moved (from, to) { self.adjust(:moves, 1) }
}
`,
  'person.sprout': 'kind Person is Traveller, sprout.Visitor { }\n',
};

export const HARBOUR: Bundle = compiledWorld('harbour', HARBOUR_FILES);

/** The harbour loaded with `cellar.sprout` withheld: the cellar is absent. */
export const HARBOUR_NO_CELLAR: Bundle = compiledWorld('harbour', HARBOUR_FILES, {
  mode: 'load',
  withheld: ['cellar.sprout'],
});

const at = (...path: string[]): InstanceId => declaredId('harbour', path);
export const WORLD = at();
export const QUAY = at('quay');
export const GULL = at('quay', 'gull');
export const LOFT = at('loft');
export const CELLAR = at('cellar');

export const CATALOGUE = catalogueOf(HARBOUR, DEFAULT_LIMITS.caps);
export const NO_CELLAR = catalogueOf(HARBOUR_NO_CELLAR, DEFAULT_LIMITS.caps);

/** The host over `catalogue`, reading commands with the command parser. */
export const harbourHost = (catalogue: Catalogue = CATALOGUE): CommandHost => ({
  catalogue,
  budgets: DEFAULT_LIMITS.budgets,
  parse: parseCommand,
});

export const MARTA: VisitKey = visitKey('v-marta');
export const INES: VisitKey = visitKey('v-ines');

/** What each visitor is: where they stand, or away having last stood at `lastPlace`. */
export type Standing =
  | { readonly visit: VisitKey; readonly in: InstanceId }
  | { readonly visit: VisitKey; readonly away: InstanceId | null };

/**
 * The harbour as committed under `catalogue`, with a visitor for each
 * standing given, called by the visit's name after `v-`, and `set`
 * written first.
 */
export function harbour(
  standing: readonly Standing[] = [],
  set: readonly (readonly [InstanceId, string, Value])[] = [],
  catalogue: Catalogue = CATALOGUE,
): WorldState {
  const draft = new Draft(initialState(catalogue));
  for (const one of standing) {
    const id = draft.mint();
    const where = 'in' in one ? one.in : null;
    const arrival = where === null ? null : draft.nextSerial();
    draft.add(
      newInstance(id, { from: 'visitor' }, catalogue.visitorKind!, where, arrival, catalogue.caps),
    );
    draft.putVisitor({
      visit: one.visit,
      nickname: nicknameOf(one.visit),
      instance: id,
      lastPlace: 'in' in one ? one.in : one.away,
    });
  }
  for (const [id, name, value] of set) {
    const instance = draft.instance(id)!;
    draft.write({ ...instance, properties: new Map(instance.properties).set(name, value) });
  }
  return draft.commit().state;
}

/** `v-marta` is Marta. */
export const nicknameOf = (visit: VisitKey): string =>
  visit.slice(2, 3).toUpperCase() + visit.slice(3);

/** An arrival's inputs, at the host's instant 0, with no bound on instances. */
export const arriving = (visit: VisitKey, nickname = nicknameOf(visit), seed = 7): Arrival => ({
  visit,
  nickname,
  seed,
  mayHold: null,
  now: 0,
});

/** A departure's inputs, at the host's instant 0, with no bound on instances. */
export const departing = (visit: VisitKey, seed = 7): Departure => ({
  visit,
  seed,
  mayHold: null,
  now: 0,
});

/** A property of `id` as `state` holds it. */
export const heldIn = (state: WorldState, id: InstanceId, name: string): Value | undefined =>
  state.instances.get(id)?.properties.get(name);

/** Where `visit`'s visitor stands in `state`, null while away. */
export const whereIs = (state: WorldState, visit: VisitKey): InstanceId | null =>
  state.instances.get(state.visitors.get(visit)!.instance)!.container;
