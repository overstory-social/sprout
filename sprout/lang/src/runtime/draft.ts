// One write turn's changes to a world's state (the spec's The runtime ›
// Turns, State; Spawning; Destroying). A draft reads through to the
// state it was opened on and holds only what the turn changed, so
// dropping it leaves that state exactly as it was, a poll reading the
// committed state sees none of it, and what it holds is exactly the
// change set a store's transaction writes.
//
// Two rules a store relies on. Every serial a draft issues follows the
// state's own, so two drafts opened on one state mint the same ids, as a
// transaction body run twice must (core's conformance suite); and a
// serial is issued once, so a destroyed instance's id is never minted
// again. A destroyed instance stays readable through `destroyed` for the
// rest of the turn, holding the state it had; what it held, dormant
// records included, is removed with it, and every declared object among
// what is removed is tombstoned, gone for good (the spec's Destroying).

import { mintedId, type InstanceId, type VisitKey } from './ids.js';
import { encodeInstance, encodeVisitor } from './load.js';
import type { StoredInstance, StoredVisitor } from './stored.js';
import {
  codeUnitOrder as compare,
  type Instance,
  type StateReader,
  type VisitorRecord,
  type WorldState,
} from './state.js';

/** What one committed turn changed, by id: what a store upserts and deletes. */
export interface StateChanges {
  /** The world's serial after the turn. */
  readonly serial: number;
  /** Instances written or added, and still there at the end of the turn. */
  readonly written: readonly InstanceId[];
  /** Instances there before the turn and removed by it. */
  readonly removed: readonly InstanceId[];
  /** Declared objects this turn destroyed, each a tombstone the store keeps for good. */
  readonly tombstoned: readonly InstanceId[];
  readonly visitors: readonly VisitKey[];
}

/** One write turn's working state over a committed `WorldState`. */
export class Draft implements StateReader {
  readonly world: InstanceId;
  private readonly base: WorldState;
  private serial: number;
  private readonly written = new Map<InstanceId, Instance>();
  private readonly gone = new Map<InstanceId, Instance>();
  private readonly goneDormant = new Set<InstanceId>();
  private readonly buried = new Set<InstanceId>();
  private readonly contents = new Map<InstanceId, readonly InstanceId[]>();
  private stored: number;
  private readonly visitors = new Map<VisitKey, VisitorRecord>();
  private committed = false;

  constructor(base: WorldState) {
    this.base = base;
    this.world = base.world;
    this.serial = base.serial;
    this.stored = base.instances.size + base.dormant.size;
  }

  /**
   * How many instances the world stores now: the world, declared,
   * spawned, visitors and dormant alike, which is what the host's bound
   * on live instances counts (the spec's Limits › Runtime budgets).
   */
  get held(): number {
    return this.stored;
  }

  instance(id: InstanceId): Instance | undefined {
    if (this.gone.has(id)) return undefined;
    return this.written.get(id) ?? this.base.instances.get(id);
  }

  children(id: InstanceId): readonly InstanceId[] {
    return this.contents.get(id) ?? this.base.children.get(id) ?? [];
  }

  visitor(visit: VisitKey): VisitorRecord | undefined {
    return this.visitors.get(visit) ?? this.base.visitors.get(visit);
  }

  /** Every visitor record as the turn stands, in code-unit order of the visit. */
  everyVisitor(): VisitorRecord[] {
    const visits = new Set([...this.base.visitors.keys(), ...this.visitors.keys()]);
    return [...visits].sort(compare).map((visit) => this.visitor(visit)!);
  }

  tombstoned(id: InstanceId): boolean {
    return this.buried.has(id) || this.base.tombstones.has(id);
  }

  /** A dormant record, kept untouched, that this turn has not removed. */
  dormant(id: InstanceId): StoredInstance | undefined {
    return this.goneDormant.has(id) ? undefined : this.base.dormant.get(id);
  }

  /**
   * `id` and everything inside it, all the way down, decoded and dormant
   * alike: pre-order, each container's decoded contents in contents order
   * and then its dormant records by id. Stored records that hold each
   * other are each visited once.
   */
  subtree(id: InstanceId): readonly InstanceId[] {
    const found: InstanceId[] = [];
    const seen = new Set<InstanceId>();
    const dormantIn = this.dormantByContainer();
    const visit = (at: InstanceId): void => {
      if (seen.has(at)) return;
      seen.add(at);
      found.push(at);
      for (const child of this.children(at)) visit(child);
      for (const record of dormantIn.get(at) ?? []) visit(record);
    };
    visit(id);
    return found;
  }

