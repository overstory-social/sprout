import { z } from 'zod';

// The Sprout definition format (sprout.md; understory.md §3): the caps,
// the AST — values, fields, guards, effects, handlers, views, verbs — the
// save-time cross-validation, and the format-1 room and item shapes. Store
// structure, never text to be parsed (§3.2); the written language in
// sprout-lang.ts compiles TO this, the engine runs it, and the product
// that hosts it (Overstory's understory schema) imports from here — never
// the other way round. What is a cap of the LANGUAGE lives here; a cap of
// a zone or a product policy (rooms per zone, how long an action row
// lives) stays with the product.

export const UNDERSTORY_EXITS_PER_ROOM = 8;
export const UNDERSTORY_NAME_MAX = 80;
export const UNDERSTORY_PROSE_MAX = 4000;
export const UNDERSTORY_EXIT_LABEL_MAX = 40;
export const UNDERSTORY_FIELDS_PER_OBJECT = 16;
export const UNDERSTORY_VERBS_PER_OBJECT = 16;
export const UNDERSTORY_VIEWS_PER_OBJECT = 16;
export const UNDERSTORY_HANDLERS_PER_OBJECT = 16;
export const UNDERSTORY_EFFECTS_PER_HANDLER = 16;
export const UNDERSTORY_ENUM_OPTIONS_MAX = 12;
export const UNDERSTORY_DEFINITION_BYTES_MAX = 64 * 1024;
/** How deep a guard or an effect tree may nest (§10.3-8). */
export const UNDERSTORY_NODE_DEPTH_MAX = 8;
/**
 * The event bounds (sprout.md §2.5, #339): the actor's command is depth
 * 0, every event a handler emits is one deeper. Past the depth, or past
 * the budget of envelopes in one action, the action FAULTS — rolled
 * back, recorded, the visitor told nothing happened. Both are set high
 * for the early beta and revised from `understory_action` (§2.11).
 */
export const UNDERSTORY_CASCADE_DEPTH = 20;
export const UNDERSTORY_EVENT_BUDGET = 256;
/** How many envelopes a fault record keeps, oldest first. */
export const UNDERSTORY_FAULT_CHAIN = 20;
/**
 * The universe is capped (sprout.md §2.8, #341): live instances per zone
 * (placed and spawned), spawns in one action, and kinds a zone may define.
 * Past a cap a `spawn` is a runtime fault; kinds are refused at the boundary.
 */
export const UNDERSTORY_MAX_INSTANCES = 2000;
export const UNDERSTORY_SPAWNS_PER_ACTION = 8;
export const UNDERSTORY_VERB_LABEL_MAX = 40;
export const UNDERSTORY_SAY_MAX = 600;
export const UNDERSTORY_VALUE_MAX = 80;

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
  z.string().max(UNDERSTORY_VALUE_MAX),
  /** #345: a media property with no picture. */
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
export const SproutField = z.discriminatedUnion('type', [
  z.object({ type: z.literal('boolean'), name: SproutIdent, default: z.boolean() }),
  /** #345 (sprout.md §2.9): a media id the uploader minted, or none; `show` opens it. */
  z.object({ type: z.literal('media'), name: SproutIdent, default: z.string().nullable() }),
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
        .array(z.string().trim().min(1).max(UNDERSTORY_VALUE_MAX))
        .min(1)
        .max(UNDERSTORY_ENUM_OPTIONS_MAX),
      default: z.string(),
    })
    .refine((f) => f.options.includes(f.default) && new Set(f.options).size === f.options.length, {
      error: 'An enum field needs distinct options, and a default among them.',
    }),
]);
export type SproutField = z.infer<typeof SproutField>;

export const SPROUT_GUARD_OPS = ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'in'] as const;
export const SproutGuardOp = z.enum(SPROUT_GUARD_OPS);
export type SproutGuardOp = z.infer<typeof SproutGuardOp>;

/**
 * A guard reads the object's OWN state (`self`) or what it remembers
 * about the acting visitor (`visitor`) — never another object's (§3.1).
 * `all` / `any` / `not` compose; an absent guard means "always".
 */
