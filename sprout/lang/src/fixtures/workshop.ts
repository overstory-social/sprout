// The workshop the standard library's own specs play turns in: nothing
// of its own but what composes the library's kinds, so what a turn says
// is the library's words. The chest is a `sprout.Container` and a
// `sprout.Lockable`, shut and locked, and only the key fits it; the
// crate is an open container that holds one thing; the anvil is a
// `sprout.Fixture`; the pin and the key lie loose. Marta and Ines stand
// in the hall. Spec support: the package build leaves it out.

import type { Bundle } from '../bundle/bundle.js';
import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { renderEffects } from '../prose/effects.js';
import { catalogueOf } from '../runtime/catalogue.js';
import { commandTurn, type CommandHost, type CommandTurn } from '../runtime/command.js';
import { Draft } from '../runtime/draft.js';
import { declaredId, visitKey, type InstanceId, type VisitKey } from '../runtime/ids.js';
import { initialState } from '../runtime/load.js';
import { parseCommand } from '../runtime/parser.js';
import { newInstance, type WorldState } from '../runtime/state.js';
import { compiledWorld } from './bundle.js';

export const WORKSHOP: Bundle = compiledWorld('workshop', {
  'workshop.sprout': `world workshop is sprout.World {
  visitors are Person
  visitors arrive at hall

  object hall is sprout.Place {
    object chest is Chest { :open false }
    object crate is sprout.Container { :capacity 1 }
    object anvil is sprout.Fixture
    object pin is Pin
    object key is Key
  }
}
`,
  'chest.sprout': `kind Chest is sprout.Container, sprout.Lockable {
  as target for unlock {
    permit { if (!tool.is(Key)) { refuse "That does not fit the lock." } }
  }
}
`,
  'pin.sprout': 'kind Pin { }\n',
  'key.sprout': 'kind Key { }\n',
  'person.sprout': 'kind Person is sprout.Visitor { }\n',
});

const at = (...path: string[]): InstanceId => declaredId('workshop', path);
export const HALL = at('hall');
export const CHEST = at('hall', 'chest');
export const CRATE = at('hall', 'crate');
export const ANVIL = at('hall', 'anvil');
export const PIN = at('hall', 'pin');
export const KEY = at('hall', 'key');

const CATALOGUE = catalogueOf(WORKSHOP, DEFAULT_LIMITS.caps);

export const MARTA: VisitKey = visitKey('v-marta');
export const INES: VisitKey = visitKey('v-ines');

/** The workshop as committed, Marta and then Ines standing in the hall. */
export function workshop(): WorldState {
  const draft = new Draft(initialState(CATALOGUE));
  for (const [visit, nickname] of [
    [MARTA, 'Marta'],
    [INES, 'Ines'],
  ] as const) {
    const id = draft.mint();
    draft.add(
      newInstance(
        id,
        { from: 'visitor' },
        CATALOGUE.visitorKind!,
        HALL,
        draft.nextSerial(),
        CATALOGUE.caps,
      ),
    );
    draft.putVisitor({ visit, nickname, instance: id, lastPlace: HALL });
  }
  return draft.commit().state;
}

/** The instance a visit acts as in `state`. */
export const actorOf = (state: WorldState, visit: VisitKey): InstanceId =>
  state.visitors.get(visit)!.instance;

const host = (): CommandHost => ({
  catalogue: CATALOGUE,
  budgets: DEFAULT_LIMITS.budgets,
  parse: parseCommand,
  render: renderEffects,
});

/** What one command turn left: the state it committed, and what each visitor read, by nickname. */
export interface Played {
  readonly state: WorldState;
  readonly read: Readonly<Record<string, string[]>>;
}

/** `text`, typed by `visit`, as one command turn over `state`; a fault is thrown. */
export function played(state: WorldState, visit: VisitKey, text: string): Played {
  const turn: CommandTurn = commandTurn(state, host(), {
    visit,
    text,
    seed: 7,
    mayHold: null,
    now: 0,
  });
  if (!turn.committed) throw new Error(`faulted: ${turn.fault.name}: ${turn.fault.detail}`);
  const read: Record<string, string[]> = {};
  for (const effect of turn.effects) {
    const who = turn.state.visitors.get(effect.visit)!.nickname;
    read[who] = [...(read[who] ?? []), ...effect.paragraphs];
  }
  return { state: turn.state, read };
}

/** Each command in turn, by `visit`, from `state`: the last turn's state, and what every turn was read as. */
export function playedAll(
  state: WorldState,
  commands: readonly (readonly [VisitKey, string])[],
): Played[] {
  const out: Played[] = [];
  let now = state;
  for (const [visit, text] of commands) {
    const turn = played(now, visit, text);
    out.push(turn);
    now = turn.state;
  }
  return out;
}