  /** An instance this turn removed, as it was when removed. */
  destroyed(id: InstanceId): Instance | undefined {
    return this.gone.get(id);
  }

  /** The world's next serial: one counter for minted ids, arrivals and wakes. */
  nextSerial(): number {
    this.open();
    this.serial += 1;
    return this.serial;
  }

  /** A new id, never issued before. */
  mint(): InstanceId {
    return mintedId(this.world, this.nextSerial());
  }

  /** Replace an instance's record. Where it is, and when it arrived, change only through `place`. */
  write(next: Instance): void {
    this.open();
    const current = this.existing(next.id);
    if (next.container !== current.container || next.arrival !== current.arrival) {
      throw new Error(`\`${next.id}\` is moved with \`place\`, not by writing its record.`);
    }
    this.written.set(next.id, next);
  }

  /**
   * Move an instance into `container`, last in its contents order under
   * a new arrival serial, or out of the tree for a visitor going away.
   * The world stays where it is, and nothing goes inside itself.
   */
  place(id: InstanceId, container: InstanceId | null): void {
    this.open();
    if (id === this.world) throw new Error('the world has no container, and cannot be moved.');
    const current = this.existing(id);
    if (container === null && current.made.from !== 'visitor') {
      throw new Error(`\`${id}\` is not a visitor, so it is always somewhere.`);
    }
    if (container !== null) {
      if (container !== this.world) this.existing(container);
      const climbed = new Set<InstanceId>();
      for (let at: InstanceId | null = container; at !== null && !climbed.has(at);) {
        if (at === id) throw new Error(`\`${id}\` cannot go inside itself.`);
        climbed.add(at);
        at = this.instance(at)?.container ?? null;
      }
    }
    this.detach(current);
    // Going away is not an arrival: an away visitor keeps the serial it last arrived under.
    const arrival = container === null ? current.arrival : this.nextSerial();
    const moved: Instance = { ...current, container, arrival };
    this.written.set(id, moved);
    this.attach(moved);
  }

  /** A spawn or a visitor, new to the world: its id is one no instance has had. */
  add(created: Instance): void {
    this.open();
    const id = created.id;
    if (
      id === this.world ||
      this.instance(id) !== undefined ||
      this.gone.has(id) ||
      this.base.dormant.has(id) ||
      this.tombstoned(id)
    ) {
      throw new Error(`\`${id}\` is taken, and an id is never reused.`);
    }
    if (created.container !== null && created.arrival === null) {
      throw new Error(`\`${id}\` arrives where it is put, so it has an arrival.`);
    }
    this.written.set(id, created);
    this.stored += 1;
    this.attach(created);
  }

  /**
   * Remove `id` and everything inside it, dormant records included, as
   * `subtree` orders them, and return what was removed. Each declared
   * object removed is tombstoned. The world is never removed.
   */
  remove(id: InstanceId): readonly InstanceId[] {
    this.open();
    if (id === this.world) throw new Error('the world cannot be destroyed.');
    this.detach(this.existing(id));
    const removed = this.subtree(id);
    for (const one of removed) {
      const decoded = this.instance(one);
      if ((decoded ?? this.dormant(one))?.made.from === 'declared') this.buried.add(one);
      if (decoded === undefined) this.goneDormant.add(one);
      else {
        this.written.delete(one);
        this.gone.set(one, decoded);
      }
      if (this.children(one).length > 0) this.contents.set(one, []);
      this.stored -= 1;
    }
    return removed;
  }

  putVisitor(record: VisitorRecord): void {
    this.open();
    this.visitors.set(record.visit, record);
  }

  /** The state after this turn, and what changed. A draft commits once. */
  commit(): { readonly state: WorldState; readonly changes: StateChanges } {
    this.open();
    this.committed = true;
    const instances = new Map(this.base.instances);
    for (const [id, instance] of this.written) instances.set(id, instance);
    for (const id of this.gone.keys()) instances.delete(id);
    const children = new Map(this.base.children);
    for (const [id, held] of this.contents) {
      if (held.length === 0) children.delete(id);
      else children.set(id, held);
    }
    const visitors = new Map(this.base.visitors);
    for (const [visit, record] of this.visitors) visitors.set(visit, record);
    const dormant = new Map(this.base.dormant);
    for (const id of this.goneDormant) dormant.delete(id);
    const state: WorldState = {
      world: this.world,
      serial: this.serial,
      instances,
      dormant,
      visitors,
      tombstones: new Set([...this.base.tombstones, ...this.buried]),
      children,
    };
    const sorted = <T extends string>(ids: Iterable<T>): T[] => [...ids].sort(compare);
    return {
      state,
      changes: {
        serial: this.serial,
        written: sorted(this.written.keys()),
        removed: sorted([
          ...[...this.gone.keys()].filter((id) => this.base.instances.has(id)),
          ...this.goneDormant,
        ]),
        tombstoned: sorted(this.buried),
        visitors: sorted(this.visitors.keys()),
      },
    };
  }

