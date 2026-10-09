// The JSON a cartridge holds, as one schema the emitter's output is held to
// and the reader's input is checked against (the spec's The compiler ›
// What compiling produces). A cartridge that fails it is damaged or from
// something that is not this compiler, and is refused rather than guessed
// at. The graph's cells and entries are `cartridge-graph.ts`'s.

import { z } from 'zod';

import type { StaticCaps } from './limits.js';

const Count = z.number().int().nonnegative();

const CellSchema = z.union([
  z.null(),
  z.boolean(),
  z.number(),
  z.string(),
  z.tuple([Count]),
  z.strictObject({ p: z.tuple([z.number().int(), z.number().int(), z.number().int()]) }),
]);

const EntrySchema = z.union([
  z.strictObject({ o: z.record(z.string(), CellSchema) }),
  z.strictObject({ a: z.array(CellSchema) }),
  z.strictObject({ m: z.array(z.tuple([CellSchema, CellSchema])) }),
  z.strictObject({ s: z.array(CellSchema) }),
]);

const CapSchema = z.number().nullable();

const StaticCapsSchema = z.strictObject({
  optionsPerEnum: z.number(),
  rolesPerVerb: z.number(),
  phrasesPerVerb: z.number(),
  stepsPerIntent: z.number(),
  phraseCharacters: z.number(),
  nounsPerObject: z.number(),
  nounCharacters: z.number(),
  exitsPerPlace: z.number(),
  listElements: z.number(),
  literalCharacters: z.number(),
  places: CapSchema,
  objects: CapSchema,
  kinds: CapSchema,
  files: CapSchema,
  sourceBytes: CapSchema,
}) satisfies z.ZodType<StaticCaps>;

/** What a cartridge says about itself, before anything of its world is read. */
const HeaderSchema = z.strictObject({
  name: z.string(),
  namespace: z.string(),
  version: z.string(),
  author: z.string(),
  license: z.string(),
  /** The highest language level of any part of the world, library source included. */
  level: z.number().int(),
  /** The hash of the closed bundle it was made from, which the log records beside a publish. */
  hash: z.string(),
  /** The files the world's own source was written in, by name. */
  files: z.array(z.string()),
  /** The libraries it was linked with, by name, version and the hash of the source linked; the source itself does not travel. */
  libraries: z.array(z.strictObject({ name: z.string(), version: z.string(), sha: z.string() })),
});

/** The sections of a cartridge's JSON. */
export const CartridgeSchema = z.strictObject({
  header: HeaderSchema,
  /** Every kind composed, which the world and a visitor are made of, and what each kind's body gives its instances. */
  kinds: z.strictObject({
    all: CellSchema,
    world: CellSchema,
    visitor: CellSchema,
    contents: CellSchema,
  }),
  /** What the world declares to be where: the objects it holds, and the place visitors arrive at. */
  tree: z.strictObject({
    world: z.string(),
    holds: CellSchema,
    arrival: z.array(z.string()).nullable(),
  }),
  /** Every verb, resolved, with the phrase templates a visitor may type for it. */
  verbs: CellSchema,
  /** The phrases the world's and its objects' synonyms give, each for its verb and the object it holds for, and the intents a typed line may be, with the word set a nickname is admitted against. */
  grammar: z.strictObject({
    scoped: CellSchema,
    intents: CellSchema,
    words: z.array(z.string()),
  }),
  messages: CellSchema,
  /** Passages as trees of the prose nodes; the first run of the entries. */
  prose: z.strictObject({ entries: z.array(EntrySchema) }),
  /**
   * Statements and expressions as trees, the second run of the entries;
   * and what every name a body writes names, and which slots render an
   * enum's option, by the nodes written.
   */
  bodies: z.strictObject({
    entries: z.array(EntrySchema),
    names: CellSchema,
    optionSlots: CellSchema,
  }),
  /** Everything else the sections above refer to, the last run of the entries, and the files spans name. */
  table: z.strictObject({ files: z.array(z.string()), entries: z.array(EntrySchema) }),
  /** The static caps the world was checked against. */
  caps: StaticCapsSchema,
  /** The extensions it pins, by name and major version; the host supplies the code. */
  extensions: z.array(z.strictObject({ name: z.string(), major: z.number().int() })),
});

/** A cartridge's JSON, read. */
export type Cartridge = z.infer<typeof CartridgeSchema>;
