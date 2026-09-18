import { z } from 'zod';

import { SPROUT_BUILTIN_TYPES } from './extensions.js';

// The language's caps, values, fields and the few shapes a host shares
// with it (sprout.md; the split proposal §3.2). SOURCE is the stored truth:
// a definition is what the compiler (sprout-lang.ts) builds from text at
// load and never persists — its shape may change in a minor version. What
// IS persisted and public is here: the value shapes (`SproutValue`,
// `SproutState`) and the language level. What is a cap of the LANGUAGE
// lives here; a cap of a zone or a product policy (rooms per zone, how long
// an action row lives) stays with the product.

/**
 * The language level (the split proposal §3.2): an integer bumped only
 * when syntax is ADDED. A host records the level a source needs beside
 * the source; a runtime refuses to load text that needs a newer level
 * than its own compiler, and a policy refusal newer than the level a
 * text was accepted at is a warning at load, never a dark room.
 */
export const LANGUAGE_LEVEL = 1;

export const SPROUT_EXITS_PER_ROOM = 8;
export const SPROUT_NAME_MAX = 80;
export const SPROUT_PROSE_MAX = 4000;
export const SPROUT_EXIT_LABEL_MAX = 40;
export const SPROUT_FIELDS_PER_OBJECT = 16;
export const SPROUT_VERBS_PER_OBJECT = 16;
export const SPROUT_VIEWS_PER_OBJECT = 16;
export const SPROUT_HANDLERS_PER_OBJECT = 16;
export const SPROUT_EFFECTS_PER_HANDLER = 16;
export const SPROUT_ENUM_OPTIONS_MAX = 12;
export const SPROUT_DEFINITION_BYTES_MAX = 64 * 1024;
/** How deep a guard or an effect tree may nest (§10.3-8). */
export const SPROUT_NODE_DEPTH_MAX = 8;
/**
 * The event bounds (sprout.md §2.5, #339): the actor's command is depth
 * 0, every event a handler emits is one deeper. Past the depth, or past
 * the budget of envelopes in one action, the action FAULTS — rolled
 * back, recorded, the visitor told nothing happened. Both are set high
 * for the early beta and revised from `understory_action` (§2.11).
 */
export const SPROUT_CASCADE_DEPTH = 20;
export const SPROUT_EVENT_BUDGET = 256;
/** How many envelopes a fault record keeps, oldest first. */
export const SPROUT_FAULT_CHAIN = 20;
/**
 * The universe is capped (sprout.md §2.8, #341): live instances per zone
 * (placed and spawned), spawns in one action, and kinds a zone may define.
 * Past a cap a `spawn` is a runtime fault; kinds are refused at the boundary.
 */
export const SPROUT_MAX_INSTANCES = 2000;
export const SPROUT_SPAWNS_PER_ACTION = 8;
/** Effects an action's extension statements may record (§3.5 of the split proposal): past it, a fault. */
export const SPROUT_EFFECTS_PER_ACTION = 64;
export const SPROUT_VERB_LABEL_MAX = 40;
export const SPROUT_SAY_MAX = 600;
export const SPROUT_VALUE_MAX = 80;

// --- the Sprout AST (§3.2: store structure, never text) --------------------

/** A field or message name: lower-case identifier, the dropdown's currency. */
export const SproutIdent = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,31}$/, { error: 'lower-case letters, digits and _ (32 at most)' });
export type SproutIdent = z.infer<typeof SproutIdent>;

/** Every value is typed by the field it lives in; floats do not exist (§10.3-7). */
export const SproutValue = z.union([
  z.boolean(),
  z.number().int(),
  z.string().max(SPROUT_VALUE_MAX),
  /** An extension value with nothing in it (a media property with no picture). */
  z.null(),
]);
export type SproutValue = z.infer<typeof SproutValue>;

/** One object's state: field → value. */
export const SproutState = z.record(SproutIdent, SproutValue);
export type SproutState = z.infer<typeof SproutState>;

/**
 * A declared state field: name, type, default, and the bounds `adjust`
 * clamps to. An object's fields are ITS state; its visitor fields are
 * what it remembers about each visitor (§3.2, "the dangerous primitive",
 * kept legible by the memory panel).
 */
export const SproutBuiltinField = z.discriminatedUnion('type', [
  z.object({ type: z.literal('boolean'), name: SproutIdent, default: z.boolean() }),
  /** A short text (sprout.md §2.2: "a string"): `:label "Sold out"`. */
  z.object({
    type: z.literal('string'),
    name: SproutIdent,
    default: z.string().max(SPROUT_VALUE_MAX),
  }),
  z
    .object({
      type: z.literal('integer'),
      name: SproutIdent,
      default: z.number().int(),
      min: z.number().int(),
      max: z.number().int(),
    })
    .refine((f) => f.min <= f.max && f.default >= f.min && f.default <= f.max, {
      error: 'An integer field needs min ≤ default ≤ max.',
    }),
  z
    .object({
      type: z.literal('enum'),
      name: SproutIdent,
      options: z
        .array(z.string().trim().min(1).max(SPROUT_VALUE_MAX))
        .min(1)
        .max(SPROUT_ENUM_OPTIONS_MAX),
      default: z.string(),
    })
    .refine((f) => f.options.includes(f.default) && new Set(f.options).size === f.options.length, {
      error: 'An enum field needs distinct options, and a default among them.',
    }),
]);
export type SproutBuiltinField = z.infer<typeof SproutBuiltinField>;

/**
 * A field of a type an extension adds (`:image media "m-…"`): the type's
 * tag, the name, the default in the type's storage shape. Which
 * extension owns the tag, and whether the source `use`s it, is the
 * compiler's to check with the extension set in hand.
 */
export const SproutExtensionField = z
  .object({ type: SproutIdent, name: SproutIdent, default: SproutValue })
  .refine((f) => !SPROUT_BUILTIN_TYPES.has(f.type), {
    error: 'A built-in type is declared with its own shape.',
  });
export type SproutExtensionField = z.infer<typeof SproutExtensionField>;

export const SproutField = z.union([SproutBuiltinField, SproutExtensionField]);
export type SproutField = SproutBuiltinField | SproutExtensionField;

/** A field of one of the language's own types — the narrowing every `switch` on `type` needs. */
export function isBuiltinField(field: SproutField): field is SproutBuiltinField {
  return SPROUT_BUILTIN_TYPES.has(field.type);
}

// --- shapes a host shares with the language ----------------------------------

export const RoomExit = z.object({
  label: z.string().trim().min(1, { error: 'An exit needs a label.' }).max(SPROUT_EXIT_LABEL_MAX),
  toRoomId: z.string().min(1),
});
export type RoomExit = z.infer<typeof RoomExit>;

/** One object's memory of the visitor: the legible half of per-visitor state. */
export const SproutMemory = z.object({
  object: z.string(),
  fields: z.array(z.object({ name: z.string(), value: SproutValue })),
});
export type SproutMemory = z.infer<typeof SproutMemory>;
