import {
  SPROUT_MUTATING_STATEMENTS,
  SPROUT_RESERVED_MESSAGES,
  wellKnownFor,
  type ResolvedDefinition,
  type SproutConsentKind,
  type SproutDefinition,
  type SproutExpr,
  type SproutMessage,
  type SproutStatement,
  type SproutTarget,
} from './sprout.js';
import {
  SPROUT_EFFECTS_PER_ACTION,
  SPROUT_CASCADE_DEPTH,
  SPROUT_EVENT_BUDGET,
  SPROUT_FAULT_CHAIN,
  SPROUT_MAX_INSTANCES,
  SPROUT_SPAWNS_PER_ACTION,
  isBuiltinField,
  type SproutField,
  type SproutState,
  type SproutValue,
  type SproutMemory,
} from './definitions.js';
import {
  NO_EXTENSIONS,
  type BoundArgs,
  type Effect,
  type ExtensionSet,
  type ObjectRef,
  type ReadOnlyFrame,
} from './extensions.js';
import { humanise, identOf } from './sprout-lang.js';

// The Sprout engine (#259, #339, #340; understory.md §3.1, sprout.md §2):
// the ONE evaluator, pure — no database, no clock, no identity. It is
// handed a WORLD — the room, the actor, and every object in reach, each
// with a compiled definition, a state, what it remembers about the
// acting visitor, and the container it sits in — runs one message or
// one move, and hands back the narration for the actor; state and
// position changes land on the objects in place and the caller writes
// them. Every guard the client will ever see the result of is
// evaluated here.
//
// The invariants, mechanically:
// - An object writes only its OWN state and its own memory of the
//   visitor (the compiler already refuses anything else). Another
//   object is reached by a message it may ignore.
// - Containers are the bus (§2.5): a broadcast goes to the sender's
//   container, which delivers to what it holds, and each container's
//   `pass` rule decides whether the event carries inward or outward.
//   Rooms are the top; the actor's hands pass both ways; a container
//   item passes while `:open`. `path` keeps a container from relaying
//   one event twice.
// - Every move is a proposal (§2.6): `depart` on the thing, `release`
//   on where it is, `accept` on where it goes — read-only guards ending
//   in allow or refuse — and only then does containment change, with
//   `left`, `entered` and `moved` sent after.
// - Every event is an envelope (§2.5). Depth over
//   SPROUT_CASCADE_DEPTH or more than SPROUT_EVENT_BUDGET
//   envelopes in one action is a FAULT: the caller rolls the action
//   back and records the chain. No cycle rule.
// - The caps are the REQUEST's, not a runner's (#441): the event, spawn
//   and instance counts live on `SproutBudget`, one per world, and
//   every runner made over that world — a verb, each move of a "take
//   all", every `describeWith` and `openVerbs` of the projection —
//   draws on the same one. Describing forty items cannot cost forty
//   ceilings.
// - `describe` is prose (§2.12, #441): it reads anything in range and
//   changes nothing. The compiler refuses a writing or sending statement
//   there; `run` skips one that reaches it anyway, so a definition that
//   predates the rule cannot move the live world on a look.
// - Deterministic: delivery walks the tree in id order; the queue is
//   FIFO; nothing else orders anything.
// - Kinds and instances (§2.8, #341): an object's `definition` is the
//   flattened result of its kinds; `kinds` names the chain for
//   `is(Kind)`. `spawn Kind in …` makes an instance of one of the
//   world's kinds (the zone's published ones), bounded per action and
//   per zone; `destroy self` takes an item out, its contents falling to
//   its container. Both are faults past their caps.
// - An extension statement (§3.5 of the split proposal) records an
//   EFFECT on the outcome and performs nothing: `run` sees a frozen,
//   read-only frame; a throw is a fault naming the extension; every run
//   is charged as an event and the effects of one action are capped.

export interface SproutObject {
  id: string;
  kind: 'room' | 'item' | 'actor';
  /** The flattened definition: every kind on the chain folded in, `inherit` the built-in root. */
  definition: SproutDefinition;
  /** The kind names on the chain, most specific first — what `is(Kind)` answers. */
  kinds: string[];
  /** Own state, normalized (every declared property, fitting values). */
  state: SproutState;
  /** What this object remembers about the acting visitor, normalized. */
  visitor: SproutState;
  /** The object holding this one: a room, an item that is a container, or an actor; null for a room. */
  container: string | null;
  /** The room this belongs to when nothing holds it (a placed item's definition room; a spawned thing's birthplace). */
  home: string | null;
  /** The kind this instance was spawned from, when it was (null for placed objects). */
  spawnedFrom: string | null;
}

/** A kind the world may spawn: its name, its row, and the item it becomes. */
export interface SpawnableKind extends ResolvedDefinition {
  kindId: string;
}

/**
 * The immutable slice the evaluator reads (§3.4): the room, the acting
 * visitor, everything in reach, and — for a move across rooms or hands
 * — the other side. Built by the host from its store; the language
 * never sees a row. The objects' state is mutated in place by a run;
 * the host writes back what the outcome names.
 */
export interface Scene {
  room: SproutObject;
  /** The acting visitor, as an object: kind Actor, their hands a container. */
  actor: SproutObject;
  /** Everything in reach: what the room and the actor hold, at any depth, any order — the engine sorts. */
  items: SproutObject[];
  /** For a move across rooms or hands: the destination and what it holds (a room and its items; another actor and theirs). */
  elsewhere?: SproutObject[];
  /** The microworld's kinds by name, for `spawn`. */
  kinds?: ReadonlyMap<string, SpawnableKind>;
  /**
   * Delivery order (the split proposal §3.3): object id → its place —
   * placed objects in declaration order, spawned ones in spawn order.
   * Where the engine lists or delivers "in order" it uses this; an id it
   * does not name comes after, by id. Absent, everything is by id.
   */
  order?: ReadonlyMap<string, number>;
}

