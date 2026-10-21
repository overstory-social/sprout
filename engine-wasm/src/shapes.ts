import { z } from 'zod';

import {
  DIRECTIONS,
  StoredInstanceSchema,
  StoredVisitorSchema,
  visitKey,
  type DueWake,
  type Effect,
  type Fault,
  type InstanceId,
  type NicknameRefusalReason,
  type NicknameRefused,
  type Plain,
  type SeenReading,
  type SeenScene,
  type SeenView,
  type StoredChanges,
  type WrittenAt,
} from '@overstory/sprout/lang';
import {
  LogEntry,
  type Account,
  type ParsedCommand,
  type ParsedFiller,
  type ParsedReading,
  type TurnEntry,
} from '@overstory/sprout/core';

// What the WebAssembly engine answers, read as the language's shapes (the
// runtime-c/wasm/engine/ exports): every answer is JSON, checked here once
// as it crosses into TypeScript, so nothing past this file reads an
// unchecked value. Ids come back as the instance ids and visit keys the
// language names them by.

const Id = z
  .string()
  .min(1)
  .transform((id) => id as InstanceId);
const Visit = z
  .string()
  .min(1)
  .transform((key) => visitKey(key));

const PlainSchema: z.ZodType<Plain> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(PlainSchema),
    z.record(z.string(), PlainSchema),
  ]),
);

const WrittenSchema: z.ZodType<WrittenAt> = z.union([
  z.object({ passage: z.string(), origin: z.string(), at: z.string() }),
  z.object({ line: z.string() }),
]);

const EffectParts = {
  from: Id,
  actor: Id.nullable(),
  to: Id,
  visit: Visit,
  paragraphs: z.array(z.string()),
  written: z.array(WrittenSchema),
};

/** One effect one person reads, as the language gives it. */
export const EffectSchema: z.ZodType<Effect, unknown> = z.discriminatedUnion('kind', [
  z.object({ kind: z.enum(['said', 'told', 'refused', 'described', 'notice']), ...EffectParts }),
  z.object({
    kind: z.literal('extension'),
    ...EffectParts,
    extension: z.string().min(1),
    statement: z.string().min(1),
    payload: PlainSchema,
  }),
]);

/** A fault as the language gives it. */
export const FaultSchema: z.ZodType<Fault, unknown> = z.object({
  name: z.string().min(1),
  detail: z.string(),
  object: Id.nullable(),
  engine: z.boolean(),
  extension: z.string().min(1).nullable(),
});

/** What the store writes for one committed turn. */
export const ChangesSchema: z.ZodType<StoredChanges, unknown> = z.object({
  serial: z.number().int().min(0),
  upsert: z.array(StoredInstanceSchema),
  remove: z.array(z.string()),
  tombstones: z.array(z.string()),
  visitors: z.array(StoredVisitorSchema),
});

const TURN_KINDS = ['command', 'tick', 'wake', 'maintenance', 'arrival', 'departure'] as const;

/** A write turn's entry, as core's log keeps it. */
export const EntrySchema: z.ZodType<TurnEntry, unknown> = LogEntry.refine(
  (entry): entry is TurnEntry => (TURN_KINDS as readonly string[]).includes(entry.kind),
  'is the entry of a write turn',
) as z.ZodType<TurnEntry, unknown>;

/** A reading a line planned, as the engine writes one: its verb by qualified name, who performs it, and what fills each role. */
const ReadingTree = z.object({
  verb: z.string().min(1),
  actor: z.string().min(1),
  bindings: z.array(z.unknown()),
});

/** What a turn ran, as core's account: each handler and hook in order, the line a command was answered with, and a consent refusal. */
export const AccountSchema: z.ZodType<Account, unknown> = z.object({
  ran: z.array(
    z.object({ origin: z.string().min(1), on: z.string().min(1), at: z.string().min(1) }),
  ),
  answered: z.string().nullable(),
  refused: z.boolean(),
});

/** What one write turn came to (engine/turns.c `told`). */
export const ToldSchema = z.object({
  result: z.enum(['done', 'faulted', 'refused', 'closed', 'idle']),
  changed: z.boolean(),
  fault: FaultSchema.nullable(),
  words: z.string().nullable(),
  lines: z.array(z.tuple([z.string(), z.string(), z.string()])),
  effects: z.array(EffectSchema),
  cutShort: z.array(Id),
  stale: z.array(Visit).nullable(),
  entry: EntrySchema.nullable(),
  changes: ChangesSchema.nullable(),
  account: AccountSchema,
  answered: z.boolean().optional(),
  displaced: z.boolean().optional(),
  drawn: z.number().int().positive().nullable().optional(),
  step: ReadingTree.nullable().optional(),
  goesOn: z.boolean().optional(),
  passes: z.number().int().nonnegative().optional(),
});
export type Told = z.infer<typeof ToldSchema>;

/** A command a line hands out, to be handed back to the engine as it is, once: the number of its line, and its own there. */
export const LineCommandSchema = z.object({
  visit: Visit,
  text: z.string(),
  planned: z.unknown(),
  reread: z.unknown(),
  line: z.number().int().min(0),
  step: z.number().int().positive(),
});
export type LineCommand = z.infer<typeof LineCommandSchema>;

const Thing = z.object({ id: Id, name: z.string() });

