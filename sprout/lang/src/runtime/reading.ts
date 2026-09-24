// A reading, run (the spec's Verbs › The two passes, Playing a role, The
// actor's own part, Roles compose, Set roles, Optional tools, Value roles,
// A role-player narrows its own options, Acting; Prose; Other people ›
// Who hears it).
//
// A reading is a verb, an actor, and its roles filled. Its participants
// are the actor first and then each role's players in the order the verb
// declares its roles, and each runs every play its kind composes for that
// role, in composition order. The consent pass runs every `permit`, only
// reading, and the first refusal is the reading's whole outcome; the
// effect pass then runs every `do` in the same order; in a reading of the
// engine's `go` it first moves the actor through the exit named, and a
// refusal of that move ends the pass (Engine verbs). What a `do` says,
// and the refusal of a `move` it proposes, reach the actor, or, where the
// actor is an NPC, whoever would hear its `tell`, from it, and a refused
// `move` or `act` ends the `do` that ran it, not the pass; a person's
// command that said nothing to them is answered with the world's
// `nothing_happens`, and an NPC's reading is not. An `act` in a `do` runs
// its own reading there, one deeper against the cascade depth, and what
// that says, refusal included, joins this one's. A plain `tell` reaches
// the people in the teller's place less every participant, and `tell <x>`
// reaches `x` where `x` is in the teller's range (`audience.ts`). What
// the effect pass says, tells and sends is kept in body order. Nothing is
// rendered here: `prose/` renders what is said for each reader, `bus.ts`
// drains the queue after, and B37 polls the consent pass alone.

import { libraryOf } from '../declare/enums.js';
import { ACTOR_ROLE, playsOf, type ResolvedPlay, type RoleNarrowing } from '../declare/roles.js';
import type { ResolvedRole, ResolvedVerb } from '../declare/verbs.js';
import { readingOfAct } from './act.js';
import { isPerson, toldToOne, toldToPlace } from './audience.js';
import { runBody, type ActSink, type Proposed, type Speech } from './body.js';
import type { Budget } from './budget.js';
import type { Catalogue } from './catalogue.js';
import { boundObject, boundValue, type Evaluated, type Frame } from './evaluate.js';
import type { InstanceId } from './ids.js';
import type { LifecycleContext } from './lifecycle.js';
import { SproutList } from './lists.js';
import { moveInstance, type Notice, type Reach } from './move.js';
import type { Sent } from './sends.js';
import type { Instance, StateReader } from './state.js';
import type { PassRule } from './range.js';
import type { Value } from './values.js';
import type { CommandExit } from './parser/exits.js';

/**
 * What fills one role of a reading: a thing, the things a set role names
 * in typed order, a value the visitor named, or the exit a visitor named
 * for the engine's `go`.
 */
export type Bound =
  | { readonly object: InstanceId }
  | { readonly set: readonly InstanceId[] }
  | { readonly value: Value }
  | { readonly exit: CommandExit };

/** One understood command, or one `act`: a verb, who performs it, and what fills its roles. */
export interface Reading {
  readonly verb: ResolvedVerb;
  readonly actor: InstanceId;
  /**
   * What fills each role, by the role's name. A tool left out has no
   * entry, and neither need a set role, which is then the empty set.
   */
  readonly bindings: ReadonlyMap<string, Bound>;
}

/** One participant in a reading: who, and the role it plays. */
export interface Participant {
  readonly id: InstanceId;
  /** `actor`, or a role the verb declares. */
  readonly role: string;
}

/** The consent pass's refusal: the whole of what the actor reads. */
export interface PermitRefusal {
  /** The participant whose `permit` refused, and the role it played. */
  readonly by: InstanceId;
  readonly role: string;
  /** The kind that wrote the `permit`, by qualified name. */
  readonly origin: string;
  /** The passage named, as it applies on the refusing participant's kind, or the words quoted. */
  readonly said: Speech;
  /**
   * `actor`, `here` and the roles as the refusing play saw them, which its
   * slots may render; a `let` inside the `permit` is not carried.
   */
  readonly bindings: ReadonlyMap<string, Evaluated>;
}