  private open(): void {
    if (this.committed) throw new Error('this turn has committed, and its draft is closed.');
  }

  private existing(id: InstanceId): Instance {
    const instance = this.instance(id);
    if (instance === undefined) throw new Error(`\`${id}\` is not an instance in this world.`);
    return instance;
  }

  /** Each container's dormant records not yet removed, by id. */
  private dormantByContainer(): ReadonlyMap<InstanceId, readonly InstanceId[]> {
    const held = new Map<InstanceId, InstanceId[]>();
    for (const [id, record] of this.base.dormant) {
      if (this.goneDormant.has(id) || record.container === null) continue;
      const container = record.container as InstanceId;
      held.set(container, [...(held.get(container) ?? []), id]);
    }
    for (const ids of held.values()) ids.sort(compare);
    return held;
  }

  private detach(instance: Instance): void {
    if (instance.container === null) return;
    this.contents.set(
      instance.container,
      this.children(instance.container).filter((id) => id !== instance.id),
    );
  }

  /** Into its container's contents, after everything that arrived before it. */
  private attach(instance: Instance): void {
    if (instance.container === null) return;
    const siblings = [...this.children(instance.container)];
    let at = siblings.length;
    while (at > 0) {
      const before = this.instance(siblings[at - 1]!)!;
      if (before.arrival === null || before.arrival < instance.arrival!) break;
      at -= 1;
    }
    siblings.splice(at, 0, instance.id);
    this.contents.set(instance.container, siblings);
  }
}

/**
 * What changed from `base` to `after`, a state committed from it through
 * one draft or several: every record not the one `base` held, and every
 * record `base` held that `after` does not.
 */
export function changesBetween(base: WorldState, after: WorldState): StateChanges {
  const sorted = <T extends string>(ids: Iterable<T>): T[] => [...ids].sort(compare);
  const held = (state: WorldState, id: InstanceId): boolean =>
    state.instances.has(id) || state.dormant.has(id);
  return {
    serial: after.serial,
    written: sorted(
      [...after.instances].filter(([id, one]) => base.instances.get(id) !== one).map(([id]) => id),
    ),
    removed: sorted(
      [...base.instances.keys(), ...base.dormant.keys()].filter((id) => !held(after, id)),
    ),
    tombstoned: sorted([...after.tombstones].filter((id) => !base.tombstones.has(id))),
    visitors: sorted(
      [...after.visitors]
        .filter(([visit, one]) => base.visitors.get(visit) !== one)
        .map(([visit]) => visit),
    ),
  };
}

/** What a store writes for one committed turn, in the stored form. */
export interface StoredChanges {
  /** The world's serial after the turn. */
  readonly serial: number;
  /** Instance records written whole, each replacing the one stored under its id. */
  readonly upsert: readonly StoredInstance[];
  /** The ids of instance records to delete. */
  readonly remove: readonly string[];
  /** Tombstones to add, kept for good. */
  readonly tombstones: readonly string[];
  /** Visitor records written whole, each replacing the one stored under its visit. */
  readonly visitors: readonly StoredVisitor[];
}

/** What a store writes for one committed turn: the records to upsert, the ids to delete, and the tombstones to add. */
export function storedChanges(state: WorldState, changes: StateChanges): StoredChanges {
  const record = <T>(found: T | undefined, what: string): T => {
    if (found === undefined) throw new Error(`\`${what}\` changed and is not in the state.`);
    return found;
  };
  return {
    serial: changes.serial,
    upsert: changes.written.map((id) => encodeInstance(record(state.instances.get(id), id))),
    remove: [...changes.removed],
    tombstones: [...changes.tombstoned],
    visitors: changes.visitors.map((visit) =>
      encodeVisitor(record(state.visitors.get(visit), visit)),
    ),
  };
}