export type SproutGuard =
  | {
      kind: 'field';
      on: 'self' | 'visitor';
      field: string;
      op: SproutGuardOp;
      value: SproutValue | SproutValue[];
    }
  | { kind: 'all'; guards: SproutGuard[] }
  | { kind: 'any'; guards: SproutGuard[] }
  | { kind: 'not'; guard: SproutGuard };

export const SproutGuard: z.ZodType<SproutGuard> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('field'),
      on: z.enum(['self', 'visitor']),
      field: SproutIdent,
      op: SproutGuardOp,
      value: z.union([SproutValue, z.array(SproutValue).max(UNDERSTORY_ENUM_OPTIONS_MAX)]),
    }),
    z.object({
      kind: z.literal('all'),
      guards: z.array(SproutGuard).max(UNDERSTORY_EFFECTS_PER_HANDLER),
    }),
    z.object({
      kind: z.literal('any'),
      guards: z.array(SproutGuard).max(UNDERSTORY_EFFECTS_PER_HANDLER),
    }),
    z.object({ kind: z.literal('not'), guard: SproutGuard }),
  ]),
);

/** Where a message goes: the containing room, every item in it, or one item by name (§10.3-6). */
export const SproutMessageTarget = z.enum(['room', 'items', 'item']);
export type SproutMessageTarget = z.infer<typeof SproutMessageTarget>;

/**
 * The effect vocabulary (§10.3-5/6/7). `set` and `adjust` touch the
 * object's own state, `set_visitor` its memory of the actor, `say`
 * speaks to the actor only, `send_message` asks — never tells — another
 * object in the same room, `branch` chooses. Nothing reaches outside
 * the room, and nothing names another object's field.
 */
export type SproutEffect =
  | { op: 'set'; field: string; value: SproutValue }
  | { op: 'adjust'; field: string; by: number }
  | { op: 'set_visitor'; field: string; value: SproutValue }
  | { op: 'say'; text: string }
  | { op: 'send_message'; to: SproutMessageTarget; item: string | null; message: string }
  | { op: 'branch'; guard: SproutGuard; then: SproutEffect[]; otherwise: SproutEffect[] };

export const SproutEffect: z.ZodType<SproutEffect> = z.lazy(() =>
  z.discriminatedUnion('op', [
    z.object({ op: z.literal('set'), field: SproutIdent, value: SproutValue }),
    z.object({ op: z.literal('adjust'), field: SproutIdent, by: z.number().int() }),
    z.object({ op: z.literal('set_visitor'), field: SproutIdent, value: SproutValue }),
    z.object({ op: z.literal('say'), text: z.string().max(UNDERSTORY_SAY_MAX) }),
    z.object({
      op: z.literal('send_message'),
      to: SproutMessageTarget,
      /** The sibling's name when `to` is 'item'; ignored otherwise. */
      item: z.string().trim().max(UNDERSTORY_NAME_MAX).nullable(),
      message: SproutIdent,
    }),
    z.object({
      op: z.literal('branch'),
      guard: SproutGuard,
      then: z.array(SproutEffect).max(UNDERSTORY_EFFECTS_PER_HANDLER),
      otherwise: z.array(SproutEffect).max(UNDERSTORY_EFFECTS_PER_HANDLER),
    }),
  ]),
);

/** Guard → prose. Views are tried in order; the first that applies is shown instead of the plain prose. */
export const SproutView = z.object({
  guard: SproutGuard.nullable(),
  prose: z.string().max(UNDERSTORY_PROSE_MAX),
});
export type SproutView = z.infer<typeof SproutView>;

/** A verb the visitor can take, when its guard passes: what the chip says, and what happens. */
export const SproutVerb = z.object({
  name: z.string().trim().min(1, { error: 'A verb needs a name.' }).max(UNDERSTORY_VERB_LABEL_MAX),
  guard: SproutGuard.nullable(),
  effects: z.array(SproutEffect).max(UNDERSTORY_EFFECTS_PER_HANDLER),
});
export type SproutVerb = z.infer<typeof SproutVerb>;