/** A line a turn says, unrendered. */
export interface Said {
  /**
   * What the line is: said by a body; told by one; a `move` or an
   * `act`'s reading refused, whose words are said to its actor as a
   * refusal (the spec's Verbs › Moving something, Acting); or spoken by
   * the engine, as a fault is (The runtime › Effects).
   */
  readonly effect: 'said' | 'told' | 'refused' | 'notice';
  /**
   * Who reads it, each a person: for what is said, the actor, where a
   * person acts, and where an NPC acts, those who would hear its `tell`;
   * for what is told, its audience (the spec's Other people › Who hears it).
   */
  readonly to: readonly InstanceId[];
  /**
   * Whose body said it, which is `self` when it renders: for a refused
   * move, the party whose guard refused; the world, for `nothing_happens`
   * and for the engine's own refusal of a move.
   */
  readonly by: InstanceId;
  /**
   * The NPC it is heard from, where the actor is one and the line is said
   * (the spec's Acting); null where it is said to the actor, and for what
   * is told.
   */
  readonly speaker: InstanceId | null;
  readonly said: Speech;
  /**
   * Every name in scope where it was said, which its slots may render;
   * for a guard's refusal, `mover` and the guard's parameters; for the
   * engine's own, what its line names.
   */
  readonly bindings: ReadonlyMap<string, Evaluated>;
}

/** What the effect pass did, in order. */
export interface Acted {
  readonly said: readonly Said[];
  /** What each spawn and move tells the world, and what each `send` and `broadcast` queued, in body order. */
  readonly sends: readonly Sent[];
  /** What the places speak of each move an actor made between two, for `prose/` to render. */
  readonly notices: readonly Notice[];
  /** What destroyed itself, and everything it held; the queue drops everything pending on each. */
  readonly destroyed: readonly InstanceId[];
  /** What ran `finally destroy self`, in the order it did, to be destroyed once the queue is empty. */
  readonly marked: readonly InstanceId[];
}

/** A reading's outcome: refused in the consent pass, or acted. */
export type ReadingOutcome = { readonly refused: PermitRefusal } | Acted;

/** What the consent pass reads: committed state for a poll, the turn's draft for a command. */
export interface ConsentContext {
  readonly state: StateReader;
  readonly catalogue: Catalogue;
  readonly budget: Budget;
  readonly passes: PassRule<InstanceId>;
}

/** What a whole reading reads and writes: the turn's draft, and what a spawn in a `do` needs. */
export type ReadingContext = LifecycleContext;

/** The world's line for a reading that said nothing to the actor (the spec's The two passes). */
const NOTHING_HAPPENS = 'nothing_happens';

/**
 * The actor, then each role's players in the order the verb declares its
 * roles: a set role's in the order typed, and none for a value role or
 * a tool left out. An object filling two roles participates in each.
 */
export function participantsOf(reading: Reading): Participant[] {
  const participants: Participant[] = [{ id: reading.actor, role: ACTOR_ROLE }];
  const roles = new Set(reading.verb.roles.map((role) => role.name));
  for (const name of reading.bindings.keys()) {
    if (!roles.has(name)) {
      throw new Error(
        `a reading of \`${reading.verb.name}\` fills \`${name}\`, which it does not declare.`,
      );
    }
  }
  for (const role of reading.verb.roles) {
    const bound = boundOf(reading, role);
    if (bound === undefined || 'value' in bound || 'exit' in bound) continue;
    if ('object' in bound) participants.push({ id: bound.object, role: role.name });
    else for (const id of bound.set) participants.push({ id, role: role.name });
  }
  return participants;
}

/**
 * Every `permit` of every participant, in order, until one refuses. A
 * `permit` that allows, or reaches its end, consents, and so does a
 * participant that wrote none. Null when every one consents.
 */
export function consentPass(reading: Reading, context: ConsentContext): PermitRefusal | null {
  const { state } = context;
  for (const participant of participantsOf(reading)) {
    for (const play of playsFor(reading, participant, instanceIn(state, participant.id))) {
      const permit = play.declaration.permit;
      if (permit === null) continue;
      const frame = frameFor(reading, participant, play, state, context);
      const ended = runBody(permit, frame, 'decide', null);
      if (ended === 'end' || ended === 'allow') continue;
      return {
        by: participant.id,
        role: participant.role,
        origin: play.origin,
        said: ended.refused,
        bindings: frame.bindings,
      };
    }
  }
  return null;
}

/**
 * Every `do` of every participant, in the consent pass's order. A
 * participant destroyed by an earlier `do` in the pass, one of its own
 * composed plays included, does nothing more. When nothing was said to
 * the actor, a refused move included, the world's `nothing_happens` is.
 */