/**
 * The mutable half of a turn (§3.4), one per request and shared by every
 * runner in it: the budget, where new instance ids come from, how many
 * instances are alive before this action (for the cap), and the
 * extensions the program was compiled with — which reach every helper
 * that consults the well-known property table.
 */
export interface TurnContext {
  budget: SproutBudget;
  /** New instance ids; the host's (uuids from the world, counters in a spec). */
  mint: () => string;
  /** Live instances in the microworld before this action, for the cap. */
  liveCount: number;
  ext: ExtensionSet;
}

/** A turn context with defaults for what is not given: a fresh budget, counter ids, nothing alive, no extensions. */
export function turnContext(partial: Partial<TurnContext> = {}): TurnContext {
  let n = 0;
  return {
    budget: partial.budget ?? new SproutBudget(),
    mint: partial.mint ?? (() => `spawn-${++n}`),
    liveCount: partial.liveCount ?? 0,
    ext: partial.ext ?? NO_EXTENSIONS,
  };
}

/**
 * What one request may spend, wherever it spends it (§2.5, §2.8, #441):
 * envelopes against SPROUT_EVENT_BUDGET, births against
 * SPROUT_SPAWNS_PER_ACTION, and the net instances made against the
 * zone's SPROUT_MAX_INSTANCES. Envelope ids come from here too, so
 * they stay unique across the runners of one request.
 */
export class SproutBudget {
  events = 0;
  spawns = 0;
  /** Instances made this request and still alive (a spawn that was destroyed again is not one). */
  made = 0;
  nextId = 1;
}

/** One event as it travelled (sprout.md §2.5) — what a fault record keeps. */
export interface SproutEnvelope {
  id: number;
  name: string;
  from: string;
  value: SproutValue | null;
  depth: number;
  instigator: number;
  path: string[];
}

export interface SproutFault {
  message: string;
  /** The last SPROUT_FAULT_CHAIN envelopes, oldest first. */
  chain: SproutEnvelope[];
  /** The object that was running when it faulted. */
  objectId: string;
}

export interface Outcome {
  /** False when the target or the message was not there, its `when` did not pass, or an argument was missing. */
  ok: boolean;
  narration: string[];
  /** Object ids whose own state a statement wrote. */
  changed: Set<string>;
  /** Object ids whose memory of the visitor a statement wrote. */
  remembered: Set<string>;
  /** Object id → the container it now sits in, for every move that was allowed. */
  moved: Map<string, string>;
  /** What the extensions' statements recorded, in order (§3.5): the host acts on these after the turn. */
  effects: Effect[];
  /** Instances made this action (already in `world.items`), and ids destroyed. */
  spawned: SproutObject[];
  destroyed: Set<string>;
  /** Envelopes emitted, the deepest one, and the fault if the action must roll back. */
  events: number;
  maxDepth: number;
  fault: SproutFault | null;
}

export interface MoveOutcome extends Outcome {
  /** The refusal the actor read, when a guard said no. */
  refused: string | null;
}

// --- definitions ---------------------------------------------------------------

/** The actor's definition (§2.5): kind Actor, engine-defined, never placeable, never read beyond `is(Actor)`. */
export const ACTOR_DEFINITION: SproutDefinition = {
  role: 'item',
  ident: null,
  placedIn: null,
  name: 'you',
  names: [],
  prose: '',
  inherit: 'Actor',
  uses: [],
  properties: [],
  remembers: [],
  describe: [],
  messages: [],
  handlers: [],
  hooks: [],
  passRules: [],
  consents: [],
};

/** How many things the hands hold by default (§2.6 `:capacity`). */
export const ACTOR_CAPACITY = 8;

export function actorObject(id: string): SproutObject {
  return {
    id,
    kind: 'actor',
    definition: ACTOR_DEFINITION,
    kinds: [],
    state: {},
    visitor: {},
    container: null,
    home: null,
    spawnedFrom: null,
  };
}

/** Whether an object may hold things: rooms, actors, and items that inherit Container. */
export function isContainer(obj: SproutObject): boolean {
  return obj.kind !== 'item' || obj.definition.inherit === 'Container';
}

/**
 * Stored state → this object's shape: every declared property (defaults
 * for what is missing or does not fit, nothing undeclared — the §5
 * migration seam), plus a well-known property that applies to it (§2.2)
 * when the state already holds one: `self.set(:hidden, true)` on an
 * item that never declared `:hidden` lands there and stays. A
 * well-known property the state does not hold is read as its default,
 * never stored.
 */
export function normalizeObjectState(
  def: SproutDefinition,
  raw: unknown,
  ext: ExtensionSet = NO_EXTENSIONS,
): SproutState {
  const out = normalizeState(def.properties, raw, ext);
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  for (const [name, field] of wellKnownFor(def, ext)) {
    if (name in out || !(name in source)) continue;
    const value = fit(field, source[name], ext);
    if (value !== undefined) out[name] = value;
  }
  return out;
}

/** `:takeable`, as the world asks it (#260's `portable`): set, declared, or the well-known default. */
export function takeableOf(obj: SproutObject): boolean {
  return (obj.state['takeable'] ?? wellKnownFor(obj.definition).get('takeable')?.default) === true;
}

/** `:open`: rooms and hands always; a container while its state says so (default true). */
export function openOf(obj: SproutObject): boolean {
  if (obj.kind !== 'item') return true;
  return (obj.state['open'] ?? true) === true;
}

/** `:capacity`: unbounded for a room; the hands' default for an actor; a container's state or the well-known default. */
export function capacityOf(obj: SproutObject): number {
  if (obj.kind === 'room') return Number.POSITIVE_INFINITY;
  const declared = obj.state['capacity'];
  if (typeof declared === 'number') return declared;
  if (obj.kind === 'actor') return ACTOR_CAPACITY;
  const known = wellKnownFor(obj.definition).get('capacity');
  return known && isBuiltinField(known) && known.type === 'integer'
    ? known.default
    : ACTOR_CAPACITY;
}