/** What the object does when another object in the room sends it this message. */
export const SproutHandler = z.object({
  message: SproutIdent,
  guard: SproutGuard.nullable(),
  effects: z.array(SproutEffect).max(UNDERSTORY_EFFECTS_PER_HANDLER),
});
export type SproutHandler = z.infer<typeof SproutHandler>;

/** The behaviour half every object carries — a room and an item alike. */
const SproutBehaviour = {
  fields: z.array(SproutField).max(UNDERSTORY_FIELDS_PER_OBJECT).default([]),
  visitorFields: z.array(SproutField).max(UNDERSTORY_FIELDS_PER_OBJECT).default([]),
  views: z.array(SproutView).max(UNDERSTORY_VIEWS_PER_OBJECT).default([]),
  verbs: z.array(SproutVerb).max(UNDERSTORY_VERBS_PER_OBJECT).default([]),
  handlers: z.array(SproutHandler).max(UNDERSTORY_HANDLERS_PER_OBJECT).default([]),
};

export const SproutBehaviourShape = z.object(SproutBehaviour);
export type SproutBehaviour = z.infer<typeof SproutBehaviourShape>;

// --- save-time cross-validation (§10.2: rejected at the boundary, never at runtime) ---

function guardDepth(g: SproutGuard): number {
  switch (g.kind) {
    case 'field':
      return 1;
    case 'not':
      return 1 + guardDepth(g.guard);
    default:
      return 1 + Math.max(0, ...g.guards.map(guardDepth));
  }
}

function effectDepth(e: SproutEffect): number {
  if (e.op !== 'branch') return 1;
  return (
    1 + Math.max(guardDepth(e.guard), ...e.then.map(effectDepth), ...e.otherwise.map(effectDepth))
  );
}

function valueFits(field: SproutField, value: SproutValue): boolean {
  switch (field.type) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'integer':
      return typeof value === 'number';
    case 'enum':
      return typeof value === 'string' && field.options.includes(value);
    case 'media':
      return value === null || typeof value === 'string';
  }
}

function* guardProblems(
  g: SproutGuard,
  self: Map<string, SproutField>,
  visitor: Map<string, SproutField>,
  where: string,
): Generator<string> {
  switch (g.kind) {
    case 'field': {
      const table = g.on === 'self' ? self : visitor;
      const field = table.get(g.field);
      if (!field) {
        yield `${where}: the guard reads ${g.on === 'self' ? 'a field' : 'a visitor field'} "${g.field}" that is not declared.`;
        return;
      }
      const values = Array.isArray(g.value) ? g.value : [g.value];
      if (g.op === 'in' && !Array.isArray(g.value)) {
        yield `${where}: "in" needs a list of values.`;
      }
      if (g.op !== 'in' && Array.isArray(g.value)) {
        yield `${where}: "${g.op}" compares against one value.`;
      }
      if (
        (g.op === 'gt' || g.op === 'lt' || g.op === 'gte' || g.op === 'lte') &&
        field.type !== 'integer'
      ) {
        yield `${where}: "${g.op}" only orders integer fields; "${g.field}" is ${field.type}.`;
      }
      for (const v of values) {
        if (!valueFits(field, v)) {
          yield `${where}: ${JSON.stringify(v)} is not a ${field.type === 'enum' ? 'value' : field.type} of "${g.field}".`;
        }
      }
      return;
    }
    case 'not':
      yield* guardProblems(g.guard, self, visitor, where);
      return;
    default:
      for (const child of g.guards) yield* guardProblems(child, self, visitor, where);
  }
}

