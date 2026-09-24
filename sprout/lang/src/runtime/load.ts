// Stored state read against the bundle now, and written back (the
// spec's The runtime › State; The compiler › What absent means). A new
// world and a reloaded one take one path: an empty store reconciled
// against the catalogue is the initial state.
//
// Reconciling keeps what fits and says what it drops. A property keeps
// its stored value when it still fits the type now declared, and falls
// to the default otherwise; one no longer declared is dropped. Anything
// that cannot be decoded, because its object, its kind or its file is
// absent, is kept dormant and saved back exactly as it was read, so a file
// restored brings its objects back as they were. Links, wakes and ticks
// are kept as stored: B28 reconciles link names, and a wake list longer
// than the host's cap is kept whole, since the cap is on asking. A
// visitor whose place is gone keeps its record; B42 applies the absent
// table's rows when they next arrive.
//
// A tombstone is kept as stored, and a declared object with one is never
// made again, nor anything declared inside it, what a kind gives it and
// what source has added since included (the spec's Destroying).

import { contentAt } from '../declare/contents.js';
import type { KindRef } from '../declare/kinds.js';
import type { ResolvedProperty } from '../declare/properties.js';
import type { StaticCaps } from '../bundle/limits.js';
import type { Catalogue } from './catalogue.js';
import { visitKey, type InstanceId } from './ids.js';
import {
  decodeValue,
  encodeValue,
  readStoredWorld,
  StoredStateUnreadable,
  type StoredInstance,
  type StoredProperty,
  type StoredVisitor,
  type StoredWorld,
} from './stored.js';
import {
  childrenOf,
  codeUnitOrder as compare,
  newInstance,
  type Instance,
  type VisitorRecord,
  type WorldState,
} from './state.js';
import type { Value } from './values.js';

/** A stored value a load did not keep, and why: its property is gone, or it no longer fits. */
export interface Dropped {
  readonly id: InstanceId;
  readonly property: string;
  /** The actor, for a remembered value; null for a property. */
  readonly actor: InstanceId | null;
  readonly why: 'undeclared' | 'retyped' | 'no-longer-fits';
}

/** What a load made of stored state. */
export interface Loaded {
  readonly state: WorldState;
  /** Declared objects nothing was stored for and none destroyed, now at their defaults, in declared order. */
  readonly created: readonly InstanceId[];
  /** What is kept untouched because it cannot be decoded now, by id. */
  readonly dormant: readonly InstanceId[];
  readonly dropped: readonly Dropped[];
}

/** A world with nothing stored: serial 0, no instances, no visitors. */
export function emptyWorld(world: InstanceId): StoredWorld {
  return { world, serial: 0, instances: [], visitors: [], tombstones: [] };
}

/** A new world's state: an empty store, loaded. */
export function initialState(catalogue: Catalogue): WorldState {
  return loadWorld(emptyWorld(catalogue.world), catalogue).state;
}

/**
 * Read `stored` against the bundle `catalogue` describes. A store the
 * schema refuses, or another world's, throws `StoredStateUnreadable`:
 * that is the host's defect, not the world's. The order instances were
 * stored in never matters.
 */
