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
// effect pass then runs every `do` in the same order. What a `do` says
// reaches the actor, or, where the actor is an NPC, whoever would hear its
// `tell`, from it; a reading that said nothing to the actor is answered
// with the world's `nothing_happens`. Nothing is rendered: B29 renders
// what is said, B30 brings `tell`, B32 drains the queue, and B37 polls the
// consent pass alone.

import { isActor } from '../declare/actors.js';
import { libraryOf } from '../declare/enums.js';
import { ACTOR_ROLE, playsOf, type ResolvedPlay, type RoleNarrowing } from '../declare/roles.js';
import type { ResolvedRole, ResolvedVerb } from '../declare/verbs.js';
import { runBody, type ActSink, type Speech } from './body.js';
import type { Budget } from './budget.js';
import type { Catalogue } from './catalogue.js';
import { boundObject, boundValue, type Evaluated, type Frame } from './evaluate.js';
import type { InstanceId } from './ids.js';
import type { EngineSend, LifecycleContext } from './lifecycle.js';
import { SproutList } from './lists.js';
import type { Instance, StateReader } from './state.js';
import type { Value } from './values.js';

/** What fills one role of a reading: a thing, the things a set role names in typed order, or a value the visitor named. */
export type Bound =
  | { readonly object: InstanceId }
  | { readonly set: readonly InstanceId[] }
  | { readonly value: Value };

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
}

/** A line said in the effect pass, unrendered. */
export interface Said {
  /** Who reads it: the actor, where a person acts; where an NPC acts, those who would hear its `tell`. */
  readonly to: readonly InstanceId[];
  /** Whose body said it, which is `self` when it renders; the world, for `nothing_happens`. */
  readonly by: InstanceId;
  /** The NPC it is heard from, where the actor is one (the spec's Acting); null where it is said to the actor. */
  readonly speaker: InstanceId | null;
  readonly said: Speech;
  /** Every name in scope where it was said, which its slots may render. */
  readonly bindings: ReadonlyMap<string, Evaluated>;
}

/** What the effect pass did, in order. */
export interface Acted {
  readonly said: readonly Said[];
  /** What the engine tells the world of each spawn and destroy, for B32's queue. */
  readonly sends: readonly EngineSend[];
  /** What destroyed itself; the queue drops every message to or from each. */
  readonly destroyed: readonly InstanceId[];
}

/** A reading's outcome: refused in the consent pass, or acted. */
export type ReadingOutcome = { readonly refused: PermitRefusal } | Acted;

/** What the consent pass reads: committed state for a poll, the turn's draft for a command. */
export interface ConsentContext {
  readonly state: StateReader;
  readonly catalogue: Catalogue;
  readonly budget: Budget;
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
    if (bound === undefined || 'value' in bound) continue;
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
      };
    }
  }
  return null;
}

/**
 * Every `do` of every participant, in the consent pass's order. A
 * participant destroyed by an earlier `do` in the pass, one of its own
 * composed plays included, does nothing more. When nothing was said to
 * the actor, the world's `nothing_happens` is.
 */
export function effectPass(reading: Reading, context: ReadingContext): Acted {
  const { draft } = context;
  // A destroyed object stays readable for the rest of the turn (the spec's Destroying).
  const state: StateReader = {
    world: draft.world,
    instance: (id) => draft.instance(id) ?? draft.destroyed(id),
    children: (id) => draft.children(id),
    visitor: (visit) => draft.visitor(visit),
  };
  const participants = participantsOf(reading);
  const person = instanceIn(state, reading.actor).made.from === 'visitor';
  const heardBy = (): readonly InstanceId[] =>
    person ? [reading.actor] : audienceOf(state, reading.actor, participants);
  const speaker = person ? null : reading.actor;

  const said: Said[] = [];
  const sends: EngineSend[] = [];
  const destroyed: InstanceId[] = [];
  const sink: ActSink = {
    lifecycle: context,
    say: (spoken) => said.push({ ...spoken, to: heardBy(), speaker }),
    sent: (more) => sends.push(...more),
    destroyed: (gone) => {
      destroyed.push(gone.id);
      sends.push(...gone.sends);
    },
  };
  for (const participant of participants) {
    const self = draft.instance(participant.id);
    if (self === undefined) continue;
    for (const play of playsFor(reading, participant, self)) {
      if (play.declaration.do === null) continue;
      // `destroy self` takes effect as the `do` that ran it ends, so a
      // composed play after it has no `self` to run for.
      if (draft.instance(participant.id) === undefined) break;
      runBody(
        play.declaration.do,
        frameFor(reading, participant, play, state, context),
        'act',
        sink,
      );
    }
  }

  // An NPC reads nothing, so its reading is answered where its lines went.
  const answered = person ? said.some((line) => line.to.includes(reading.actor)) : said.length > 0;
  if (!answered) {
    const world = instanceIn(state, state.world);
    const passage = world.kind.passages.get(NOTHING_HAPPENS);
    if (passage === undefined) {
      throw new Error(
        `the world composes no \`${NOTHING_HAPPENS}\` passage, which \`sprout.World\` writes.`,
      );
    }
    said.push({
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
  return { said, sends, destroyed };
}

/** The consent pass, then, where nobody refused, the effect pass. */
export function runReading(reading: Reading, context: ReadingContext): ReadingOutcome {
  const { draft, catalogue, budget } = context;
  const refused = consentPass(reading, { state: draft, catalogue, budget });
  return refused === null ? effectPass(reading, context) : { refused };
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
  // Only the engine's `go` has an exit role, and what an exit binds is B28's.
  if (role.filler?.fills === 'exit') return null;
  const bound = boundOf(reading, role);
  if (role.many)
    return { binds: 'set', ids: bound !== undefined && 'set' in bound ? bound.set : [] };
  if (role.name === participant.role || bound === undefined || 'set' in bound) return null;
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
  if (fills === 'exit')
    throw new Error("an exit reached a reading, and what an exit binds is B28's.");
  const takes = fills === 'symbol' || fills === 'integer' ? 'value' : role.many ? 'set' : 'object';
  if (!(takes in bound)) {
    throw new Error(
      `a reading of \`${reading.verb.name}\` fills \`${role.name}\` with what it does not take.`,
    );
  }
  return bound;
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
 * The actor's place: its nearest container holding actors (the spec's
 * Places inside places). One that nothing around holds actors is placed
 * in the world, the one container every object has.
 */
function placeOf(state: StateReader, actor: InstanceId): InstanceId {
  const container = instanceIn(state, actor).container;
  if (container === null)
    throw new Error(`\`${actor}\` is away, and an away visitor reads nothing.`);
  for (let at: InstanceId | null = container; at !== null;) {
    const holder = instanceIn(state, at);
    if (holder.kind.containsActors) return at;
    at = holder.container;
  }
  return state.world;
}

/**
 * Whoever would hear an NPC's `tell` (the spec's Other people › Who hears
 * it): the actors directly in its place, NPCs included, less the NPC and
 * every participant, in contents order. B30 says what reaches an NPC.
 */
function audienceOf(
  state: StateReader,
  npc: InstanceId,
  participants: readonly Participant[],
): InstanceId[] {
  const left = new Set([npc, ...participants.map((participant) => participant.id)]);
  return state
    .children(placeOf(state, npc))
    .filter((id) => !left.has(id) && isActor(instanceIn(state, id).kind));
}

function instanceIn(state: StateReader, id: InstanceId): Instance {
  const instance = state.instance(id);
  if (instance === undefined)
    throw new Error(`\`${id}\` takes part in a reading, and is not an instance.`);
  return instance;
}
