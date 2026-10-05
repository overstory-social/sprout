// The dark the sight specs are written about. The kitchen writes no
// `lit`, so it is lit, and holds a lamp. The cellar is lit while it sees
// a lit light source, and holds coal and a shut chest with a lantern in
// it. The vault is lit only while a beacon it cannot reach is lit, so it
// is always dark. `runtime/sight.spec.ts`, `runtime/darkness.spec.ts` and
// the dark cases of the describe, parser, offers and view specs share it.
// Spec support: the package build leaves it out.

import type { Bundle } from '../bundle/bundle.js';
import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { compiledWorld } from './bundle.js';
import { Budget } from '../runtime/budget.js';
import { catalogueOf } from '../runtime/catalogue.js';
import { Draft } from '../runtime/draft.js';
import { declaredId, visitKey, type InstanceId, type VisitKey } from '../runtime/ids.js';
import { initialState } from '../runtime/load.js';
import { passRules } from '../runtime/passes.js';
import { newInstance, type StateReader, type WorldState } from '../runtime/state.js';
import type { Value } from '../runtime/values.js';

export const DARK: Bundle = compiledWorld('dark', {
  'dark.sprout': `world dark is sprout.World {
  visitors are Person
  visitors arrive at kitchen

  object beacon is Lamp

  object kitchen is sprout.Place {
    grammar { exit down "down the cellar steps" -> cellar }
    object lamp is Lamp
  }

  object cellar is sprout.Place {
    grammar {
      lit (self.sees(sprout.LightSource, :lit))
      exit up "up to the kitchen" -> kitchen
    }
    describe { text "Damp stone." }
    object coal is sprout.Fixture
    object chest is sprout.Container {
      :open false
      object lantern is Lamp
    }
  }

  object vault is sprout.Place {
    grammar { lit (beacon.get(:lit)) }
  }
}
`,
  'lamp.sprout': 'kind Lamp is sprout.LightSource { grammar { nouns "lamp" } }\n',
  'person.sprout': 'kind Person is sprout.Visitor { }\n',
});

const at = (...path: string[]): InstanceId => declaredId('dark', path);
export const BEACON = at('beacon');
export const KITCHEN = at('kitchen');
export const LAMP = at('kitchen', 'lamp');
export const CELLAR = at('cellar');
export const COAL = at('cellar', 'coal');
export const CHEST = at('cellar', 'chest');
export const LANTERN = at('cellar', 'chest', 'lantern');
export const VAULT = at('vault');

export const DARK_CATALOGUE = catalogueOf(DARK, DEFAULT_LIMITS.caps);

export const MARTA: VisitKey = visitKey('v-marta');
export const INES: VisitKey = visitKey('v-ines');

/**
 * The dark as committed: a visitor standing where each visit is given,
 * each holding what `holding` gives them, and `set` written last.
 */
export function dark(
  standing: readonly (readonly [VisitKey, InstanceId])[] = [[MARTA, CELLAR]],
  set: readonly (readonly [InstanceId, string, Value])[] = [],
  holding: readonly (readonly [VisitKey, InstanceId])[] = [],
): WorldState {
  const draft = new Draft(initialState(DARK_CATALOGUE));
  const people = new Map<VisitKey, InstanceId>();
  for (const [visit, where] of standing) {
    const id = draft.mint();
    people.set(visit, id);
    draft.add(
      newInstance(
        id,
        { from: 'visitor' },
        DARK_CATALOGUE.visitorKind!,
        where,
        draft.nextSerial(),
        DARK_CATALOGUE.caps,
      ),
    );
    draft.putVisitor({
      visit,
      nickname: visit,
      instance: id,
      lastPlace: where,
      referents: [],
      lastReading: null,
    });
  }
  for (const [visit, thing] of holding) {
    draft.place(thing, people.get(visit)!);
  }
  for (const [id, name, value] of set) {
    const instance = draft.instance(id)!;
    draft.write({ ...instance, properties: new Map(instance.properties).set(name, value) });
  }
  return draft.commit().state;
}

/** The instance a visit stands as. */
export function personOf(state: WorldState, visit: VisitKey): InstanceId {
  return state.visitors.get(visit)!.instance;
}

/** What reading `state` takes: the state, the bundle, a fresh meter and the pass rules. */
export function darkContext(state: WorldState | StateReader) {
  const reader: StateReader = state instanceof Draft ? state : new Draft(state as WorldState);
  const budget = new Budget(DEFAULT_LIMITS.budgets);
  const passes = passRules({
    state: reader,
    kinds: DARK_CATALOGUE.lookup,
    caps: DARK_CATALOGUE.caps,
    budget,
    names: DARK_CATALOGUE.names,
  });
  return { state: reader, catalogue: DARK_CATALOGUE, budget, passes, nicknames: new Map() };
}
