// The belfry the turn specs are written about, one kind per file, and
// what they run a turn with: the committed state with a visitor in the
// hall, the host, a parser that reads `verb noun` against the hall's
// declared objects, and what a turn said to whom. A creature's own part
// counts what it did and speaks first; a bell rung is struck in its
// `do`, and what the actor sent it arrives after, then stirs the dog, an
// NPC whose sniff the visitor hears; a gong struck overflows after the
// actor has written and spawned; a drum beaten echoes past the cascade
// depth; a muffled bell refuses; a stone tapped says nothing; a coin
// flipped draws its face, its count and its words. The
// `runtime/turn.spec.ts`, `runtime/command.spec.ts` and
// `runtime/faults.spec.ts` share it. Spec support: the package build
// leaves it out.

import type { Bundle } from '../bundle/bundle.js';
import { DEFAULT_LIMITS, type RuntimeBudgets } from '../bundle/limits.js';
import { compiledWorld } from './bundle.js';
import { catalogueOf } from '../runtime/catalogue.js';
import type { CommandHost, CommandTurn, Parser } from '../runtime/command.js';
import { Draft } from '../runtime/draft.js';
import { declaredId, visitKey, type InstanceId, type VisitKey } from '../runtime/ids.js';
import { initialState } from '../runtime/load.js';
import type { Said } from '../runtime/reading.js';
import { newInstance, type WorldState } from '../runtime/state.js';
import type { Value } from '../runtime/values.js';
import { words } from './reading.js';

export const BELFRY: Bundle = compiledWorld('belfry', {
  'world.sprout': `world belfry is sprout.World {
  visitors are Person
  visitors arrive at hall

  object hall is sprout.Place {
    object bell is Bell
    object gong is Gong
    object drum is Drum
    object muffled is Muffled
    object stone is Stone
    object dog is Dog
    object coin is Coin
  }
  object loft is sprout.Place { }
}

message :rung
message :stir
message :echo with integer

verb ring   { role target  "ring [target]" }
verb strike { role target  "strike [target]" }
verb beat   { role target  "beat [target]" }
verb tap    { role target  "tap [target]" }
verb sniff  { role target  "sniff [target]" }
verb flip   { role target  "flip [target]" }
`,
  'creature.sprout': `// Whoever rings, strikes or beats counts it and says so, before any
// role-player's part runs; ringing also tells the bell, by message.
kind Creature is sprout.Actor {
  :done 0 min 0 max 99
  as actor for ring   { do { self.adjust(:done, 1)  send target :rung  say "You pull the rope." } }
  as actor for strike { do { self.adjust(:done, 1)  spawn Chip in here  say "You swing." } }
  as actor for beat   { do { self.adjust(:done, 1)  say "You raise the stick." } }
}
`,
  'person.sprout': 'kind Person is Creature, sprout.Visitor { }\n',
  'bell.sprout': `// A bell is struck in its own part, and hears it was rung once the queue
// drains: by then its part has run, whatever order the sends were made in.
kind Bell {
  :struck false
  :heard_struck false
  as target for ring { do { self.set(:struck, true)  say "The bell sounds." } }
  on :rung {
    self.set(:heard_struck, self.get(:struck))
    send hall.dog :stir
  }
}
`,
  'gong.sprout': `// Striking the gong dents it, then overflows.
kind Gong {
  :dents 0 min 0 max 99
  as target for strike {
    do {
      self.adjust(:dents, 1)
      if (2147483647 + 1 > 0) { say "The gong shatters the air." }
    }
  }
}
`,
  'chip.sprout': 'kind Chip { }\n',
  'drum.sprout': `// A beaten drum echoes itself until the cascade runs out.
kind Drum {
  :beats 0 min 0 max 99
  :echoes 0 min 0 max 99
  as target for beat { do { self.adjust(:beats, 1)  send self :echo with 1  say "Boom." } }
  on :echo (_, n) {
    self.set(:echoes, n)
    send self :echo with n + 1
  }
}
`,
  'muffled.sprout': `kind Muffled {
  as target for ring { permit { refuse "The bell is wrapped in felt." } }
}
`,
  'stone.sprout': `// Tapping a stone does something and says nothing.
kind Stone {
  :taps 0 min 0 max 99
  as target for tap { do { self.adjust(:taps, 1) } }
}
`,
  'dog.sprout': `// The dog, stirred, sniffs the bell: a reading of its own, heard by the room.
kind Dog is sprout.Actor {
  :sniffs 0 min 0 max 99
  on :stir { act sniff (target: hall.bell) }
  as actor for sniff { do { self.adjust(:sniffs, 1)  say "The dog sniffs at the bell." } }
}
`,
  'coin.sprout': `// A flipped coin lands on a face and says how, all of it drawn.
kind Coin {
  :face 0 min 0 max 5
  :heads 0 min 0 max 99
  as target for flip {
    do {
      self.set(:face, random(6))
      if (chance(2)) { self.adjust(:heads, 1) }
      say "{one of}It spins.{or}It rings.{or}It rolls away.{/one of}"
    }
  }
}
`,
});