export function effectPass(reading: Reading, context: ReadingContext, depth = 0): Acted {
  const { draft } = context;
  const state = turnState(draft);
  const participants = participantsOf(reading);
  const person = isPerson(state, reading.actor);
  const heardBy = (): readonly InstanceId[] => hearersOf(state, reading.actor, participants).to;
  const speaker = person ? null : reading.actor;
  const leftOut = participants.map((participant) => participant.id);
  const { sink, acted, propose } = actingSink(context, depth, { heardBy, speaker, leftOut });
  const { said } = acted;
  // `go` is the engine's: its move is the reading's first effect, and a
  // refusal of it, said as a refused `move` is, ends the pass.
  const way = exitOf(reading);
  const went = way === null ? null : propose(reading.actor, reading.actor, way.to, 'exit');
  for (const participant of went === 'refused' ? [] : participants) {
    const self = draft.instance(participant.id);
    if (self === undefined) continue;
    for (const play of playsFor(reading, participant, self)) {
      if (play.declaration.do === null) continue;
      // `destroy self` takes effect as the `do` that ran it ends, so a
      // composed play after it has no `self` to run for.
      if (draft.instance(participant.id) === undefined) break;
      runBody(
        play.declaration.do,
        { ...frameFor(reading, participant, play, state, context), draws: context.draws },
        'act',
        sink,
      );
    }
  }

  // Only a person's own command is answered: an NPC's reading that says
  // nothing has no output, and a reading performed by `act` is answered,
  // if at all, as part of the reading it stands in.
  // Whoever went reads where they arrived (the spec's Engine verbs).
  const answered =
    !person || depth > 0 || went === 'done' || said.some((line) => line.to.includes(reading.actor));
  if (!answered) {
    const world = instanceIn(state, state.world);
    const passage = world.kind.passages.get(NOTHING_HAPPENS);
    if (passage === undefined) {
      throw new Error(
        `the world composes no \`${NOTHING_HAPPENS}\` passage, which \`sprout.World\` writes.`,
      );
    }
    said.push({
      effect: 'said',
      to: heardBy(),
      by: world.id,
      speaker,
      said: { passage },
      bindings: new Map([
        ['actor', boundObject(reading.actor)],
        ['here', boundObject(placeOf(state, reading.actor))],
      ]),
    });
  }
  return acted;
}

/** What acting bodies have done so far, growing as they run: an `Acted` still being written. */
export interface Acting {
  readonly said: Said[];
  readonly sends: Sent[];
  readonly notices: Notice[];
  readonly destroyed: InstanceId[];
  readonly marked: InstanceId[];
}

/**
 * The turn's state as a body reads it: the draft, where a destroyed
 * object stays readable for the rest of the turn (the spec's Destroying).
 */
export function turnState(draft: ReadingContext['draft']): StateReader {
  return {
    world: draft.world,
    instance: (id) => draft.instance(id) ?? draft.destroyed(id),
    children: (id) => draft.children(id),
    visitor: (visit) => draft.visitor(visit),
    tombstoned: (id) => draft.tombstoned(id),
  };
}

/** Who reads what an acting body says and tells. */
export interface Hearing {
  /** Who reads what it says, a refused `move` included, as it is said. */
  readonly heardBy: () => readonly InstanceId[];
  /** The NPC what it says is heard from, where one is acting. */
  readonly speaker: InstanceId | null;
  /** Whom a plain `tell` leaves out: the reading's participants, or nobody where none is running. */
  readonly leftOut: readonly InstanceId[];
}

/**
 * Where an acting body's effects go, `depth` `act`s or events deep, and
 * what they add up to, in body order: what it says reaches `heardBy`, from
 * `speaker` where an NPC acts; a refused `move` is said the same way; what
 * it tells reaches its audience; an `act` runs its reading one deeper,
 * heard as that reading's own actor is.
 */
