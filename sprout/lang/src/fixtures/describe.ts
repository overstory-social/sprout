// The study the description specs look around, one kind per file, and
// what they run and read a turn with: the committed state with Marta in
// the hall, the host reading commands with the command parser, and what
// the engine answered, rendered for its reader. The hall says whether it
// holds the box and when it is crowded, and leads north to the loft; the
// lamp is described by whether it is lit and refuses to be pulled once it
// is; the mirror names whoever looks; the stool has no describe; the
// blank's describe says nothing until it is shown; the cat is an NPC that
// hears what it is asked about; and the cellar has no describe. The
// `runtime/describe.spec.ts`, `runtime/offers.spec.ts`,
// `runtime/engine-verbs.spec.ts` and `prose/describe.spec.ts` share it.
// Spec support: the package build leaves it out.

import type { Bundle } from '../bundle/bundle.js';
import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { WORLD_PASSES_ANYTHING } from '../declare/world.js';
import { renderDescription } from '../prose/describe.js';
import { renderHeard } from '../prose/heard.js';
import { LineDraws } from '../prose/line-draws.js';
import type { RenderContext } from '../prose/render.js';
import { Budget } from '../runtime/budget.js';
import { catalogueOf } from '../runtime/catalogue.js';
import { commandTurn, type CommandHost, type CommandTurn } from '../runtime/command.js';
import type { DescribeContext } from '../runtime/describe.js';
import { Draft } from '../runtime/draft.js';
import { Draws } from '../runtime/draws.js';
import type { Unrendered } from '../runtime/effects.js';
import { declaredId, visitKey, type InstanceId, type VisitKey } from '../runtime/ids.js';
import { initialState } from '../runtime/load.js';
import { parseCommand } from '../runtime/parser.js';
import { newInstance, readerOf, type WorldState } from '../runtime/state.js';
import type { Value } from '../runtime/values.js';
import { compiledWorld } from './bundle.js';
import { renderEffects } from '../prose/effects.js';

export const STUDY: Bundle = compiledWorld('study', {
  'study.sprout': `world study is sprout.World {
  visitors are Person
  visitors arrive at hall

  object hall is sprout.Place {
    grammar { exit north "up the stair" -> loft }
    describe {
      let count = self.count
      text "A long hall."
      if (self.holds(box)) { text "A box stands by the wall." }
      if (count > 7) { text "It is crowded, with {count} in it." }
    }
    object lamp is Lamp
    object mirror is Mirror
    object stool is Plain
    object blank is Blank
    object box is Box { object pin is Plain }
    object cat is Cat
  }
  object loft is sprout.Place {
    grammar { exit down "down the stair" -> hall }
    describe { text "Rafters, and dust." }
  }
  object cellar is sprout.Place
}

verb pull { role target  "pull [target]" }
verb ask  { role target  role topic: symbol  "ask [target] about [topic]" }
`,
  'lamp.sprout': `kind Lamp {
  :lit false
  describe {
    if (self.get(:lit)) { text "The lamp burns." }
    else { text dark }
    text "It hangs from a hook."
  }
  passage dark { The lamp is dark. }
  as target for pull {
    permit { if (self.get(:lit)) { refuse "It is already lit." } }
    do { self.set(:lit, true)  say "The lamp catches." }
  }
}
`,
  'mirror.sprout': `kind Mirror {
  describe { text greeting }
  passage greeting { The glass shows {actor}, in {here}. }
}
`,
  'plain.sprout': 'kind Plain { }\n',
  'blank.sprout': `kind Blank {
  :shown false
  describe { if (self.get(:shown)) { text "A card, now written on." } }
}
`,
  'box.sprout': 'kind Box { contains }\n',
  'cat.sprout': `kind Cat is sprout.Actor {
  :knows [Topic] default [mice]
  as target for ask {
    topic from :knows
    do { say "The cat considers it." }
  }
}
enum Topic { mice, rain }
`,
  'person.sprout': 'kind Person is sprout.Visitor { }\n',
});