const at = (...path: string[]): InstanceId => declaredId('belfry', path);
export const WORLD = at();
export const HALL = at('hall');
export const LOFT = at('loft');
export const BELL = at('hall', 'bell');
export const GONG = at('hall', 'gong');
export const DRUM = at('hall', 'drum');
export const MUFFLED = at('hall', 'muffled');
export const STONE = at('hall', 'stone');
export const DOG = at('hall', 'dog');
export const COIN = at('hall', 'coin');

export const CATALOGUE = catalogueOf(BELFRY, DEFAULT_LIMITS.caps);

/** The hall's declared objects, by the word the parser below reads them by. */
const NOUNS: Readonly<Record<string, InstanceId>> = {
  bell: BELL,
  gong: GONG,
  drum: DRUM,
  muffled: MUFFLED,
  stone: STONE,
  dog: DOG,
  coin: COIN,
};

/**
 * A parser that reads `verb noun`, one step a word, against the hall's
 * declared objects, and answers anything else with the world's
 * `unknown`. It stands where the parser proper will.
 */
export const parseBelfry: Parser = (text, actor, context) => {
  const typed = text.split(' ');
  context.budget.spend(typed.length);
  const [verb, noun] = typed;
  const resolved = verb === undefined ? null : BELFRY.verbs.qualified('belfry', verb);
  const target = noun === undefined ? undefined : NOUNS[noun];
  if (resolved === null || target === undefined || typed.length !== 2) {
    const unknown = context.state.instance(context.state.world)!.kind.passages.get('unknown')!;
    return {
      answered: {
        effect: 'notice',
        to: [actor],
        by: context.state.world,
        speaker: null,
        said: { passage: unknown },
        bindings: new Map(),
      },
      choices: [],
    };
  }
  return {
    reading: { verb: resolved, actor, bindings: new Map([['target', { object: target }]]) },
  };
};

/** The host, under `budgets`, reading commands with `parse`. */
export function belfryHost(
  budgets: RuntimeBudgets = DEFAULT_LIMITS.budgets,
  parse: Parser = parseBelfry,
): CommandHost {
  return { catalogue: CATALOGUE, budgets, parse };
}

/** Marta's visit, and the instance she is. */
export const MARTA: VisitKey = visitKey('v-marta');
export const INES: VisitKey = visitKey('v-ines');

/**
 * The belfry as committed, with a visitor standing in the hall for each
 * visit given, and a visitor record for each, and one for `INES` away
 * where `away` says so.
 */
export function belfry(visits: readonly VisitKey[] = [MARTA], away = false): WorldState {
  const draft = new Draft(initialState(CATALOGUE));
  const place = (visit: VisitKey, where: InstanceId | null): void => {
    const id = draft.mint();
    const arrival = where === null ? null : draft.nextSerial();
    draft.add(
      newInstance(id, { from: 'visitor' }, CATALOGUE.visitorKind!, where, arrival, CATALOGUE.caps),
    );
    draft.putVisitor({ visit, nickname: visit, instance: id, lastPlace: where });
  };
  for (const visit of visits) place(visit, HALL);
  if (away) place(INES, null);
  return draft.commit().state;
}

/** The instance a visit acts as in `state`. */
export const actorOf = (state: WorldState, visit: VisitKey): InstanceId =>
  state.visitors.get(visit)!.instance;

/** A property of `id` as `state` holds it. */
export const heldIn = (state: WorldState, id: InstanceId, name: string): Value | undefined =>
  state.instances.get(id)?.properties.get(name);

/** A command's write inputs, at the host's instant 0, with no bound on instances. */
export const typed = (visit: VisitKey, text: string, seed = 7, now = 0) => ({
  visit,
  text,
  seed,
  mayHold: null,
  now,
});

/**
 * Every line a command turn said, in order, with who reads it and its
 * words; a consent pass's refusal is said to `actor`.
 */
export function toldBy(
  turn: CommandTurn,
  actor: InstanceId,
): { to: readonly InstanceId[]; words: string }[] {
  const shown = (line: Said) => ({ to: line.to, words: words(line.said) });
  if (!turn.committed) return [shown(turn.told)];
  const done = turn.value;
  if ('answered' in done) return [shown(done.answered)];
  if ('refused' in done) return [{ to: [actor], words: words(done.refused.said) }];
  if ('displaced' in done) return [shown(done.displaced.told)];
  return [...done.acted.said, ...done.drained.said].map(shown);
}

/** The world's `fault`, as `words` shows it. */
export const FAULT =
  'sprout.World fault: Something in this world has gone wrong, and nothing has changed.';