export function loadWorld(stored: unknown, catalogue: Catalogue): Loaded {
  const read = readStoredWorld(stored);
  if (read.world !== catalogue.world) {
    throw new StoredStateUnreadable(
      `the store holds \`${read.world}\`, and this is \`${catalogue.world}\`.`,
    );
  }
  const instances = new Map<InstanceId, Instance>();
  const dormant = new Map<InstanceId, StoredInstance>();
  const dropped: Dropped[] = [];

  for (const record of [...read.instances].sort(byId)) {
    const id = record.id as InstanceId;
    const kind = kindOf(record, catalogue);
    if (kind === null) dormant.set(id, record);
    else instances.set(id, decodeInstance(record, kind, catalogue.caps, dropped));
  }

  const created: InstanceId[] = [];
  const unstored = (id: InstanceId) => !instances.has(id) && !dormant.has(id);
  if (unstored(catalogue.world)) {
    if (catalogue.worldKind === null) dormant.set(catalogue.world, emptyRecord(catalogue.world));
    else {
      instances.set(
        catalogue.world,
        newInstance(
          catalogue.world,
          { from: 'world' },
          catalogue.worldKind,
          null,
          null,
          catalogue.caps,
        ),
      );
      created.push(catalogue.world);
    }
  }
  const tombstones = new Set(read.tombstones as readonly InstanceId[]);
  // Rank walks the tree outside in, so a container is settled before what it holds.
  const gone = new Set<InstanceId>();
  const declared = [...catalogue.declared.values()].sort((a, b) => a.rank - b.rank);
  for (const entry of declared) {
    if (tombstones.has(entry.id) || gone.has(entry.container)) {
      gone.add(entry.id);
      continue;
    }
    if (entry.kind === null || !unstored(entry.id)) continue;
    instances.set(
      entry.id,
      newInstance(
        entry.id,
        { from: 'declared' },
        entry.kind,
        entry.container,
        null,
        catalogue.caps,
      ),
    );
    created.push(entry.id);
  }

  const visitors = new Map<VisitorRecord['visit'], VisitorRecord>();
  for (const visitor of [...read.visitors].sort((a, b) => compare(a.visit, b.visit))) {
    visitors.set(visitKey(visitor.visit), {
      visit: visitKey(visitor.visit),
      nickname: visitor.nickname,
      instance: visitor.instance as InstanceId,
      lastPlace: visitor.lastPlace as InstanceId | null,
    });
  }

  const rank = (id: InstanceId) => catalogue.declared.get(id)?.rank ?? Number.MAX_SAFE_INTEGER;
  return {
    state: {
      world: catalogue.world,
      serial: read.serial,
      instances,
      dormant,
      visitors,
      tombstones,
      children: childrenOf(instances.values(), rank),
    },
    created,
    dormant: [...dormant.keys()].sort(compare),
    dropped,
  };
}

/**
 * What a stored instance is decoded as now, or null to keep it dormant:
 * the world against the world kind, a declared object against its
 * placement's kind, a spawn against the kind it names, a spawned
 * instance's content against what the kind's body writes there now, a
 * visitor against the visitor kind.
 */
function kindOf(record: StoredInstance, catalogue: Catalogue): KindRef | null {
  switch (record.made.from) {
    case 'world':
      return catalogue.worldKind;
    case 'declared':
      return catalogue.declared.get(record.id as InstanceId)?.kind ?? null;
    case 'visitor':
      return catalogue.visitorKind;
    case 'spawned':
      return catalogue.kinds.get(record.made.kind) ?? null;
    case 'given':
      return contentAt(catalogue.contents, record.made.kind, record.made.path)?.kind ?? null;
  }
}

/** The record a world with no world kind is kept as until it has one. */
function emptyRecord(world: InstanceId): StoredInstance {
  return {
    id: world,
    made: { from: 'world' },
    container: null,
    arrival: null,
    properties: {},
    links: {},
    wakes: [],
    memory: {},
    lastTick: null,
  };
}

/**
 * A stored instance under `kind`: every property the kind declares
 * plainly, from what was stored where it fits and the default where it
 * does not or nothing was; memory only where it was written and fits.
 * What is not kept is added to `dropped`.
 */