const FillerSchema = z.discriminatedUnion('binds', [
  z.object({
    role: z.string(),
    words: z.string(),
    binds: z.literal('object'),
    id: Id,
    name: z.string(),
    all: z.boolean(),
  }),
  z.object({
    role: z.string(),
    words: z.string(),
    binds: z.literal('set'),
    ids: z.array(Id),
    names: z.array(z.string()),
    all: z.boolean(),
  }),
  z.object({
    role: z.string(),
    words: z.string(),
    binds: z.literal('exit'),
    direction: z.enum(DIRECTIONS).nullable(),
    label: z.string(),
    to: Id,
  }),
  z.object({ role: z.string(), words: z.string(), binds: z.literal('unbound') }),
]);

const OptionsSchema = z.discriminatedUnion('takes', [
  z.object({
    role: z.string(),
    takes: z.literal('symbol'),
    options: z.array(z.object({ value: z.string(), words: z.string() })),
  }),
  z.object({
    role: z.string(),
    takes: z.literal('integer'),
    ranges: z.array(z.object({ min: z.number(), max: z.number() })),
  }),
]);

const ReadingSchema: z.ZodType<SeenReading, unknown> = z.object({
  verb: z.string().min(1),
  typed: z.string(),
  refused: z.array(z.string()).nullable(),
  fillers: z.array(FillerSchema),
  options: z.array(OptionsSchema),
});

const Place = {
  description: z.array(z.string()),
  effects: z.array(
    z.object({
      extension: z.string(),
      statement: z.string(),
      payload: PlainSchema,
      transcript: z.string(),
    }),
  ),
  exits: z.array(z.object({ direction: z.enum(DIRECTIONS).nullable(), label: z.string(), to: Id })),
  occupants: z.array(Thing),
  carried: z.array(Thing),
};

/** A poll of the whole view. */
export const ViewSchema = z.object({
  view: z.object({ ...Place, readings: z.array(ReadingSchema) }) satisfies z.ZodType<
    SeenView,
    unknown
  >,
  fault: FaultSchema.nullable(),
});

/** A poll of the scene. */
export const SceneSchema = z.object({
  scene: z.object({
    ...Place,
    verbs: z.array(z.object({ verb: z.string().min(1), phrases: z.array(z.string()) })),
  }) satisfies z.ZodType<SeenScene, unknown>,
  fault: FaultSchema.nullable(),
});

/** A poll of one verb's readings. */
export const ReadingsSchema = z.object({
  readings: z.array(ReadingSchema),
  fault: FaultSchema.nullable(),
});

const REASONS = [
  'empty',
  'not-words',
  'too-long',
  'source-shaped',
  'world-word',
  'reserved',
  'held',
] as const satisfies readonly NicknameRefusalReason[];

/** Why a nickname may not be a visitor's, or null where it may. */
export const NicknameSchema: z.ZodType<NicknameRefused | null, unknown> = z
  .object({
    reason: z.enum(REASONS),
    nickname: z.string(),
    collides: z.array(z.string()),
    words: z.string(),
  })
  .nullable();

export const PlacesSchema = z.array(Id);

export const DueWakesSchema: z.ZodType<DueWake[], unknown> = z.array(
  z.object({
    object: Id,
    serial: z.number().int().positive(),
    askedAt: z.number().int().min(0),
    dueAt: z.number().int().min(0),
  }),
);

export const HearersSchema = z.object({ place: Id, to: z.array(Visit) }).nullable();

export const StandingSchema = z.object({ place: Thing, here: z.array(Thing) }).nullable();

const ParsedFillerSchema: z.ZodType<ParsedFiller, unknown> = z.union([
  z.object({ object: Thing }),
  z.object({ set: z.array(Thing) }),
  z.object({ exit: z.object({ direction: z.string().nullable(), label: z.string(), to: Id }) }),
  z.object({ value: z.union([z.string(), z.number()]), symbol: z.boolean() }),
]);

const ParsedReadingSchema: z.ZodType<ParsedReading, unknown> = z.object({
  verb: z.string().min(1),
  roles: z.array(z.object({ name: z.string().min(1), filler: ParsedFillerSchema.nullable() })),
});

const DrawnSchema = z
  .object({ among: z.number().int().min(2), meant: z.array(z.string()).nullable() })
  .nullable();

/** What a typed line would make, each command it holds read and never run (engine/parsing.c). */
export const ParsedSchema: z.ZodType<ParsedCommand[], unknown> = z.array(
  z.union([
    z.object({
      text: z.string(),
      faulted: z.object({ name: z.string().min(1), detail: z.string() }),
    }),
    z.object({
      text: z.string(),
      answered: z.object({
        passage: z.string().min(1).nullable(),
        paragraphs: z.array(z.string()),
      }),
    }),
    z.object({
      text: z.string(),
      reading: ParsedReadingSchema,
      drawn: DrawnSchema,
      refused: z
        .object({
          by: Thing.nullable(),
          role: z.string().min(1),
          origin: z.string().min(1).nullable(),
          paragraphs: z.array(z.string()),
        })
        .nullable(),
    }),
    z.object({
      text: z.string(),
      intent: z.object({
        name: z.string().min(1),
        slots: z.array(z.object({ name: z.string().min(1), thing: Thing.nullable() })),
      }),
      drawn: DrawnSchema,
      steps: z.array(ParsedReadingSchema),
    }),
  ]),
);

export const ActedSchema = z.array(z.string()).nullable();

/** `text` read as JSON and checked against `schema`, or an error naming what the engine answered. */
export function read<T>(schema: z.ZodType<T, unknown>, text: string, what: string): T {
  const checked = schema.safeParse(JSON.parse(text));
  if (!checked.success) {
    throw new Error(
      `The WebAssembly engine answered ${what} in a shape it does not have: ${checked.error.issues
        .map((issue) => `${issue.path.join('.') || 'the answer'} ${issue.message}`)
        .join('; ')}.`,
    );
  }
  return checked.data;
}