function* effectProblems(
  effects: SproutEffect[],
  self: Map<string, SproutField>,
  visitor: Map<string, SproutField>,
  where: string,
): Generator<string> {
  for (const e of effects) {
    switch (e.op) {
      case 'set':
      case 'adjust': {
        const field = self.get(e.field);
        if (!field) {
          yield `${where}: "${e.op}" names a field "${e.field}" that is not declared.`;
        } else if (e.op === 'adjust' && field.type !== 'integer') {
          yield `${where}: "adjust" only moves integer fields; "${e.field}" is ${field.type}.`;
        } else if (e.op === 'set' && !valueFits(field, e.value)) {
          yield `${where}: ${JSON.stringify(e.value)} is not a value of "${e.field}".`;
        }
        break;
      }
      case 'set_visitor': {
        const field = visitor.get(e.field);
        if (!field) {
          yield `${where}: "set_visitor" names a visitor field "${e.field}" that is not declared.`;
        } else if (!valueFits(field, e.value)) {
          yield `${where}: ${JSON.stringify(e.value)} is not a value of visitor field "${e.field}".`;
        }
        break;
      }
      case 'send_message':
        if (e.to === 'item' && !e.item?.trim()) {
          yield `${where}: a message to one item needs the item's name.`;
        }
        break;
      case 'branch':
        yield* guardProblems(e.guard, self, visitor, where);
        yield* effectProblems(e.then, self, visitor, where);
        yield* effectProblems(e.otherwise, self, visitor, where);
        break;
      case 'say':
        break;
    }
  }
}

/**
 * Everything a definition can get wrong on its own: undeclared or
 * duplicate fields, values of the wrong type, ordering a boolean, a
 * message to a nameless item, a tree too deep, a definition too big.
 * What it cannot judge alone — whether a named sibling exists in the
 * room — the saver checks with `siblingNames`.
 */
export function sproutProblems(
  def: SproutBehaviour & { name: string },
  siblingNames?: readonly string[],
): string[] {
  const problems: string[] = [];
  const declare = (fields: SproutField[], what: string): Map<string, SproutField> => {
    const table = new Map<string, SproutField>();
    for (const f of fields) {
      if (table.has(f.name)) problems.push(`The ${what} "${f.name}" is declared twice.`);
      table.set(f.name, f);
    }
    return table;
  };
  const self = declare(def.fields, 'field');
  const visitor = declare(def.visitorFields, 'visitor field');
  const seenVerbs = new Set<string>();
  const seenMessages = new Set<string>();
  const siblings = siblingNames ? new Set(siblingNames.map((n) => n.trim().toLowerCase())) : null;
  const checkTargets = (effects: SproutEffect[], where: string) => {
    if (!siblings) return;
    const walk = (list: SproutEffect[]) => {
      for (const e of list) {
        if (e.op === 'send_message' && e.to === 'item' && e.item?.trim()) {
          if (!siblings.has(e.item.trim().toLowerCase())) {
            problems.push(`${where}: no item called "${e.item.trim()}" is in this room.`);
          }
        } else if (e.op === 'branch') {
          walk(e.then);
          walk(e.otherwise);
        }
      }
    };
    walk(effects);
  };
  def.views.forEach((v, i) => {
    if (v.guard) {
      problems.push(...guardProblems(v.guard, self, visitor, `View ${i + 1}`));
      if (guardDepth(v.guard) > UNDERSTORY_NODE_DEPTH_MAX) {
        problems.push(
          `View ${i + 1}: the guard nests too deep (${UNDERSTORY_NODE_DEPTH_MAX} at most).`,
        );
      }
    }
  });
  for (const v of def.verbs) {
    const key = v.name.toLowerCase();
    if (seenVerbs.has(key)) problems.push(`The verb "${v.name}" is declared twice.`);
    seenVerbs.add(key);
    const where = `Verb "${v.name}"`;
    if (v.guard) problems.push(...guardProblems(v.guard, self, visitor, where));
    problems.push(...effectProblems(v.effects, self, visitor, where));
    checkTargets(v.effects, where);
    const depth = Math.max(v.guard ? guardDepth(v.guard) : 0, ...v.effects.map(effectDepth));
    if (depth > UNDERSTORY_NODE_DEPTH_MAX) {
      problems.push(`${where}: nests too deep (${UNDERSTORY_NODE_DEPTH_MAX} at most).`);
    }
  }
  for (const h of def.handlers) {
    if (seenMessages.has(h.message)) {
      problems.push(`The message "${h.message}" is handled twice.`);
    }
    seenMessages.add(h.message);
    const where = `On "${h.message}"`;
    if (h.guard) problems.push(...guardProblems(h.guard, self, visitor, where));
    problems.push(...effectProblems(h.effects, self, visitor, where));
    checkTargets(h.effects, where);
    const depth = Math.max(h.guard ? guardDepth(h.guard) : 0, ...h.effects.map(effectDepth));
    if (depth > UNDERSTORY_NODE_DEPTH_MAX) {
      problems.push(`${where}: nests too deep (${UNDERSTORY_NODE_DEPTH_MAX} at most).`);
    }
  }
  if (JSON.stringify(def).length > UNDERSTORY_DEFINITION_BYTES_MAX) {
    problems.push(
      `The definition is too big (${UNDERSTORY_DEFINITION_BYTES_MAX / 1024} KB at most).`,
    );
  }
  return problems;
}