function decodeInstance(
  record: StoredInstance,
  kind: KindRef,
  caps: StaticCaps,
  dropped: Dropped[],
): Instance {
  const id = record.id as InstanceId;
  // The world is the root whatever its record says: it has no container
  // and never arrived (the spec's The world model).
  const root = record.made.from === 'world';
  const fresh = newInstance(
    id,
    record.made,
    kind,
    root ? null : (record.container as InstanceId | null),
    root ? null : record.arrival,
    caps,
  );
  const properties = new Map(fresh.properties);
  for (const name of Object.keys(record.properties).sort(compare)) {
    const kept = keep(kind.properties.get(name), false, record.properties[name]!, caps);
    if (kept.fits) properties.set(name, kept.value);
    else dropped.push({ id, property: name, actor: null, why: kept.why });
  }

  const memory = new Map<InstanceId, ReadonlyMap<string, Value>>();
  for (const actor of Object.keys(record.memory).sort(compare)) {
    const written = record.memory[actor]!;
    const values = new Map<string, Value>();
    for (const name of Object.keys(written).sort(compare)) {
      const kept = keep(kind.properties.get(name), true, written[name]!, caps);
      if (kept.fits) values.set(name, kept.value);
      else dropped.push({ id, property: name, actor: actor as InstanceId, why: kept.why });
    }
    if (values.size > 0) memory.set(actor as InstanceId, values);
  }

  return {
    ...fresh,
    properties,
    links: new Map(Object.entries(record.links) as [string, InstanceId][]),
    wakes: record.wakes.map((wake) => ({ ...wake })),
    memory,
    lastTick: record.lastTick,
  };
}

type Kept =
  | { readonly fits: true; readonly value: Value }
  | { readonly fits: false; readonly why: Dropped['why'] };

/**
 * A stored value read under what is declared now. A property declared
 * the other way, plain where it was remembered or the reverse, is
 * retyped: the working notes count that as a change of type.
 */
function keep(
  property: ResolvedProperty | undefined,
  remembered: boolean,
  stored: StoredProperty,
  caps: StaticCaps,
): Kept {
  if (property === undefined) return { fits: false, why: 'undeclared' };
  if (property.remembered !== remembered) return { fits: false, why: 'retyped' };
  return decodeValue(property.type, stored, caps);
}

/** State as a store keeps it: decoded instances encoded, dormant ones verbatim, everything by id, tombstones included. */
export function saveWorld(state: WorldState): StoredWorld {
  const instances: StoredInstance[] = [
    ...[...state.instances.values()].map(encodeInstance),
    ...state.dormant.values(),
  ].sort(byId);
  const visitors = [...state.visitors.values()]
    .map(encodeVisitor)
    .sort((a, b) => compare(a.visit, b.visit));
  const tombstones = [...state.tombstones].sort(compare);
  return { world: state.world, serial: state.serial, instances, visitors, tombstones };
}

/** One instance as a store keeps it, every map written in key order. */
export function encodeInstance(instance: Instance): StoredInstance {
  const typed = (name: string): ResolvedProperty => {
    const property = instance.kind.properties.get(name);
    if (property === undefined) {
      throw new Error(`\`${instance.id}\` holds \`:${name}\`, which its kind does not declare.`);
    }
    return property;
  };
  const encoded = (values: ReadonlyMap<string, Value>): Record<string, StoredProperty> =>
    Object.fromEntries(
      [...values.keys()]
        .sort(compare)
        .map((name) => [name, encodeValue(typed(name).type, values.get(name)!)]),
    );
  return {
    id: instance.id,
    made: instance.made,
    container: instance.container,
    arrival: instance.arrival,
    properties: encoded(instance.properties),
    links: Object.fromEntries([...instance.links].sort(([a], [b]) => compare(a, b))),
    wakes: instance.wakes.map((wake) => ({ ...wake })),
    memory: Object.fromEntries(
      [...instance.memory.keys()]
        .sort(compare)
        .map((actor) => [actor, encoded(instance.memory.get(actor)!)]),
    ),
    lastTick: instance.lastTick,
  };
}

/** One visitor as a store keeps it. */
export function encodeVisitor(visitor: VisitorRecord): StoredVisitor {
  return {
    visit: visitor.visit,
    nickname: visitor.nickname,
    instance: visitor.instance,
    lastPlace: visitor.lastPlace,
  };
}

function byId(a: { readonly id: string }, b: { readonly id: string }): number {
  return compare(a.id, b.id);
}
