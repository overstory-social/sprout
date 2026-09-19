import {
  actorObject,
  kindAsItem,
  normalizeObjectState,
  normalizeState,
  type ExtensionSet,
  type Outcome,
  type Program,
  type Scene,
  type SpawnableKind,
  type SproutObject,
  type SproutState,
} from '@overstory/sprout/lang';

import type { MemoryRecord, ObjectRecord } from './records.js';

// From records to a Scene and back (the split proposal §4.1, §4.2): the
// program says what exists and where it starts; the object rows say
// where things are now and what state they hold; the actor's memory row
// says what each object remembers about them. A placed thing with no row
// is at home at its defaults. A row whose identifier resolves to nothing
// in the program (the host loaded an archive without it) is dropped.
// Core builds the scene in O(n) with prebuilt maps.

/** Every object of the microworld as the engine sees it, by id: rooms, placed objects, spawned instances. */
export interface Microworld {
  objects: Map<string, SproutObject>;
  kinds: Map<string, SpawnableKind>;
  /** Delivery order (§3.3): placed objects in declaration order, then spawned ones in spawn order. */
  order: Map<string, number>;
  /** Rows that named nothing the program has — reported by `inspect`, never played. */
  orphans: string[];
}

/** The zone's kinds as the engine spawns them; the kind's name stands in for a row id. */
export function spawnableKinds(program: Program): Map<string, SpawnableKind> {
  const out = new Map<string, SpawnableKind>();
  for (const [name, kind] of program.kinds) {
    out.set(name, { kindId: name, ...kindAsItem(kind, program.kinds) });
  }
  return out;
}

/** The room an object's placement reaches, walking containers. */
function homeOf(program: Program, ident: string): string | null {
  let cur: string | undefined = ident;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    if (program.rooms.has(cur)) return cur;
    seen.add(cur);
    cur = program.objects.get(cur)?.placedIn;
  }
  return null;
}

export function microworldOf(
  program: Program,
  rows: readonly ObjectRecord[],
  memory: MemoryRecord | null,
  ext: ExtensionSet,
): Microworld {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const objects = new Map<string, SproutObject>();
  const orphans: string[] = [];
  const remembered = (id: string, def: SproutObject['definition']): SproutState =>
    normalizeState(def.remembers, memory?.byObject[id], ext);
  for (const room of program.rooms.values()) {
    const row = byId.get(room.ident);
    objects.set(room.ident, {
      id: room.ident,
      kind: 'room',
      definition: room.definition,
      kinds: [],
      state: normalizeObjectState(room.definition, row?.state ?? {}, ext),
      visitor: remembered(room.ident, room.definition),
      container: null,
      home: null,
      spawnedFrom: null,
    });
  }
  for (const ident of program.order) {
    const obj = program.objects.get(ident)!;
    const row = byId.get(ident);
    objects.set(ident, {
      id: ident,
      kind: 'item',
      definition: obj.definition,
      kinds: obj.kinds,
      state: normalizeObjectState(obj.definition, row?.state ?? {}, ext),
      visitor: remembered(ident, obj.definition),
      container: row?.container ?? obj.placedIn,
      home: row?.home ?? homeOf(program, ident),
      spawnedFrom: null,
    });
  }
  const kinds = spawnableKinds(program);
  for (const row of rows) {
    if (objects.has(row.id)) continue;
    const kind = row.spawnedFrom ? kinds.get(row.spawnedFrom) : undefined;
    if (!kind) {
      orphans.push(row.id);
      continue;
    }
    objects.set(row.id, {
      id: row.id,
      kind: 'item',
      definition: kind.definition,
      kinds: kind.kinds,
      state: normalizeObjectState(kind.definition, row.state, ext),
      visitor: remembered(row.id, kind.definition),
      container: row.container,
      home: row.home,
      spawnedFrom: row.spawnedFrom,
    });
  }
  const order = new Map<string, number>();
  for (const ident of program.order) order.set(ident, order.size);
  const spawnNumber = (id: string) => Number(id.slice(id.lastIndexOf('-') + 1)) || 0;
  for (const id of [...objects.keys()]
    .filter((id) => !order.has(id) && objects.get(id)!.kind === 'item')
    .sort((a, b) => spawnNumber(a) - spawnNumber(b))) {
    order.set(id, order.size);
  }
  return { objects, kinds, order, orphans };
}