export function actingSink(
  context: ReadingContext,
  depth: number,
  hearing: Hearing,
): {
  readonly sink: ActSink;
  readonly acted: Acting;
  /** A move `mover` proposes, reaching `to` as `reach` says, said or kept as the sink's `move` is. */
  readonly propose: (mover: InstanceId, item: InstanceId, to: InstanceId, reach: Reach) => Proposed;
} {
  const { heardBy, speaker, leftOut } = hearing;
  const { draft } = context;
  const state = turnState(draft);
  const said: Said[] = [];
  const sends: Sent[] = [];
  const notices: Notice[] = [];
  const destroyed: InstanceId[] = [];
  const marked: InstanceId[] = [];
  const propose = (mover: InstanceId, item: InstanceId, to: InstanceId, reach: Reach): Proposed => {
    const outcome = moveInstance(context, mover, item, to, reach);
    if ('refusal' in outcome) {
      const { by, said: words, bindings } = outcome.refusal;
      said.push({ effect: 'refused', to: heardBy(), by, speaker, said: words, bindings });
      return 'refused';
    }
    if ('engine' in outcome) {
      const { said: words, bindings } = outcome;
      said.push({
        effect: 'refused',
        to: heardBy(),
        by: draft.world,
        speaker,
        said: words,
        bindings,
      });
      return 'refused';
    }
    sends.push(...outcome.sends);
    notices.push(...outcome.notices);
    return 'done';
  };
  const sink: ActSink = {
    lifecycle: context,
    say: (spoken) => said.push({ effect: 'said', ...spoken, to: heardBy(), speaker }),
    tell: ({ one, ...told }) =>
      said.push({
        effect: 'told',
        ...told,
        to:
          one === null
            ? toldToPlace(state, told.by, leftOut)
            : toldToOne(
                { state: draft, passes: context.passes, budget: context.budget },
                told.by,
                one,
              ),
        speaker: null,
      }),
    sent: (more) => sends.push(...more),
    destroyed: (gone) => destroyed.push(...gone.removed),
    marked: (id) => marked.push(id),
    move: (mover, item, to) => propose(mover, item, to, 'range'),
    act: (actor, performed) => {
      // An `act` runs one deeper than the reading or the event it stands in.
      context.budget.cascadeTo(depth + 1);
      const performing = readingOfAct(performed, actor, context);
      const outcome = runReading(performing, context, depth + 1);
      if ('refused' in outcome) {
        const { by, said: words, bindings } = outcome.refused;
        const heard = hearersOf(state, actor, participantsOf(performing));
        said.push({ effect: 'refused', ...heard, by, said: words, bindings });
        return 'refused';
      }
      said.push(...outcome.said);
      sends.push(...outcome.sends);
      notices.push(...outcome.notices);
      destroyed.push(...outcome.destroyed);
      marked.push(...outcome.marked);
      return 'done';
    },
  };
  return { sink, acted: { said, sends, notices, destroyed, marked }, propose };
}

/**
 * The consent pass, then, where nobody refused, the effect pass, once
 * each set role is checked against the host's cap on what one binds.
 * `depth` is how many `act`s deep the reading runs: a typed command's is 0.
 */
export function runReading(reading: Reading, context: ReadingContext, depth = 0): ReadingOutcome {
  const { draft, catalogue, budget, passes } = context;
  for (const bound of reading.bindings.values())
    if ('set' in bound) budget.setRole(bound.set.length);
  const refused = consentPass(reading, { state: draft, catalogue, budget, passes });
  return refused === null ? effectPass(reading, context, depth) : { refused };
}

/** The exit a reading of the engine's `go` takes, or null for any other reading. */
function exitOf(reading: Reading): CommandExit | null {
  for (const role of reading.verb.roles) {
    const bound = role.filler?.fills === 'exit' ? boundOf(reading, role) : undefined;
    if (bound !== undefined && 'exit' in bound) return bound.exit;
  }
  return null;
}

/**
 * Who reads what a reading says, and whom it is heard from: the actor
 * where a person acts; where an NPC acts, whoever would hear its `tell`,
 * from it (the spec's Acting).
 */
function hearersOf(
  state: StateReader,
  actor: InstanceId,
  participants: readonly Participant[],
): { readonly to: readonly InstanceId[]; readonly speaker: InstanceId | null } {
  return isPerson(state, actor)
    ? { to: [actor], speaker: null }
    : {
        to: toldToPlace(state, actor, [
          actor,
          ...participants.map((participant) => participant.id),
        ]),
        speaker: actor,
      };
}

/** What a participant's kind runs for the role it plays in this verb, in composition order. */
function playsFor(
  reading: Reading,
  participant: Participant,
  self: Instance,
): readonly ResolvedPlay[] {
  const { verb } = reading;
  return playsOf(self.kind.plays, verb.library, verb.name, participant.role);
}

/**
 * The frame one play runs in: `self` the participant, `actor` and `here`,
 * and each other role as this play sees it (the spec's Playing a role).
 * It draws nothing: a `do` is given the turn's draws where it runs.
 */
