// The garden the wake specs are written about, and what they run a wake
// with. A rose grows a stage each time it wakes, keeping every second it
// is handed, and asks again until it is grown; a candle goes out when it
// wakes, and tells whoever is there; a fuse keeps its `elapsed` and holds at most 3, so any real
// wait faults it; a pod destroys itself when it wakes, and the seed
// inside it goes with it; a bulb and a lamp each glow at random when they
// wake. A visitor may carry a candle of their own.
// `runtime/wakes.spec.ts`, `runtime/wake.spec.ts` and
// `runtime/maintenance.spec.ts` share it. Spec support: the package build
// leaves it out.

import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { catalogueOf } from '../runtime/catalogue.js';
import { Draft } from '../runtime/draft.js';
import { declaredId, visitKey, type InstanceId } from '../runtime/ids.js';
import { initialState } from '../runtime/load.js';
import { newInstance, type PendingWake, type WorldState } from '../runtime/state.js';
import type { TurnHost } from '../runtime/turn.js';
import type { Value } from '../runtime/values.js';
import { compiledWorld } from './bundle.js';

export const GARDEN = compiledWorld('garden', {
  'world.sprout': `world garden is sprout.World {
  visitors are Person
  visitors arrive at bed

  object bed is sprout.Place {
    object rose is Rose
    object candle is Candle
    object fuse is Fuse
    object pod is Pod {
      object seed is Candle
    }
    object bulb is Bulb
    object lamp is Bulb
  }
}
`,
  'person.sprout': 'kind Person is sprout.Visitor { contains }\n',
  'rose.sprout': `kind Rose {
  :stage 0 min 0 max 3
  :grown 0 min 0 max 1000000
  on :woke (elapsed) {
    self.adjust(:grown, elapsed)
    self.adjust(:stage, 1)
    if (self.get(:stage) < 3) { wake in 2 hours }
  }
}
`,
  'candle.sprout': `kind Candle {
  :lit true
  on :woke {
    self.set(:lit, false)
    tell "{self} gutters out."
  }
}
`,
  'fuse.sprout': `kind Fuse {
  :burnt 0 min 0 max 3
  on :woke (elapsed) { self.set(:burnt, elapsed) }
}
`,
  'bulb.sprout': `kind Bulb {
  :glow 0 min 0 max 999
  on :woke { self.set(:glow, random(1000)) }
}
`,
  'pod.sprout': `kind Pod {
  contains
  on :woke { destroy self }
}
`,
});

export const CATALOGUE = catalogueOf(GARDEN, DEFAULT_LIMITS.caps);
export const HOST: TurnHost = { catalogue: CATALOGUE, budgets: DEFAULT_LIMITS.budgets };
const at = (...path: string[]): InstanceId => declaredId('garden', path);
export const BED = at('bed');
export const ROSE = at('bed', 'rose');
export const CANDLE = at('bed', 'candle');
export const FUSE = at('bed', 'fuse');
export const POD = at('bed', 'pod');
export const SEED = at('bed', 'pod', 'seed');
export const BULB = at('bed', 'bulb');
export const LAMP = at('bed', 'lamp');
export const MARTA = visitKey('v-marta');

/** A wake to ask for: on `object`, asked at `askedAt` and due at `dueAt`. */
export type Asking = readonly [object: InstanceId, askedAt: number, dueAt: number];

/**
 * The garden with a visitor where `marta` says: standing in the bed,
 * away, or not there at all, carrying a candle of their own. Then each
 * wake in `asking` is pending, as `asked` adds it.
 */
export function garden(
  asking: readonly Asking[],
  marta: 'bed' | 'away' | null = null,
): { state: WorldState; carried: InstanceId | null } {
  const draft = new Draft(initialState(CATALOGUE));
  let carried: InstanceId | null = null;
  if (marta !== null) {
    const id = draft.mint();
    const where = marta === 'bed' ? BED : null;
    draft.add(
      newInstance(
        id,
        { from: 'visitor' },
        CATALOGUE.visitorKind!,
        where,
        where === null ? null : draft.nextSerial(),
        CATALOGUE.caps,
      ),
    );
    draft.putVisitor({ visit: MARTA, nickname: 'Marta', instance: id, lastPlace: BED });
    carried = draft.mint();
    draft.add(
      newInstance(
        carried,
        { from: 'spawned', kind: 'garden.Candle' },
        CATALOGUE.kinds.get('garden.Candle')!,
        id,
        draft.nextSerial(),
        CATALOGUE.caps,
      ),
    );
  }
  return { state: asked(draft.commit().state, asking), carried };
}

/** `state` with each wake in `asking` pending as well, each under the next serial. */
export function asked(state: WorldState, asking: readonly Asking[]): WorldState {
  const draft = new Draft(state);
  for (const [object, askedAt, dueAt] of asking) {
    const instance = draft.instance(object)!;
    const wake: PendingWake = { serial: draft.nextSerial(), askedAt, dueAt };
    draft.write({ ...instance, wakes: [...instance.wakes, wake] });
  }
  return draft.commit().state;
}

/** A property of `id` as `state` holds it. */
export const heldIn = (state: WorldState, id: InstanceId, name: string): Value | undefined =>
  state.instances.get(id)?.properties.get(name);

/** The wakes `id` has pending in `state`. */
export const wakesOf = (state: WorldState, id: InstanceId): readonly PendingWake[] =>
  state.instances.get(id)?.wakes ?? [];