/** The items whose container chain reaches one of `roots` (a room, an actor, a container in either). */
export function under(
  objects: ReadonlyMap<string, SproutObject>,
  roots: ReadonlySet<string>,
): SproutObject[] {
  const out: SproutObject[] = [];
  for (const obj of objects.values()) {
    if (obj.kind !== 'item') continue;
    let cur: string | null = obj.container;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      if (roots.has(cur)) {
        out.push(obj);
        break;
      }
      seen.add(cur);
      cur = objects.get(cur)?.container ?? null;
    }
  }
  return out;
}

/**
 * The scene for `actorId` standing in `roomId`: the room, the actor, what
 * the room and the hands hold at any depth; `elsewhere` for a move across
 * rooms (the destination and its contents) or hands (another actor and
 * theirs).
 */
export function sceneFor(
  world: Microworld,
  actorId: string,
  roomId: string,
  elsewhere: { room?: string; actors?: readonly string[] } = {},
): Scene {
  const room = world.objects.get(roomId);
  if (!room || room.kind !== 'room') throw new Error(`no room ${roomId}`);
  const actor = actorObject(actorId);
  const items = under(world.objects, new Set([roomId, actorId]));
  const others: SproutObject[] = [];
  if (elsewhere.room && elsewhere.room !== roomId) {
    const there = world.objects.get(elsewhere.room);
    if (there) others.push(there, ...under(world.objects, new Set([elsewhere.room])));
  }
  for (const id of elsewhere.actors ?? []) {
    if (id === actorId) continue;
    others.push(actorObject(id), ...under(world.objects, new Set([id])));
  }
  return {
    room,
    actor,
    items,
    ...(others.length > 0 ? { elsewhere: others } : {}),
    kinds: world.kinds,
    order: world.order,
  };
}

/**
 * The rows an outcome changed: state written, position changed, things
 * spawned; and the ids destroyed. Actors are not object rows — their
 * room lives on the actor record.
 */
export function rowsAfter(
  microworldId: string,
  scene: Scene,
  outcome: Outcome,
  actorIds: ReadonlySet<string>,
): { upsert: ObjectRecord[]; remove: string[] } {
  const everything = [scene.room, ...scene.items, ...(scene.elsewhere ?? [])];
  const touched = new Set<string>([
    ...outcome.changed,
    ...outcome.moved.keys(),
    ...outcome.spawned.map((s) => s.id),
  ]);
  const upsert: ObjectRecord[] = [];
  for (const obj of everything) {
    if (!touched.has(obj.id) || obj.kind === 'actor' || actorIds.has(obj.id)) continue;
    if (outcome.destroyed.has(obj.id)) continue;
    upsert.push({
      microworldId,
      id: obj.id,
      spawnedFrom: obj.spawnedFrom,
      container: obj.container,
      home: obj.home,
      state: obj.state,
    });
  }
  return { upsert, remove: [...outcome.destroyed] };
}

/** The memory row after a turn: every object whose memory of the actor a statement wrote. */
export function memoryAfter(memory: MemoryRecord, scene: Scene, outcome: Outcome): MemoryRecord {
  const byObject = { ...memory.byObject };
  for (const obj of [scene.room, ...scene.items]) {
    if (outcome.remembered.has(obj.id)) byObject[obj.id] = obj.visitor;
  }
  return { ...memory, byObject };
}

/** FNV-1a over a string, as eight hex digits: a content stamp, not a secret. */
export function stampOf(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