// --- state ------------------------------------------------------------------

export function defaultOf(field: SproutField): SproutValue {
  return field.default;
}

/**
 * A value fit to its field: the declared type, integers clamped, enums
 * among the options, an extension's type by its own `fit`; `undefined`
 * when it does not fit. An extension value may be null (a media
 * property with no picture) — null is a VALUE there, never a miss.
 */
export function fit(
  field: SproutField,
  value: unknown,
  ext: ExtensionSet = NO_EXTENSIONS,
): SproutValue | undefined {
  if (!isBuiltinField(field)) return ext.valueType(field.type)?.type.fit(value);
  switch (field.type) {
    case 'boolean':
      return typeof value === 'boolean' ? value : undefined;
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
        ? Math.min(field.max, Math.max(field.min, value))
        : undefined;
    case 'enum':
      return typeof value === 'string' && field.options.includes(value) ? value : undefined;
    case 'string':
      return typeof value === 'string' ? value : undefined;
  }
}

/**
 * Stored state → the declared shape: every declared field present
 * (defaults for what is missing or does not fit), nothing undeclared.
 * This is the state-migration seam (§5): a field the new version
 * dropped disappears; one it added starts at its default.
 */
export function normalizeState(
  fields: readonly SproutField[],
  raw: unknown,
  ext: ExtensionSet = NO_EXTENSIONS,
): SproutState {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: SproutState = {};
  for (const f of fields) {
    const fitted = fit(f, source[f.name], ext);
    out[f.name] = fitted === undefined ? defaultOf(f) : fitted;
  }
  return out;
}

/** The field a write lands in: declared, else a well-known one that applies here. */
function fieldOf(obj: SproutObject, name: string, ext: ExtensionSet): SproutField | undefined {
  return (
    obj.definition.properties.find((f) => f.name === name) ??
    wellKnownFor(obj.definition, ext).get(name)
  );
}

function rememberedFieldOf(obj: SproutObject, name: string): SproutField | undefined {
  return obj.definition.remembers.find((f) => f.name === name);
}

