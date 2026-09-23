import { z } from 'zod';

import type { StaticCaps } from '@overstory/sprout/lang';

// What a store holds for one microworld: seven record types, every one
// a zod schema, because an adapter author
// needs them and a document adapter validates what it reads back. Core
// owns RUNTIME state only; nothing here is authored. Every key carries
// the microworld: object ids are source identifiers, and `torch` in one
// microworld must never share a row with `torch` in another.

/**
 * A property map as the store keeps it: whatever JSON holds. These
 * records carry the previous state model until a later item replaces
 * them with the language's stored form, `StoredWorld`, whose values are
 * typed against the bundle's declarations.
 */
export const SproutState = z.record(z.string(), z.unknown());
export type SproutState = z.infer<typeof SproutState>;

/** An archive as the store keeps it: the files and the manifest, so a cold process can recompile without asking the host. */
export const StoredArchive = z.object({
  files: z.array(z.object({ name: z.string(), source: z.string() })),
  manifest: z.record(z.string(), z.unknown()).nullable(),
});
export type StoredArchive = z.infer<typeof StoredArchive>;

/** A cap as a store keeps it: a whole number from 1. */
const cap = z.number().int().positive();
/** A cap the spec leaves to the host, which may have set none. */
const hostCap = cap.nullable();

/**
 * The static caps a microworld's bundle was checked against when it was
 * published (the spec's Limits), kept so the next load can compare them
 * with the host's caps then. Every cap is named, since a record says what
 * it was checked against rather than falling back to a figure.
 */
export const RecordedCaps = z.object({
  optionsPerEnum: cap,
  rolesPerVerb: cap,
  phrasesPerVerb: cap,
  phraseCharacters: cap,
  nounsPerObject: cap,
  nounCharacters: cap,
  exitsPerPlace: cap,
  listElements: cap,
  literalCharacters: cap,
  places: hostCap,
  objects: hostCap,
  kinds: hostCap,
  files: hostCap,
  sourceBytes: hostCap,
}) satisfies z.ZodType<StaticCaps>;
export type RecordedCaps = z.infer<typeof RecordedCaps>;

/** A library content hash as the language writes it: SHA-256, in lower-case hex. */
const libraryHash = z.string().regex(/^[0-9a-f]{64}$/);

export const MicroworldRecord = z.object({
  id: z.string().min(1),
  archive: StoredArchive,
  /** The archive's content stamp — the program cache's key. */
  stamp: z.string(),
  /** The language level the archive needs. */
  level: z.number().int(),
  /** The extensions the archive uses. */
  extensions: z.array(z.string()),
  /** The static caps its bundle was checked against at publish. */
  caps: RecordedCaps,
  /** Whether the host has made an exception for it, to load it under `caps` where they exceed its own. */
  excepted: z.boolean(),
  /**
   * The library hashes the host blessed at publish, which stay exempt from
   * the caps at every later load whatever the host blesses then.
   */
  blessed: z.array(libraryHash),
  loadedAt: z.date(),
});
export type MicroworldRecord = z.infer<typeof MicroworldRecord>;

/**
 * One live thing: a placed object or room by its identifier (a placed
 * thing with no row is at home at its defaults), or a spawned instance
 * (`Kind#n`). State and position live here.
 */
export const ObjectRecord = z.object({
  microworldId: z.string().min(1),
  id: z.string().min(1),
  /** The kind it was spawned from; null for a placed object or a room. */
  spawnedFrom: z.string().nullable(),
  /** The room or container or actor holding it; null for a room. */
  container: z.string().nullable(),
  /** The room it belongs to when nothing holds it. */
  home: z.string().nullable(),
  state: SproutState,
});
export type ObjectRecord = z.infer<typeof ObjectRecord>;

export const ActorRecord = z.object({
  microworldId: z.string().min(1),
  id: z.string().min(1),
  /** The name the host last supplied — a stable, host-unique token. */
  name: z.string(),
  roomId: z.string().nullable(),
  lastSeen: z.date(),
  /** The narration of their last turn, so a reload prints it again. */
  narration: z.array(z.string()),
  lastNoun: z.string().nullable(),
  /** Lines other actors' turns queued for them, drained at their next turn. */
  pending: z.array(z.string()),
});
export type ActorRecord = z.infer<typeof ActorRecord>;

/** What each object remembers about one actor, keyed by object id. */
export const MemoryRecord = z.object({
  microworldId: z.string().min(1),
  actorId: z.string().min(1),
  byObject: z.record(z.string(), SproutState),
});
export type MemoryRecord = z.infer<typeof MemoryRecord>;

/** One envelope as a fault chain keeps it. */
export const EnvelopeRecord = z.object({
  id: z.number().int(),
  name: z.string(),
  from: z.string(),
  depth: z.number().int(),
});
export type EnvelopeRecord = z.infer<typeof EnvelopeRecord>;

/** Per write turn. The record carries NO actor. */
export const ActionRecord = z.object({
  microworldId: z.string().min(1),
  at: z.date(),
  roomId: z.string(),
  command: z.string(),
  events: z.number().int(),
  depth: z.number().int(),
  spawned: z.number().int(),
  faulted: z.boolean(),
  /** The fault's words and the chain that led there, when it faulted. */
  fault: z.object({ message: z.string(), chain: z.array(EnvelopeRecord) }).nullable(),
  missed: z.boolean(),
  durationMs: z.number().int().nonnegative(),
  lockWaitMs: z.number().int().nonnegative(),
});
export type ActionRecord = z.infer<typeof ActionRecord>;

/** A donated miss: the input, what could have been said and named, the room's state then. */
export const MissRecord = z.object({
  microworldId: z.string().min(1),
  at: z.date(),
  roomId: z.string(),
  input: z.string(),
  couldSay: z.array(z.string()),
  couldName: z.array(z.string()),
  state: z.object({ room: SproutState, items: z.record(z.string(), SproutState) }),
});
export type MissRecord = z.infer<typeof MissRecord>;

/** Everything a visitor left across every microworld: their presence rows and what objects remember about them. */
export const ActorExport = z.object({
  actorId: z.string(),
  actors: z.array(ActorRecord),
  memory: z.array(MemoryRecord),
});
export type ActorExport = z.infer<typeof ActorExport>;
