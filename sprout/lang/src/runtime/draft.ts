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
// rest of the turn, holding the state it had.

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
  readonly visitors: readonly VisitKey[];
}

/** One write turn's working state over a committed `WorldState`. */
export class Draft implements StateReader {
  readonly world: InstanceId;
  private readonly base: WorldState;
  private serial: number;
  private readonly written = new Map<InstanceId, Instance>();
  private readonly gone = new Map<InstanceId, Instance>();
  private readonly held = new Map<InstanceId, readonly InstanceId[]>();
  private readonly visitors = new Map<VisitKey, VisitorRecord>();
  private committed = false;

  constructor(base: WorldState) {
    this.base = base;
    this.world = base.world;
    this.serial = base.serial;
  }

  instance(id: InstanceId): Instance | undefined {
    if (this.gone.has(id)) return undefined;
    return this.written.get(id) ?? this.base.instances.get(id);
  }

  children(id: InstanceId): readonly InstanceId[] {
    return this.held.get(id) ?? this.base.children.get(id) ?? [];
  }

  visitor(visit: VisitKey): VisitorRecord | undefined {
    return this.visitors.get(visit) ?? this.base.visitors.get(visit);
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
      this.base.dormant.has(id)
    ) {
      throw new Error(`\`${id}\` is taken, and an id is never reused.`);
    }
    if (created.container !== null && created.arrival === null) {
      throw new Error(`\`${id}\` arrives where it is put, so it has an arrival.`);
    }
    this.written.set(id, created);
    this.attach(created);
  }

  /**
   * Remove an instance that holds nothing; what it held falls first
   * (the spec's Destroying). The world is never removed.
   */
  remove(id: InstanceId): void {
    this.open();
    if (id === this.world) throw new Error('the world cannot be destroyed.');
    const current = this.existing(id);
    if (this.children(id).length > 0) {
      throw new Error(`\`${id}\` still holds something, which falls to its container first.`);
    }
    this.detach(current);
    this.written.delete(id);
    this.gone.set(id, current);
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
    for (const [id, held] of this.held) {
      if (held.length === 0) children.delete(id);
      else children.set(id, held);
    }
    const visitors = new Map(this.base.visitors);
    for (const [visit, record] of this.visitors) visitors.set(visit, record);
    const state: WorldState = {
      world: this.world,
      serial: this.serial,
      instances,
      dormant: this.base.dormant,
      visitors,
      children,
    };
    const sorted = <T extends string>(ids: Iterable<T>): T[] => [...ids].sort(compare);
    return {
      state,
      changes: {
        serial: this.serial,
        written: sorted(this.written.keys()),
        removed: sorted([...this.gone.keys()].filter((id) => this.base.instances.has(id))),
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

  private detach(instance: Instance): void {
    if (instance.container === null) return;
    this.held.set(
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
    this.held.set(instance.container, siblings);
  }
}

/** What a store writes for one committed turn: the records to upsert and the ids to delete. */
export function storedChanges(
  state: WorldState,
  changes: StateChanges,
): {
  readonly serial: number;
  readonly upsert: readonly StoredInstance[];
  readonly remove: readonly string[];
  readonly visitors: readonly StoredVisitor[];
} {
  const record = <T>(found: T | undefined, what: string): T => {
    if (found === undefined) throw new Error(`\`${what}\` changed and is not in the state.`);
    return found;
  };
  return {
    serial: changes.serial,
    upsert: changes.written.map((id) => encodeInstance(record(state.instances.get(id), id))),
    remove: [...changes.removed],
    visitors: changes.visitors.map((visit) =>
      encodeVisitor(record(state.visitors.get(visit), visit)),
    ),
  };
}