function sorted(
  items: readonly SproutObject[],
  order?: ReadonlyMap<string, number>,
): SproutObject[] {
  const rank = (o: SproutObject) => order?.get(o.id) ?? Number.POSITIVE_INFINITY;
  return [...items].sort((a, b) => {
    const d = rank(a) - rank(b);
    if (d !== 0 && !Number.isNaN(d)) return d;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// --- messages as verbs ------------------------------------------------------------

/**
 * The chip's words: the first grammar line as written — a v0 verb's
 * label exactly (§6) — with `[self]` dropped and any other slot shown
 * as an ellipsis (the pick is #344); else the name humanised.
 */
export function verbLabel(m: SproutMessage): string {
  const line = m.grammar[0];
  if (!line) return humanise(m.name);
  return line
    .replace(/\s*\[self\]\s*/g, ' ')
    .replace(/\[[a-z][a-z0-9_]*\]/g, '…')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A message a visitor can reach: has a body, and is not one the engine sends. */
function reachable(m: SproutMessage): boolean {
  return !m.abstract && !SPROUT_RESERVED_MESSAGES.has(m.name);
}

/** Find a message by its name, its label, or any grammar line — case-insensitively. */
export function findMessage(obj: SproutObject, verb: string): SproutMessage | undefined {
  const key = verb.trim().toLowerCase();
  return obj.definition.messages.find(
    (m) =>
      reachable(m) &&
      (m.name === key ||
        humanise(m.name).toLowerCase() === key ||
        m.grammar.some((g) => g.toLowerCase() === key)),
  );
}

// --- evaluation --------------------------------------------------------------------

type Binding = { kind: 'object'; id: string } | { kind: 'value'; value: SproutValue | null };

interface Frame {
  self: SproutObject;
  depth: number;
  /** The envelope this frame is answering; null for the actor's own command and for describe. */
  envelope: SproutEnvelope | null;
  bindings: Map<string, Binding>;
  /** Set inside a consent guard by `allow` / `refuse`; stops the body. */
  decision?: { allow: boolean; text: string } | null;
}

class Fault extends Error {
  constructor(
    message: string,
    readonly objectId: string,
  ) {
    super(message);
  }
}

const REFUSALS = {
  notTakeable: 'That is not something you can carry.',
  shut: (name: string) => `${name} is shut.`,
  full: (name: string) => `There is no room in ${name}.`,
  notContainer: 'Nothing goes in there.',
  itself: 'It cannot go inside itself.',
};

class Runner {
  readonly objects = new Map<string, SproutObject>();
  readonly narration: string[] = [];
  readonly changed = new Set<string>();
  readonly remembered = new Set<string>();
  readonly moved = new Map<string, string>();
  readonly spawned: SproutObject[] = [];
  readonly destroyed = new Set<string>();
  readonly effects: Effect[] = [];
  readonly ext: ExtensionSet;
  readonly queue: { envelope: SproutEnvelope; targetId: string; changed?: { was: SproutValue } }[] =
    [];
  readonly chain: SproutEnvelope[] = [];
  maxDepth = 0;
  private instigator = 0;
  /** The request's budget (#441), and where it stood when this runner began. */
  readonly budget: SproutBudget;
  private readonly eventsBefore: number;

  constructor(
    readonly scene: Scene,
    readonly ctx: TurnContext,
  ) {
    this.ext = ctx.ext;
    this.budget = ctx.budget;
    this.eventsBefore = this.budget.events;
    this.objects.set(scene.room.id, scene.room);
    this.objects.set(scene.actor.id, scene.actor);
    for (const item of scene.items) this.objects.set(item.id, item);
    for (const other of scene.elsewhere ?? []) this.objects.set(other.id, other);
  }

  /** The envelopes this runner emitted — the action's own count, for its record. */
  get events(): number {
    return this.budget.events - this.eventsBefore;
  }

  /** The actor's command: the depth-0 envelope everything descends from. */
  root(name: string, from: string, value: SproutValue | null): SproutEnvelope {
    const env: SproutEnvelope = {
      id: this.budget.nextId++,
      name,
      from,
      value,
      depth: 0,
      instigator: 0,
      path: [],
    };
    env.instigator = env.id;
    this.instigator = env.id;
    this.remember(env);
    return env;
  }

  private remember(env: SproutEnvelope): void {
    this.chain.push(env);
    if (this.chain.length > SPROUT_FAULT_CHAIN) this.chain.shift();
  }

  private emit(
    frame: Frame,
    name: string,
    targetId: string,
    value: SproutValue | null,
    options: { changed?: { was: SproutValue }; path?: string[]; from?: string } = {},
  ): void {
    if (++this.budget.events > SPROUT_EVENT_BUDGET) {
      throw new Fault(
        `More than ${SPROUT_EVENT_BUDGET} events in one action — something here is answering itself without end.`,
        frame.self.id,
      );
    }
    const env: SproutEnvelope = {
      id: this.budget.nextId++,
      name,
      from: options.from ?? frame.self.id,
      value,
      depth: frame.depth + 1,
      instigator: this.instigator,
      path:
        options.path ??
        (frame.envelope ? [...frame.envelope.path, frame.self.id] : [frame.self.id]),
    };
    this.maxDepth = Math.max(this.maxDepth, env.depth);
    this.remember(env);
    this.queue.push({ envelope: env, targetId, changed: options.changed });
  }

  // -- the tree ----------------------------------------------------------------------

  /** What a container directly holds, in id order. */
  contentsOf(container: SproutObject): SproutObject[] {
    return sorted(
      [...this.objects.values()].filter((o) => o.container === container.id),
      this.scene.order,
    );
  }

  containerOf(obj: SproutObject): SproutObject | null {
    return obj.container ? (this.objects.get(obj.container) ?? null) : null;
  }

  /** The room an object is in, through any nesting; an actor's room is the world's. */
  roomOf(obj: SproutObject): SproutObject {
    let cur: SproutObject | null = obj;
    while (cur && cur.kind !== 'room') {
      cur = cur.kind === 'actor' ? this.scene.room : this.containerOf(cur);
    }
    return cur ?? this.scene.room;
  }

  private isInside(obj: SproutObject, ancestor: SproutObject): boolean {
    let cur = this.containerOf(obj);
    while (cur) {
      if (cur.id === ancestor.id) return true;
      cur = this.containerOf(cur);
    }
    return false;
  }

  /** A container's `pass` rule for one message (§2.5): its own line, its `any` line, else the built-in default. */
  private passes(container: SproutObject, message: string): boolean {
    const rule =
      container.definition.passRules.find((p) => p.message === message) ??
      container.definition.passRules.find((p) => p.message === null);
    if (rule) {
      const frame: Frame = { self: container, depth: 0, envelope: null, bindings: new Map() };
      return truthy(this.evaluate(rule.condition, frame));
    }
    return openOf(container);
  }

  /**
   * A broadcast (§2.5): handed to the sender's container, which hears
   * it, delivers it to what it holds (id order, not the sender), carries
   * it into sub-containers that pass it, and — if it passes it outward —
   * on to its own container. `path` names the containers that relayed
   * it, so none relays it twice.
   */
  private broadcast(frame: Frame, message: string, value: SproutValue | null): void {
    const sender = frame.self;
    const start = sender.kind === 'room' ? sender : this.containerOf(sender);
    if (!start) return;
    const relayed = new Set<string>();
    const targets: string[] = [];
    const inward = (container: SproutObject) => {
      if (relayed.has(container.id)) return;
      relayed.add(container.id);
      // A container hears what it relays — except the hands, which only carry.
      if (container.id !== sender.id && container.kind !== 'actor') targets.push(container.id);
      const held = this.contentsOf(container);
      // The actor stands in the world's room: their hands hear what the room hears.
      if (container.kind === 'room' && container.id === this.scene.room.id) {
        held.push(this.scene.actor);
      }
      for (const thing of held) {
        if (thing.id === sender.id) continue;
        if (isContainer(thing)) {
          if (this.passes(thing, message)) inward(thing);
          else targets.push(thing.id);
        } else {
          targets.push(thing.id);
        }
      }
    };
    let container: SproutObject | null = start;
    while (container) {
      inward(container);
      const parent: SproutObject | null =
        container.kind === 'actor' ? this.scene.room : this.containerOf(container);
      if (!parent || !this.passes(container, message)) break;
      container = parent;
    }
    const path = [...relayed];
    for (const id of targets) this.emit(frame, message, id, value, { path });
  }

  drain(): void {
    while (this.queue.length > 0) {
      const next = this.queue.shift()!;
      const target = this.objects.get(next.targetId);
      if (!target) continue;
      if (next.envelope.depth > SPROUT_CASCADE_DEPTH) {
        throw new Fault(
          `An event chain ran deeper than ${SPROUT_CASCADE_DEPTH} — two things here are probably answering each other.`,
          target.id,
        );
      }
      const frame: Frame = {
        self: target,
        depth: next.envelope.depth,
        envelope: next.envelope,
        bindings: new Map(),
      };
      if (next.changed) {
        const hook = target.definition.hooks.find((h) => h.property === next.envelope.name);
        if (!hook) continue;
        if (hook.value)
          frame.bindings.set(hook.value, { kind: 'value', value: next.envelope.value });
        if (hook.was) frame.bindings.set(hook.was, { kind: 'value', value: next.changed.was });
        this.run(hook.body, frame);
        continue;
      }
      const handler = target.definition.handlers.find((h) => h.message === next.envelope.name);
      if (!handler) continue;
      if (handler.from)
        frame.bindings.set(handler.from, { kind: 'object', id: next.envelope.from });
      if (handler.value)
        frame.bindings.set(handler.value, { kind: 'value', value: next.envelope.value });
      this.run(handler.body, frame);
    }
  }

  // -- statements ---------------------------------------------------------------

  run(body: readonly SproutStatement[], frame: Frame, describe?: string[]): void {
    for (const s of body) {
      if (frame.decision) return;
      // §2.12 (#441): describe reads. The compiler refuses a writing or
      // sending statement there at save; one that reaches the engine
      // anyway (a definition saved before the rule) is SKIPPED — the
      // text around it still prints, the world does not move, nothing
      // is queued. The builder hears about it where every problem is
      // heard: at the next save.
      if (describe && SPROUT_MUTATING_STATEMENTS.has(s.kind)) continue;
      if (s.kind === 'ext') {
        const found = this.ext.statement(s.statement);
        if (!found || (describe && !found.spec.inDescribe)) continue;
        this.record(frame, s, found.spec);
        continue;
      }
      switch (s.kind) {
        case 'if':
          this.run(truthy(this.evaluate(s.cond, frame)) ? s.then : s.else, frame, describe);
          break;
        case 'set':
          this.write(frame, s.property, this.evaluate(s.value, frame));
          break;
        case 'adjust': {
          const by = this.evaluate(s.by, frame);
          const current = frame.self.state[s.property];
          if (typeof by === 'number' && typeof current === 'number') {
            this.write(frame, s.property, current + by);
          }
          break;
        }
        case 'remember': {
          const field = rememberedFieldOf(frame.self, s.property);
          const value = field ? fit(field, this.evaluate(s.value, frame)) : undefined;
          if (value === undefined) break;
          if (frame.self.visitor[s.property] !== value) {
            frame.self.visitor[s.property] = value;
            this.remembered.add(frame.self.id);
          }
          break;
        }
        case 'say':
          if (!describe && s.text.trim() !== '') this.narration.push(s.text);
          break;
        case 'text':
          if (describe && s.text.trim() !== '') describe.push(s.text);
          break;
        case 'broadcast':
          this.broadcast(frame, s.message, s.value ? this.evaluate(s.value, frame) : null);
          break;
        case 'send': {
          const target = this.resolve(s.target, frame);
          if (!target) break; // an unknown name is ignored, as v0
          this.emit(frame, s.message, target.id, s.value ? this.evaluate(s.value, frame) : null);
          break;
        }
        case 'each': {
          for (const obj of this.contents(s.in, frame)) {
            const inner: Frame = { ...frame, bindings: new Map(frame.bindings) };
            inner.bindings.set(s.variable, { kind: 'object', id: obj.id });
            this.run(s.body, inner, describe);
          }
          break;
        }
        case 'move': {
          const what = this.resolve(s.what, frame);
          const to = this.resolve(s.to, frame);
          if (what && to) this.move(frame, what, to);
          break;
        }
        case 'spawn': {
          const target = this.resolve(s.in, frame);
          if (target) this.spawn(frame, s.kindName, target);
          break;
        }
        case 'destroy':
          this.destroy(frame);
          return; // nothing after it runs on what is gone
        case 'allow':
          frame.decision = { allow: true, text: '' };
          return;
        case 'refuse':
          frame.decision = { allow: false, text: s.text };
          return;
      }
    }
  }

  /**
   * An extension statement (§3.5): resolve its arguments, hand a frozen
   * read-only view of the frame to its `run`, and record what it
   * returns. Charged as an event; a throw is a fault naming the
   * extension; more than SPROUT_EFFECTS_PER_ACTION effects is a fault.
   */
  private record(
    frame: Frame,
    s: Extract<SproutStatement, { kind: 'ext' }>,
    spec: NonNullable<ReturnType<ExtensionSet['statement']>>['spec'],
  ): void {
    if (++this.budget.events > SPROUT_EVENT_BUDGET) {
      throw new Fault(
        `More than ${SPROUT_EVENT_BUDGET} events in one action — something here is answering itself without end.`,
        frame.self.id,
      );
    }
    const ref = (obj: SproutObject): ObjectRef =>
      Object.freeze({ id: obj.id, kind: obj.kind, name: obj.definition.name });
    const args: Record<string, ObjectRef | SproutValue | null> = {};
    for (const a of spec.args) {
      const arg = s.args[a.name] ?? null;
      if (!arg) {
        args[a.name] = null;
        continue;
      }
      switch (arg.kind) {
        case 'target': {
          const obj = this.resolve(arg.target, frame);
          args[a.name] = obj ? ref(obj) : null;
          break;
        }
        case 'symbol':
          args[a.name] = arg.name;
          break;
        case 'string':
          args[a.name] = arg.text;
          break;
        case 'expr':
          args[a.name] = this.evaluate(arg.expr, frame);
          break;
      }
    }
    const room = this.roomOf(frame.self);
    const container = this.containerOf(frame.self);
    const view: ReadOnlyFrame = Object.freeze({
      self: ref(frame.self),
      room: ref(room),
      container: container ? ref(container) : frame.self.kind === 'actor' ? ref(room) : null,
      actor: ref(this.scene.actor),
      resolve: (name: string) => {
        const obj = this.resolve({ kind: 'name', name }, frame);
        return obj ? ref(obj) : null;
      },
      get: (r: ObjectRef, property: string) => {
        const obj = this.objects.get(r.id);
        if (!obj || obj.kind === 'actor') return null;
        const value = obj.state[property];
        if (value !== undefined) return value;
        const known = wellKnownFor(obj.definition, this.ext).get(property);
        return known ? known.default : null;
      },
      is: (r: ObjectRef, kindName: string) => {
        const obj = this.objects.get(r.id);
        return obj
          ? truthy(
              this.evaluate(
                { kind: 'is', target: { kind: 'name', name: '' }, kindName },
                { ...frame, bindings: new Map([['', { kind: 'object', id: obj.id }]]) },
              ),
            )
          : false;
      },
    });
    let effect: Effect | void;
    try {
      effect = spec.run(view, Object.freeze(args) as BoundArgs);
    } catch (err) {
      throw new Fault(
        `The "${s.extension}" extension failed on "${s.statement}": ${err instanceof Error ? err.message : String(err)}`,
        frame.self.id,
      );
    }
    if (effect === undefined) return;
    if (this.effects.length >= SPROUT_EFFECTS_PER_ACTION) {
      throw new Fault(
        `More than ${SPROUT_EFFECTS_PER_ACTION} effects in one action.`,
        frame.self.id,
      );
    }
    this.effects.push(effect);
  }

  /** A property write, fit to its field; a real change fires the `changed` hook (§2.5). */
  private write(frame: Frame, property: string, raw: SproutValue | null): void {
    const field = fieldOf(frame.self, property, this.ext);
    const value = field ? fit(field, raw, this.ext) : undefined;
    if (value === undefined) return;
    const was = frame.self.state[property];
    if (was === value) return;
    frame.self.state[property] = value;
    this.changed.add(frame.self.id);
    if (frame.self.definition.hooks.some((h) => h.property === property)) {
      this.emit(frame, property, frame.self.id, value, { changed: { was: was ?? value } });
    }
  }

  // -- spawn and destroy (§2.8) ----------------------------------------------------------

  /**
   * `spawn Kind in target`: a new instance of one of the zone's published
   * kinds, at its defaults, placed without asking (it is being made, not
   * moved), then told `spawned`. Faults: an unknown or abstract kind, a
   * target that holds nothing, more than SPROUT_SPAWNS_PER_ACTION in
   * one action, or the zone's SPROUT_MAX_INSTANCES.
   */
  private spawn(frame: Frame, kindName: string, target: SproutObject): void {
    const kind = this.scene.kinds?.get(kindName);
    if (!kind) throw new Fault(`No kind called "${kindName}" is published here.`, frame.self.id);
    if (kind.abstract.length > 0) {
      throw new Fault(
        `"${kindName}" is abstract (${kind.abstract.join(', ')}) and cannot be made.`,
        frame.self.id,
      );
    }
    if (!isContainer(target)) {
      throw new Fault(
        `${target.definition.name} cannot hold a new ${kind.definition.name}.`,
        frame.self.id,
      );
    }
    if (++this.budget.spawns > SPROUT_SPAWNS_PER_ACTION) {
      throw new Fault(
        `More than ${SPROUT_SPAWNS_PER_ACTION} things made in one action.`,
        frame.self.id,
      );
    }
    const alive = this.ctx.liveCount + this.budget.made;
    if (alive >= SPROUT_MAX_INSTANCES) {
      throw new Fault(
        `This understory already holds ${SPROUT_MAX_INSTANCES} things — sweep it before making more.`,
        frame.self.id,
      );
    }
    const id = this.ctx.mint();
    const made: SproutObject = {
      id,
      kind: 'item',
      definition: kind.definition,
      kinds: kind.kinds,
      state: normalizeObjectState(kind.definition, {}, this.ext),
      visitor: {},
      container: target.id,
      home: this.roomOf(target).id,
      spawnedFrom: kindName,
    };
    this.objects.set(id, made);
    this.scene.items.push(made);
    this.spawned.push(made);
    this.budget.made++;
    this.emit(frame, 'spawned', id, null);
  }

  /** `destroy self`: an item leaves the world; what it held falls to what held it. */
  private destroy(frame: Frame): void {
    const self = frame.self;
    if (self.kind !== 'item') {
      throw new Fault(`${self.definition.name} cannot be destroyed.`, self.id);
    }
    for (const held of this.contentsOf(self)) {
      held.container = self.container;
      this.moved.set(held.id, self.container ?? '');
    }
    this.objects.delete(self.id);
    const at = this.scene.items.indexOf(self);
    if (at >= 0) this.scene.items.splice(at, 1);
    const made = this.spawned.indexOf(self);
    if (made >= 0) {
      this.spawned.splice(made, 1);
      this.budget.made--;
    } else this.destroyed.add(self.id);
    this.changed.delete(self.id);
    this.moved.delete(self.id);
  }

  // -- the containment protocol (§2.6) ------------------------------------------------

  /** Ask one consent guard: the object's own, else the language's default. Returns the refusal, or null. */
  private consent(
    guard: SproutConsentKind,
    self: SproutObject,
    params: SproutObject[],
    frame: Frame,
  ): string | null {
    const own = self.definition.consents.find((c) => c.guard === guard);
    if (own) {
      const inner: Frame = { ...frame, self, bindings: new Map(), decision: null };
      own.params.forEach((name, i) => {
        const p = params[i];
        if (p) inner.bindings.set(name, { kind: 'object', id: p.id });
      });
      this.run(own.body, inner);
      if (inner.decision && !inner.decision.allow) return inner.decision.text;
      return null;
    }
    switch (guard) {
      case 'depart': {
        // self is the thing moving; params: [to]. Only hands need it takeable.
        const to = params[0];
        return self.kind === 'item' && to?.kind === 'actor' && !takeableOf(self)
          ? REFUSALS.notTakeable
          : null;
      }
      case 'release':
        // self is where it is; params: [item, to].
        return openOf(self) ? null : REFUSALS.shut(self.definition.name);
      case 'accept': {
        // self is where it goes; params: [item, from].
        if (!openOf(self)) return REFUSALS.shut(self.definition.name);
        return this.contentsOf(self).length >= capacityOf(self)
          ? REFUSALS.full(self.definition.name)
          : null;
      }
    }
  }

  /**
   * `move what to to` (§2.6): three parties consent — or one refuses, and
   * the actor reads why — then containment changes and `left`, `entered`
   * and `moved` are sent. Returns whether it moved.
   */
  move(frame: Frame, what: SproutObject, to: SproutObject): boolean {
    const refuse = (text: string) => {
      this.narration.push(text);
      return false;
    };
    if (what.kind === 'room') return refuse(REFUSALS.itself);
    if (!isContainer(to)) return refuse(REFUSALS.notContainer);
    if (what.id === to.id || this.isInside(to, what)) return refuse(REFUSALS.itself);
    const from = this.containerOf(what) ?? (what.kind === 'actor' ? this.scene.room : null);
    if (from?.id === to.id) return true;
    const departure = this.consent('depart', what, [to], frame);
    if (departure !== null) return refuse(departure);
    if (from) {
      const release = this.consent('release', from, [what, to], frame);
      if (release !== null) return refuse(release);
    }
    const accept = this.consent('accept', to, [what, from ?? to], frame);
    if (accept !== null) return refuse(accept);
    what.container = to.id;
    this.moved.set(what.id, to.id);
    if (from) this.emit(frame, 'left', from.id, to.id, { from: what.id });
    this.emit(frame, 'entered', to.id, from?.id ?? null, { from: what.id });
    this.emit(frame, 'moved', what.id, to.id, { from: from?.id ?? what.id });
    return true;
  }

  // -- targets and expressions ----------------------------------------------------------

  /** A target as an object, or null (an unbound name, a value binding that is not an object). */
  resolve(target: SproutTarget, frame: Frame): SproutObject | null {
    switch (target.kind) {
      case 'self':
        return frame.self;
      case 'room':
        return this.roomOf(frame.self);
      case 'container':
        return frame.self.kind === 'actor' ? this.scene.room : this.containerOf(frame.self);
      case 'actor':
        return this.scene.actor;
      case 'name': {
        const bound = frame.bindings.get(target.name);
        if (bound) {
          if (bound.kind === 'object') return this.objects.get(bound.id) ?? null;
          return typeof bound.value === 'string' ? (this.objects.get(bound.value) ?? null) : null;
        }
        return this.byName(target.name);
      }
    }
  }

  /** A named object in range: by its identifier (the source's, else its name's), or one of its `:names`. */
  private byName(name: string): SproutObject | null {
    const key = name.toLowerCase();
    return (
      sorted(this.scene.items, this.scene.order).find(
        (i) =>
          (i.definition.ident ?? identOf(i.definition.name)) === key ||
          i.definition.names.includes(key),
      ) ?? null
    );
  }

  /** What `each … in` and `count` walk: the target container's direct contents. */
  private contents(target: SproutTarget, frame: Frame): SproutObject[] {
    const obj = this.resolve(target, frame);
    return obj && isContainer(obj) ? this.contentsOf(obj) : [];
  }

  evaluate(e: SproutExpr, frame: Frame): SproutValue | null {
    switch (e.kind) {
      case 'literal':
        return e.value;
      case 'symbol':
        return e.name;
      case 'ref': {
        const bound = frame.bindings.get(e.name);
        if (!bound) return null;
        return bound.kind === 'value' ? bound.value : bound.id;
      }
      case 'get': {
        const obj = this.resolve(e.target, frame);
        if (!obj || obj.kind === 'actor') return null;
        const value = obj.state[e.property];
        if (value !== undefined) return value;
        const known = wellKnownFor(obj.definition, this.ext).get(e.property);
        return known ? known.default : null;
      }
      case 'recall': {
        const value = frame.self.visitor[e.property];
        if (value !== undefined) return value;
        const field = rememberedFieldOf(frame.self, e.property);
        return field ? field.default : null;
      }
      case 'is': {
        const obj = this.resolve(e.target, frame);
        if (!obj) return false;
        if (e.kindName === 'Actor') return obj.kind === 'actor';
        if (e.kindName === 'Room') return obj.kind === 'room';
        if (e.kindName === 'Container') return obj.kind === 'item' && isContainer(obj);
        return obj.kinds.includes(e.kindName);
      }
      case 'count':
        return this.contents(e.target, frame).length;
      case 'not':
        return !truthy(this.evaluate(e.expr, frame));
      case 'binary': {
        const l = this.evaluate(e.left, frame);
        if (e.op === '&&') return truthy(l) ? this.evaluate(e.right, frame) : l;
        if (e.op === '||') return truthy(l) ? l : this.evaluate(e.right, frame);
        const r = this.evaluate(e.right, frame);
        switch (e.op) {
          case '==':
            return l === r;
          case '!=':
            return l !== r;
          case '<':
            return typeof l === 'number' && typeof r === 'number' && l < r;
          case '<=':
            return typeof l === 'number' && typeof r === 'number' && l <= r;
          case '>':
            return typeof l === 'number' && typeof r === 'number' && l > r;
          case '>=':
            return typeof l === 'number' && typeof r === 'number' && l >= r;
          case '+':
            return typeof l === 'number' && typeof r === 'number' ? l + r : 0;
          case '-':
            return typeof l === 'number' && typeof r === 'number' ? l - r : 0;
        }
      }
    }
  }
}

function truthy(v: SproutValue | null): boolean {
  return v !== null && v !== false && v !== 0 && v !== '';
}

function frameFor(obj: SproutObject): Frame {
  return { self: obj, depth: 0, envelope: null, bindings: new Map() };
}

function outcomeOf(runner: Runner): Outcome {
  return {
    ok: false,
    narration: runner.narration,
    changed: runner.changed,
    remembered: runner.remembered,
    moved: runner.moved,
    spawned: runner.spawned,
    destroyed: runner.destroyed,
    effects: runner.effects,
    events: 0,
    maxDepth: 0,
    fault: null,
  };
}

function settle(runner: Runner, outcome: Outcome, body: () => void): void {
  try {
    body();
    runner.drain();
  } catch (err) {
    if (!(err instanceof Fault)) throw err;
    outcome.fault = { message: err.message, chain: [...runner.chain], objectId: err.objectId };
  }
  outcome.events = runner.events;
  outcome.maxDepth = runner.maxDepth;
}

// --- projections ------------------------------------------------------------

/**
 * The object's prose right now: `describe` run for its `text`, paragraphs
 * joined; the plain prose when describe is empty or says nothing.
 * Describe may read other objects in range, so it takes the scene; alone,
 * it reads only itself.
 */
export function renderProse(obj: SproutObject, scene?: Scene, ctx?: TurnContext): string {
  return describeWith(obj, scene, ctx).prose;
}

/**
 * `describe`, run for its text AND the effects its extension statements
 * record (a `show` opens a picture on examine). Read-only (§2.12,
 * #441): `run` skips any statement that would write or send, and any
 * extension statement not marked for describe, so a look leaves the
 * world — and the request's budget — exactly as it found them; the
 * runner over the caller's scene draws on the turn's one budget
 * rather than minting its own.
 */
export function describeWith(
  obj: SproutObject,
  scene?: Scene,
  ctx?: TurnContext,
): { prose: string; effects: Effect[] } {
  if (obj.definition.describe.length === 0) return { prose: obj.definition.prose, effects: [] };
  const runner = new Runner(scene ?? sceneOf(obj), ctx ?? turnContext());
  const out: string[] = [];
  try {
    runner.run(obj.definition.describe, frameFor(obj), out);
  } catch (err) {
    if (!(err instanceof Fault)) throw err;
  }
  return {
    prose: out.length > 0 ? out.join('\n\n') : obj.definition.prose,
    effects: runner.effects,
  };
}

function sceneOf(obj: SproutObject): Scene {
  const actor = actorObject('actor');
  return obj.kind === 'room'
    ? { room: obj, actor, items: [] }
    : { room: { ...obj, kind: 'room', container: null, home: null }, actor, items: [obj] };
}

/** The verbs open right now — what the client renders as chips, never computes. */
export function openVerbs(obj: SproutObject, scene?: Scene, ctx?: TurnContext): string[] {
  const runner = new Runner(scene ?? sceneOf(obj), ctx ?? turnContext());
  const frame = frameFor(obj);
  return obj.definition.messages
    .filter((m) => reachable(m) && (!m.when || truthy(runner.evaluate(m.when, frame))))
    .map(verbLabel);
}

/**
 * What this room's objects remember about the visitor (§3.2, made
 * legible): only objects whose memory differs from its defaults, so a
 * fresh visitor — or one who just reset — sees an empty panel.
 */
export function memoryOf(scene: Scene): SproutMemory[] {
  const out: SproutMemory[] = [];
  for (const obj of [scene.room, ...sorted(scene.items, scene.order)]) {
    const fields = obj.definition.remembers
      .filter((f) => obj.visitor[f.name] !== defaultOf(f))
      .map((f) => ({ name: f.name, value: obj.visitor[f.name]! }));
    if (fields.length > 0) out.push({ object: obj.definition.name, fields });
  }
  return out;
}

/**
 * The items a visitor can see and address in one container: what it
 * holds, and what OPEN containers in it hold, recursively, in id order —
 * a closed chest keeps its contents to itself.
 */
export function visibleItems(scene: Scene, container: SproutObject): SproutObject[] {
  const runner = new Runner(scene, turnContext());
  const out: SproutObject[] = [];
  const walk = (c: SproutObject) => {
    for (const held of runner.contentsOf(c)) {
      if (held.kind !== 'item') continue;
      out.push(held);
      if (isContainer(held) && openOf(held)) walk(held);
    }
  };
  walk(container);
  return out;
}

// --- the verb ---------------------------------------------------------------

/**
 * Run one message on the room (targetId = room id) or an item present,
 * with its arguments bound to objects in range (arg name → object id).
 * The message is the depth-0 event; everything it emits drains FIFO. A
 * fault comes back in the outcome — the caller rolls back and records it.
 */
export function runVerb(
  scene: Scene,
  ctx: TurnContext,
  targetId: string,
  verbName: string,
  args: Readonly<Record<string, string>> = {},
): Outcome {
  const runner = new Runner(scene, ctx);
  const outcome = outcomeOf(runner);
  const target = runner.objects.get(targetId);
  if (!target) return outcome;
  const message = findMessage(target, verbName);
  if (!message) return outcome;
  const frame = frameFor(target);
  for (const arg of message.args) {
    const id = args[arg.name];
    if (!id || !runner.objects.has(id)) return outcome;
    frame.bindings.set(arg.name, { kind: 'object', id });
  }
  if (message.when && !truthy(runner.evaluate(message.when, frame))) return outcome;
  outcome.ok = true;
  frame.envelope = runner.root(message.name, target.id, null);
  settle(runner, outcome, () => runner.run(message.body, frame));
  return outcome;
}

/**
 * The built-in verbs (§2.6: take, drop, give, put … in, go) are one
 * proposal: move `whatId` into `toId`. `ok` is false when either is not
 * in the world; `refused` carries a guard's no (also spoken); a fault
 * comes back as for a verb.
 */
export function runMove(scene: Scene, ctx: TurnContext, whatId: string, toId: string): MoveOutcome {
  const runner = new Runner(scene, ctx);
  const outcome: MoveOutcome = { ...outcomeOf(runner), refused: null };
  const what = runner.objects.get(whatId);
  const to = runner.objects.get(toId);
  if (!what || !to) return outcome;
  outcome.ok = true;
  const frame = frameFor(scene.actor);
  frame.envelope = runner.root('move', what.id, to.id);
  settle(runner, outcome, () => {
    const before = runner.narration.length;
    if (!runner.move(frame, what, to)) {
      outcome.refused = runner.narration[before] ?? 'It stays where it is.';
    }
  });
  return outcome;
}
