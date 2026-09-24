import { z } from 'zod';

import {
  StoredInstanceSchema,
  StoredPropertySchema,
  StoredVisitorSchema,
  type StaticCaps,
} from '@overstory/sprout/lang';

// What a store holds for one microworld, every record a zod schema,
// because an adapter author needs them and a document adapter validates
// what it reads back. Core owns runtime state only; nothing here is
// authored. A world's state is the language's stored form (the spec's
// The runtime › State): its serial, its instances, its visitors and its
// tombstones, whose schemas are the language's and are re-exported here
// so an adapter imports core alone. Every key carries the microworld, so
// `shop.hall` in one microworld never shares a row with another's.

export {
  StoredInstanceSchema,
  StoredPropertySchema,
  StoredVisitorSchema,
  codeUnitOrder,
  type StoredChanges,
  type StoredInstance,
  type StoredProperty,
  type StoredVisitor,
} from '@overstory/sprout/lang';

/**
 * A world's stored state as a store hands it back: the language's
 * `StoredWorld` without the world's name, which the bundle gives. Each
 * list is in code-unit order of its key (an instance's id, a visitor's
 * visit), so every adapter hands back the same value.
 */
export const StoredState = z.object({
  /** The last serial issued, 0 before the first. */
  serial: z.number().int().min(0),
  instances: z.array(StoredInstanceSchema),
  visitors: z.array(StoredVisitorSchema),
  tombstones: z.array(z.string()),
});
export type StoredState = z.infer<typeof StoredState>;

/** Nothing stored yet: what a store hands back for a world no turn has written. */
export function emptyState(): StoredState {
  return { serial: 0, instances: [], visitors: [], tombstones: [] };
}

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

/**
 * A microworld as last published. Which libraries the host blesses is not
 * kept, since every load reads the host's set as it is then; a stored
 * record that lists them reads with the list dropped.
 */
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
  loadedAt: z.date(),
});
export type MicroworldRecord = z.infer<typeof MicroworldRecord>;

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

/** A donated miss: the input, what could have been said and named, and the room and what was in it then, as stored. */
export const MissRecord = z.object({
  microworldId: z.string().min(1),
  at: z.date(),
  roomId: z.string(),
  input: z.string(),
  couldSay: z.array(z.string()),
  couldName: z.array(z.string()),
  state: z.object({ room: StoredInstanceSchema, items: z.array(StoredInstanceSchema) }),
});
export type MissRecord = z.infer<typeof MissRecord>;

/**
 * What one world keeps about one visitor: their visitor record, their
 * instance (null where the store holds none), and every instance's
 * memory of them, by the remembering instance's id.
 */
export const VisitorInWorld = z.object({
  microworldId: z.string().min(1),
  visitor: StoredVisitorSchema,
  instance: StoredInstanceSchema.nullable(),
  memory: z.record(z.string(), z.record(z.string(), StoredPropertySchema)),
});
export type VisitorInWorld = z.infer<typeof VisitorInWorld>;

/** Everything stored about one visit, in every microworld that holds it, in code-unit order of the microworld's id. */
export const VisitorExport = z.object({
  visit: z.string().min(1),
  worlds: z.array(VisitorInWorld),
});
export type VisitorExport = z.infer<typeof VisitorExport>;