const at = (...path: string[]): InstanceId => declaredId('study', path);
export const HALL = at('hall');
export const LAMP = at('hall', 'lamp');
export const MIRROR = at('hall', 'mirror');
export const STOOL = at('hall', 'stool');
export const BLANK = at('hall', 'blank');
export const BOX = at('hall', 'box');
export const PIN = at('hall', 'box', 'pin');
export const CAT = at('hall', 'cat');
export const LOFT = at('loft');
export const CELLAR = at('cellar');

export const CATALOGUE = catalogueOf(STUDY, DEFAULT_LIMITS.caps);

/** The host, reading commands with the command parser. */
export const studyHost = (): CommandHost => ({
  catalogue: CATALOGUE,
  budgets: DEFAULT_LIMITS.budgets,
  parse: parseCommand,
  render: renderEffects,
});

export const MARTA: VisitKey = visitKey('v-marta');
export const INES: VisitKey = visitKey('v-ines');

/** The study as committed, each visitor standing where given, nicknamed as given, and `set` written first. */
export function study(
  standing: readonly (readonly [VisitKey, InstanceId, string])[] = [[MARTA, HALL, 'Marta']],
  set: readonly (readonly [InstanceId, string, Value])[] = [],
): WorldState {
  const draft = new Draft(initialState(CATALOGUE));
  for (const [visit, where, nickname] of standing) {
    const id = draft.mint();
    draft.add(
      newInstance(
        id,
        { from: 'visitor' },
        CATALOGUE.visitorKind!,
        where,
        draft.nextSerial(),
        CATALOGUE.caps,
      ),
    );
    draft.putVisitor({ visit, nickname, instance: id, lastPlace: where });
  }
  for (const [id, name, value] of set) {
    const instance = draft.instance(id)!;
    draft.write({ ...instance, properties: new Map(instance.properties).set(name, value) });
  }
  return draft.commit().state;
}

/** The instance a visit acts as in `state`. */
export const actorOf = (state: WorldState, visit: VisitKey): InstanceId =>
  state.visitors.get(visit)!.instance;

/** Each visitor's nickname in `state`, by the instance that is them. */
export const nicknamesOf = (state: WorldState): ReadonlyMap<InstanceId, string> =>
  new Map([...state.visitors.values()].map((one) => [one.instance, one.nickname]));

/** What describing and offering read over the committed `state`, under a fresh budget. */
export function lookingAt(state: WorldState): DescribeContext & {
  readonly nicknames: ReadonlyMap<InstanceId, string>;
} {
  return {
    state: readerOf(state),
    catalogue: CATALOGUE,
    budget: new Budget(DEFAULT_LIMITS.budgets, 'poll'),
    passes: (container) => (container === state.world ? WORLD_PASSES_ANYTHING : true),
    nicknames: nicknamesOf(state),
  };
}

/** What rendering reads over `state`: its names, a fresh budget, and no draws, as a poll renders. */
export function renderingIn(state: WorldState, seed: number | null = null): RenderContext {
  return {
    ...lookingAt(state),
    draws: seed === null ? null : new LineDraws(new Draws(seed)),
  };
}

/** `text`, typed by `visit`, as one command turn over `state`; a fault is thrown. */
export function typedIn(state: WorldState, visit: VisitKey, text: string) {
  const turn: CommandTurn = commandTurn(state, studyHost(), {
    visit,
    text,
    seed: 7,
    mayHold: null,
    now: 0,
  });
  if (!turn.committed) throw new Error(`faulted: ${turn.fault.name}: ${turn.fault.detail}`);
  return turn;
}

/** What the engine answered a committed turn, if it acted. */
export function answersOf(turn: ReturnType<typeof typedIn>): readonly Unrendered[] {
  const done = turn.value;
  if (!('acted' in done)) throw new Error('the turn did not act');
  return done.answers;
}

/** Each answer as its reader reads it, rendered over the turn's committed state: who, and the paragraphs. */
export function readAnswers(turn: ReturnType<typeof typedIn>): [InstanceId, string[]][] {
  const context = renderingIn(turn.state, 7);
  return answersOf(turn).map((answer) => {
    if ('description' in answer) {
      const heard = renderDescription(answer.description, context);
      return [heard.reader, [...heard.paragraphs]];
    }
    const [heard] = renderHeard(answer.said, context);
    return [heard!.reader, [...heard!.paragraphs]];
  });
}