function frameFor(
  reading: Reading,
  participant: Participant,
  play: ResolvedPlay,
  state: StateReader,
  context: ConsentContext | ReadingContext,
): Frame {
  const self = instanceIn(state, participant.id);
  const bindings = new Map<string, Evaluated>([
    ['actor', boundObject(reading.actor)],
    ['here', boundObject(placeOf(state, reading.actor))],
  ]);
  for (const role of reading.verb.roles) {
    const bound = roleIn(reading, role, participant, play, self);
    if (bound !== null) bindings.set(role.name, bound);
  }
  return {
    state,
    kinds: context.catalogue.lookup,
    library: libraryOf(play.origin),
    self: participant.id,
    bindings,
    budget: context.budget,
    caps: context.catalogue.caps,
    names: context.catalogue.names,
    passes: context.passes,
  };
}

/**
 * One role as a play sees it, or null where it is unbound there: a set
 * role is always bound, the empty set where nothing filled it; the role
 * played is `self`; a tool left out is unbound; and a value is bound only
 * among the options this play's `from` hears, read from its role-player now.
 */
function roleIn(
  reading: Reading,
  role: ResolvedRole,
  participant: Participant,
  play: ResolvedPlay,
  self: Instance,
): Evaluated | null {
  // An exit is the engine's to take, and binds nothing in a play.
  if (role.filler?.fills === 'exit') return null;
  const bound = boundOf(reading, role);
  if (role.many)
    return { binds: 'set', ids: bound !== undefined && 'set' in bound ? bound.set : [] };
  if (role.name === participant.role || bound === undefined) return null;
  if ('set' in bound || 'exit' in bound) return null;
  if ('object' in bound) return boundObject(bound.object);
  const narrowing = play.narrows.get(role.name);
  return narrowing !== undefined && hears(narrowing, bound.value, self)
    ? boundValue(bound.value)
    : null;
}

/** What a reading fills a role with, as the role's filler allows. */
function boundOf(reading: Reading, role: ResolvedRole): Bound | undefined {
  const bound = reading.bindings.get(role.name);
  if (bound === undefined) return undefined;
  const fills = role.filler?.fills;
  const takes =
    fills === 'exit'
      ? 'exit'
      : fills === 'symbol' || fills === 'integer'
        ? 'value'
        : role.many
          ? 'set'
          : 'object';
  if (!(takes in bound)) {
    throw new Error(
      `a reading of \`${reading.verb.name}\` fills \`${role.name}\` with what it does not take.`,
    );
  }
  return bound;
}

/**
 * Whether any participant of `reading` hears `value` for the value role
 * `role`: some play of theirs narrows it with a `from` that holds it now
 * (the spec's A role-player narrows its own options).
 */
export function heardBy(
  reading: Reading,
  role: ResolvedRole,
  value: Value,
  state: StateReader,
): boolean {
  return participantsOf(reading).some((participant) => {
    const self = instanceIn(state, participant.id);
    return playsFor(reading, participant, self).some((play) => {
      const narrowing = play.narrows.get(role.name);
      return narrowing !== undefined && hears(narrowing, value, self);
    });
  });
}

/**
 * Whether a play's `from` hears a value (the spec's A role-player narrows
 * its own options): an option its list property holds now, or a number
 * within its integer property's range or the range written out.
 */
function hears(narrowing: RoleNarrowing, value: Value, self: Instance): boolean {
  if (narrowing.narrows === 'range') {
    return typeof value === 'number' && value >= narrowing.min && value <= narrowing.max;
  }
  const { property } = narrowing;
  if (property.type.type === 'integer') {
    return typeof value === 'number' && value >= property.type.min && value <= property.type.max;
  }
  const held = self.properties.get(property.name);
  return held instanceof SproutList && typeof value === 'string' && held.includes(value);
}

/**
 * The actor's place: its container, which holds actors, since an actor is
 * only ever inside something that does (the spec's Actors and visitors).
 */
function placeOf(state: StateReader, actor: InstanceId): InstanceId {
  const container = instanceIn(state, actor).container;
  if (container === null)
    throw new Error(`\`${actor}\` is away, and an away visitor reads nothing.`);
  if (!instanceIn(state, container).kind.containsActors)
    throw new Error(`\`${actor}\` is in \`${container}\`, which holds no actors.`);
  return container;
}

function instanceIn(state: StateReader, id: InstanceId): Instance {
  const instance = state.instance(id);
  if (instance === undefined)
    throw new Error(`\`${id}\` takes part in a reading, and is not an instance.`);
  return instance;
}