const selfConsistent = (ctx: z.core.$RefinementCtx, def: SproutBehaviour & { name: string }) => {
  for (const problem of sproutProblems(def)) {
    ctx.addIssue({ code: 'custom', message: problem });
  }
};

// --- definitions ----------------------------------------------------------

/**
 * The format-2 definitions live in sprout.ts, which imports this file;
 * these references are filled in there (`bindFormat2`) so the details
 * above can accept either format without a circular import.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export let RoomDefinition2Ref: z.ZodType<any> = z.never();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export let ItemDefinition2Ref: z.ZodType<any> = z.never();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function bindFormat2(room: z.ZodType<any>, item: z.ZodType<any>): void {
  RoomDefinition2Ref = room;
  ItemDefinition2Ref = item;
}

export const RoomExit = z.object({
  label: z
    .string()
    .trim()
    .min(1, { error: 'An exit needs a label.' })
    .max(UNDERSTORY_EXIT_LABEL_MAX),
  toRoomId: z.string().min(1),
});
export type RoomExit = z.infer<typeof RoomExit>;

/**
 * The stored form of a room (§3.2: store structure, never text to be
 * parsed). `format` is the node-type version: a later shape adds a
 * literal and an evaluator, and old rows stay valid — a step-1 row with
 * no behaviour keys parses to empty behaviour.
 */
export const RoomDefinition = z
  .object({
    format: z.literal(1),
    name: z.string().trim().min(1, { error: 'A room needs a name.' }).max(UNDERSTORY_NAME_MAX),
    /** Plain prose; paragraphs separated by blank lines. No markup in v0. */
    prose: z.string().max(UNDERSTORY_PROSE_MAX),
    exits: z.array(RoomExit).max(UNDERSTORY_EXITS_PER_ROOM),
    ...SproutBehaviour,
  })
  .superRefine((def, ctx) => selfConsistent(ctx, def));
export type RoomDefinition = z.infer<typeof RoomDefinition>;

/**
 * An item (#259): a fixture in one room in step 2 — it holds state,
 * answers verbs, and is looked at. Same draft/publish shape as a room.
 */
export const ItemDefinition = z
  .object({
    format: z.literal(1),
    name: z.string().trim().min(1, { error: 'An item needs a name.' }).max(UNDERSTORY_NAME_MAX),
    prose: z.string().max(UNDERSTORY_PROSE_MAX),
    /** #260: visitors may take it, carry it about the zone, drop it, hand it on. */
    portable: z.boolean().default(false),
    ...SproutBehaviour,
  })
  .superRefine((def, ctx) => selfConsistent(ctx, def));
export type ItemDefinition = z.infer<typeof ItemDefinition>;

/** Either object's definition, as the engine sees it. */
export type SproutDefinition = RoomDefinition | ItemDefinition;

/** One object's memory of the visitor: the legible half of per-visitor state. */
export const UnderstoryMemory = z.object({
  object: z.string(),
  fields: z.array(z.object({ name: z.string(), value: SproutValue })),
});
export type UnderstoryMemory = z.infer<typeof UnderstoryMemory>;
