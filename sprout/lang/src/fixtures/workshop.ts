// The workshop `runtime/command.spec.ts` plays the standard library in:
// nothing of its own but what composes the library's kinds, so what a turn says
// is the library's words. The chest is a `sprout.Container` and a
// `sprout.Lockable`, shut and locked, and only the key fits it; the
// crate is an open container that holds one thing; the anvil is a
// `sprout.Fixture`; the pin and the key lie loose, and a nail and a tack,
// both answering to "spike". Its intents: `pick` unlocks only what is
// locked, `heft` takes a thing and drops it, and `fling` tosses one thing
// as `toss`'s set of things. Marta and Ines stand in
// the hall. Spec support: the package build leaves it out.

import type { Bundle } from '../bundle/bundle.js';
import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { renderEffects } from '../prose/effects.js';
import { catalogueOf } from '../runtime/catalogue.js';
import { commandTurn, type CommandHost, type CommandTurn } from '../runtime/command.js';
import { runLine } from '../runtime/line.js';
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
    object nail is Pin { grammar { nouns "spike" } }
    object tack is Pin { grammar { nouns "spike" } }
  }
}
`,
  'chest.sprout': `kind Chest is sprout.Container, sprout.Lockable {
  as target for unlock {
    permit { if (!tool.is(Key)) { refuse "That does not fit the lock." } }
  }
}
`,
  'pick.sprout': `intent pick {
  "pick [y] with [x]"
  do unlock (target: y, tool: x) when (y.get(:locked))
}
intent heft { "heft [y]"  do take (target: y) then drop (target: y) }
intent fling { "fling [y]"  do toss (target: y) }
verb toss { role target many  "toss [target]" }
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

export const CATALOGUE = catalogueOf(WORKSHOP, DEFAULT_LIMITS.caps);

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
    draft.putVisitor({
      visit,
      nickname,
      instance: id,
      lastPlace: HALL,
      referents: [],
      lastReading: null,
    });
  }
  return draft.commit().state;
}

/** The instance a visit acts as in `state`. */
export const actorOf = (state: WorldState, visit: VisitKey): InstanceId =>
  state.visitors.get(visit)!.instance;

/** The host the workshop's turns run under: the spec's budgets and the command parser. */
export const host = (): CommandHost => ({
  catalogue: CATALOGUE,
  budgets: DEFAULT_LIMITS.budgets,
  parse: parseCommand,
  render: renderEffects,
});

/** What one line left: the state its last turn committed, what each visitor read, by nickname, and the verb of each step it ran. */
export interface Played {
  readonly state: WorldState;
  readonly read: Readonly<Record<string, string[]>>;
  readonly steps: readonly string[];
}

/**
 * `text`, typed by `visit`, over `state` seeded `seed`: every command turn
 * its line runs, as the host runs them, each after the first seeded one
 * more than the last. A fault is thrown.
 */
export function played(state: WorldState, visit: VisitKey, text: string, seed = 7): Played {
  const read: Record<string, string[]> = {};
  const steps: string[] = [];
  let now = state;
  let next = seed;
  runLine(
    { visit, text, seed, mayHold: null, now: 0 },
    (command) => {
      const turn: CommandTurn = commandTurn(now, host(), command);
      if (!turn.committed) throw new Error(`faulted: ${turn.fault.name}: ${turn.fault.detail}`);
      for (const effect of turn.effects) {
        const who = turn.state.visitors.get(effect.visit)!.nickname;
        read[who] = [...(read[who] ?? []), ...effect.paragraphs];
      }
      now = turn.state;
      if ('step' in turn.value && turn.value.step !== null) steps.push(turn.value.step.verb.name);
      return turn;
    },
    () => (next += 1),
  );
  return { state: now, read, steps };
}

/** Each command in turn, by `visit`, from `state`: the last turn's state, and what every turn was read as. */
export function playedAll(
  state: WorldState,
  commands: readonly (readonly [VisitKey, string])[],
  seed = 7,
): Played[] {
  const out: Played[] = [];
  let now = state;
  for (const [visit, text] of commands) {
    const turn = played(now, visit, text, seed);
    out.push(turn);
    now = turn.state;
  }
  return out;
}
