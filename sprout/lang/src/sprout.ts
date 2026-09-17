import { z } from 'zod';

import {
  ItemDefinition,
  RoomDefinition,
  RoomExit,
  SproutField,
  SproutIdent,
  SproutValue,
  UNDERSTORY_DEFINITION_BYTES_MAX,
  UNDERSTORY_EFFECTS_PER_HANDLER,
  UNDERSTORY_EXITS_PER_ROOM,
  UNDERSTORY_FIELDS_PER_OBJECT,
  UNDERSTORY_HANDLERS_PER_OBJECT,
  UNDERSTORY_NAME_MAX,
  UNDERSTORY_NODE_DEPTH_MAX,
  UNDERSTORY_PROSE_MAX,
  UNDERSTORY_SAY_MAX,
  UNDERSTORY_VERBS_PER_OBJECT,
  bindFormat2,
  type SproutDefinition,
  type SproutEffect,
  type SproutGuard,
} from './definitions.js';

// Sprout 1 (sprout.md, 2026-09-05; #337 is this file): the `format: 2`
// AST — what the written language compiles to (#338), what the engine
// runs (#339–#341), what the form editor and a later Blockly adapter
// edit. It is a SUPERSET of format 1: `upgradeSproutDefinition` turns
// any v0 room or item into a v2 one mechanically, and the two seeded
// studios upgrade with zero problems (the seeder asserts it, so CI's
// `schema` job executes the claim).
//
// Storage stays one row per object (understory_room / understory_item,
// each drafted and published on its own): a v2 definition is one
// object's kind body — an anonymous kind when `inherit` is null, the
// overrides of a placed instance when it names one — plus the object's
// own header (name, names, prose, exits). Kinds as rows of their own,
// and `spawn`, are #341; until then `inherit` may only name a built-in.
//
// What this file refuses is what the compiler can judge without a
// parser (sprout.md §3): writes anywhere but self, undeclared
// properties, values of the wrong type, abstract messages on something
// placeable, behaviour on an instance body, pass rules off a container,
// writes inside a consent guard, anything but reading inside `describe`
// (§2.12, #441), the caps. Runtime faults (depth, the event budget, the
// instance cap) are the engine's (§2.5, §2.8).

export const SPROUT_FORMAT = 2;

/** The player-facing words for one object (§2.2 `:names`), and the caps around them. */
export const SPROUT_NAMES_MAX = 8;
export const SPROUT_NAME_WORD_MAX = 40;
/** Grammar lines per message (§2.7) and their length. */
export const SPROUT_GRAMMAR_PER_MESSAGE = 8;
export const SPROUT_GRAMMAR_LINE_MAX = 80;
/** Arguments per message: `use (with: object)`; two is "put X in Y" territory, kept for later. */
export const SPROUT_ARGS_PER_MESSAGE = 2;

/** A kind's name: capitalised, Ruby's constant convention (§2.8) — kinds and objects never share a namespace. */
export const SproutKindName = z
  .string()
  .regex(/^[A-Z][A-Za-z0-9_]{0,31}$/, { error: 'A kind name starts with a capital letter.' });
export type SproutKindName = z.infer<typeof SproutKindName>;

/**
 * The kinds the engine defines (§2.5): a thing that holds things, the
 * room (a container that may hold actors and has exits), and the actor
 * (a container: their hands). `Actor` is never placeable; `Room` is what
 * every room is; `Container` is what an item inherits to hold things.
 */
export const SPROUT_BUILTIN_KINDS = ['Container', 'Room', 'Actor'] as const;
export type SproutBuiltinKind = (typeof SPROUT_BUILTIN_KINDS)[number];

/**
 * The well-known properties (§2.2) every object has without declaring
 * them, with the language's defaults. A declaration overrides the
 * default; `:capacity` on a room is unbounded (null).
 */
export const SPROUT_WELL_KNOWN: Readonly<Record<string, SproutField>> = {
  takeable: { type: 'boolean', name: 'takeable', default: false },
  hidden: { type: 'boolean', name: 'hidden', default: false },
  scenery: { type: 'boolean', name: 'scenery', default: false },
  illuminated: { type: 'boolean', name: 'illuminated', default: true },
  open: { type: 'boolean', name: 'open', default: true },
  capacity: { type: 'integer', name: 'capacity', default: 8, min: 0, max: 999 },
  image: { type: 'media', name: 'image', default: null },
};

export function wellKnownField(name: string): SproutField | undefined {
  return Object.hasOwn(SPROUT_WELL_KNOWN, name) ? SPROUT_WELL_KNOWN[name] : undefined;
}

/**
 * Which well-known properties APPLY to an object (§2.2's table): the
 * item ones to items, `:illuminated` to rooms, `:open` and `:capacity`
 * to containers. On anything else the name is the object's own — a
 * bucket may have an enum `:open` meaning which lid is off.
 */
export function wellKnownFor(def: {
  role: 'room' | 'item';
  inherit: string | null;
}): ReadonlyMap<string, SproutField> {
  const names =
    def.role === 'room'
      ? ['illuminated', 'open', 'capacity', 'image']
      : def.inherit === 'Container'
        ? ['takeable', 'hidden', 'scenery', 'open', 'capacity', 'image']
        : ['takeable', 'hidden', 'scenery', 'image'];
  return new Map(names.map((n) => [n, SPROUT_WELL_KNOWN[n]!]));
}

// --- expressions (§2.4) ---------------------------------------------------------

/** Where a read, a send, or a move points: a scope object or a name bound in scope (an argument, a parameter, an `each` variable, or a named object in range). */
export type SproutTarget =
  | { kind: 'self' }
  | { kind: 'room' }
  | { kind: 'container' }
  | { kind: 'actor' }
  | { kind: 'name'; name: string };

export const SproutTarget: z.ZodType<SproutTarget> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('self') }),
  z.object({ kind: z.literal('room') }),
  z.object({ kind: z.literal('container') }),
  z.object({ kind: z.literal('actor') }),
  z.object({ kind: z.literal('name'), name: SproutIdent }),
]);

export const SPROUT_BINARY_OPS = ['==', '!=', '<', '<=', '>', '>=', '&&', '||', '+', '-'] as const;
export const SproutBinaryOp = z.enum(SPROUT_BINARY_OPS);
export type SproutBinaryOp = z.infer<typeof SproutBinaryOp>;

export type SproutExpr =
  | { kind: 'literal'; value: SproutValue }
  /** A symbol from a declared set: `:wet`. Stored as its string. */
  | { kind: 'symbol'; name: string }
  | { kind: 'get'; target: SproutTarget; property: string }
  /** `actor.recall(:p)` — what self remembers about the actor. */
  | { kind: 'recall'; property: string }
  /** A bound name used as a value: a handler's `value`, a hook's `was`. */
  | { kind: 'ref'; name: string }
  | { kind: 'is'; target: SproutTarget; kindName: string }
  | { kind: 'count'; target: SproutTarget }
  | { kind: 'not'; expr: SproutExpr }
  | { kind: 'binary'; op: SproutBinaryOp; left: SproutExpr; right: SproutExpr };

export const SproutExpr: z.ZodType<SproutExpr> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('literal'), value: SproutValue }),
    z.object({ kind: z.literal('symbol'), name: SproutIdent }),
    z.object({ kind: z.literal('get'), target: SproutTarget, property: SproutIdent }),
    z.object({ kind: z.literal('recall'), property: SproutIdent }),
    z.object({ kind: z.literal('ref'), name: SproutIdent }),
    z.object({ kind: z.literal('is'), target: SproutTarget, kindName: SproutKindName }),
    z.object({ kind: z.literal('count'), target: SproutTarget }),
    z.object({ kind: z.literal('not'), expr: SproutExpr }),
    z.object({
      kind: z.literal('binary'),
      op: SproutBinaryOp,
      left: SproutExpr,
      right: SproutExpr,
    }),
  ]),
);

// --- statements (§2.4) ----------------------------------------------------------

export type SproutStatement =
  | { kind: 'if'; cond: SproutExpr; then: SproutStatement[]; else: SproutStatement[] }
  /** `self.set(:p, expr)` — self is the only writable target (§2.2). */
  | { kind: 'set'; property: string; value: SproutExpr }
  | { kind: 'adjust'; property: string; by: SproutExpr }
  | { kind: 'say'; text: string }
  /** `describe`'s output. */
  | { kind: 'text'; text: string }
  /** Handed to self's container, which relays (§2.5). */
  | { kind: 'broadcast'; message: string; value: SproutExpr | null }
  | { kind: 'send'; target: SproutTarget; message: string; value: SproutExpr | null }
  | { kind: 'remember'; property: string; value: SproutExpr }
  /** Open media in the lightbox (§2.9): `show`, `show self :blueprint`, `show room`. */
  | { kind: 'show'; target: SproutTarget | null; property: string | null }
  /** A containment PROPOSAL (§2.6), never a write. */
  | { kind: 'move'; what: SproutTarget; to: SproutTarget }
  | { kind: 'spawn'; kindName: string; in: SproutTarget }
  | { kind: 'destroy' }
  | { kind: 'each'; variable: string; in: SproutTarget; body: SproutStatement[] }
  | { kind: 'allow' }
  | { kind: 'refuse'; text: string };

/**
 * The statements that change the world or send into it (§2.12, #441):
 * a write to self's state or memory, an event, a move, a birth, a
 * death. `describe` is prose — it reads anything in range and changes
 * nothing — so the compiler refuses these there, and the engine skips
 * one that reaches it anyway. What is left to describe: `if`, `text`,
 * `show` and `each`.
 */
export const SPROUT_MUTATING_STATEMENTS: ReadonlySet<SproutStatement['kind']> = new Set<
  SproutStatement['kind']
>(['set', 'adjust', 'remember', 'broadcast', 'send', 'move', 'spawn', 'destroy']);

const Body = (): z.ZodType<SproutStatement[]> =>
  z.array(z.lazy(() => SproutStatement)).max(UNDERSTORY_EFFECTS_PER_HANDLER);

export const SproutStatement: z.ZodType<SproutStatement> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('if'), cond: SproutExpr, then: Body(), else: Body() }),
    z.object({ kind: z.literal('set'), property: SproutIdent, value: SproutExpr }),
    z.object({ kind: z.literal('adjust'), property: SproutIdent, by: SproutExpr }),
    z.object({ kind: z.literal('say'), text: z.string().max(UNDERSTORY_SAY_MAX) }),
    z.object({ kind: z.literal('text'), text: z.string().max(UNDERSTORY_PROSE_MAX) }),
    z.object({
      kind: z.literal('broadcast'),
      message: SproutIdent,
      value: SproutExpr.nullable(),
    }),
    z.object({
      kind: z.literal('send'),
      target: SproutTarget,
      message: SproutIdent,
      value: SproutExpr.nullable(),
    }),
    z.object({ kind: z.literal('remember'), property: SproutIdent, value: SproutExpr }),
    z.object({
      kind: z.literal('show'),
      target: SproutTarget.nullable(),
      property: SproutIdent.nullable(),
    }),
    z.object({ kind: z.literal('move'), what: SproutTarget, to: SproutTarget }),
    z.object({ kind: z.literal('spawn'), kindName: SproutKindName, in: SproutTarget }),
    z.object({ kind: z.literal('destroy') }),
    z.object({
      kind: z.literal('each'),
      variable: SproutIdent,
      in: SproutTarget,
      body: Body(),
    }),
    z.object({ kind: z.literal('allow') }),
    z.object({ kind: z.literal('refuse'), text: z.string().max(UNDERSTORY_SAY_MAX) }),
  ]),
);

// --- members (§2.3, §2.5, §2.6) ---------------------------------------------------

/** A message's argument: `(with: object)`. Only objects in v1 (§2.3). */
export const SproutArg = z.object({ name: SproutIdent, type: z.literal('object') });
export type SproutArg = z.infer<typeof SproutArg>;

/**
 * A message the object answers, and — when it has a body and is not
 * reserved — a verb the parser can reach (§2.7). `when` is the guard
 * under which the verb is OFFERED (easy mode's chips, the parser's
 * "you can't do that right now"): v0's verb guard, kept because a chip
 * that is not there is a better answer than one that says no.
 */
export const SproutMessage = z.object({
  name: SproutIdent,
  args: z.array(SproutArg).max(SPROUT_ARGS_PER_MESSAGE),
  grammar: z
    .array(z.string().trim().min(1).max(SPROUT_GRAMMAR_LINE_MAX))
    .max(SPROUT_GRAMMAR_PER_MESSAGE),
  when: SproutExpr.nullable(),
  abstract: z.boolean(),
  body: Body(),
});
export type SproutMessage = z.infer<typeof SproutMessage>;

/** `on :m (from, value) { … }`: a message arrived (§2.5). Parameter names are the builder's; null means unnamed. */
export const SproutOn = z.object({
  message: SproutIdent,
  from: SproutIdent.nullable(),
  value: SproutIdent.nullable(),
  body: Body(),
});
export type SproutOn = z.infer<typeof SproutOn>;

/** `changed :p (value, was) { … }`: a property of self changed (§2.5). */
export const SproutChanged = z.object({
  property: SproutIdent,
  value: SproutIdent.nullable(),
  was: SproutIdent.nullable(),
  body: Body(),
});
export type SproutChanged = z.infer<typeof SproutChanged>;

/** `pass :m (expr)` / `pass any (expr)` on a container (§2.5). `message` null = any. */
export const SproutPass = z.object({
  message: SproutIdent.nullable(),
  condition: SproutExpr,
});
export type SproutPass = z.infer<typeof SproutPass>;

export const SPROUT_CONSENTS = ['depart', 'release', 'accept'] as const;
export const SproutConsentKind = z.enum(SPROUT_CONSENTS);
export type SproutConsentKind = z.infer<typeof SproutConsentKind>;

/**
 * A containment guard (§2.6): `depart (to)`, `release (item, to)`,
 * `accept (item, from)`. Read-only by grammar — the body may hold only
 * `if`, `allow` and `refuse` (checked below).
 */
export const SproutConsent = z.object({
  guard: SproutConsentKind,
  params: z.array(SproutIdent).max(2),
  body: Body(),
});
export type SproutConsent = z.infer<typeof SproutConsent>;

/**
 * The kind body every object carries (§2.2–§2.6). `describe` produces
 * the object's prose with `text` and changes nothing (§2.12); an empty
 * describe means the plain `prose`. `remembers` is what the object keeps about each visitor
 * (v0 `visitorFields`), declared so the legibility panel knows the shape.
 */
const SproutKindBody = {
  properties: z.array(SproutField).max(UNDERSTORY_FIELDS_PER_OBJECT).default([]),
  remembers: z.array(SproutField).max(UNDERSTORY_FIELDS_PER_OBJECT).default([]),
  describe: Body().default([]),
  messages: z.array(SproutMessage).max(UNDERSTORY_VERBS_PER_OBJECT).default([]),
  handlers: z.array(SproutOn).max(UNDERSTORY_HANDLERS_PER_OBJECT).default([]),
  hooks: z.array(SproutChanged).max(UNDERSTORY_HANDLERS_PER_OBJECT).default([]),
  passRules: z.array(SproutPass).max(UNDERSTORY_HANDLERS_PER_OBJECT).default([]),
  consents: z.array(SproutConsent).max(SPROUT_CONSENTS.length).default([]),
};
export const SproutKindBodyShape = z.object(SproutKindBody);
export type SproutKindBody = z.infer<typeof SproutKindBodyShape>;

const SproutHeader = {
  format: z.literal(SPROUT_FORMAT),
  /** The display name, as v0. */
  name: z.string().trim().min(1, { error: 'It needs a name.' }).max(UNDERSTORY_NAME_MAX),
  /** `:names` — the words the parser accepts; empty = the name, humanised. */
  names: z
    .array(z.string().trim().min(1).max(SPROUT_NAME_WORD_MAX))
    .max(SPROUT_NAMES_MAX)
    .default([]),
  /** The plain prose `describe` falls back to. */
  prose: z.string().max(UNDERSTORY_PROSE_MAX),
  /** The kind this object is an instance of — a built-in until #341 lets a zone define its own. */
  inherit: SproutKindName.nullable().default(null),
  /** The Sprout text the builder wrote, kept beside the AST (§4 c). Null: built in the form. */
  source: z.string().max(UNDERSTORY_DEFINITION_BYTES_MAX).nullable().default(null),
};

/** A room: an instance of `Room`, with exits. */
export const RoomDefinition2 = z
  .object({
    ...SproutHeader,
    role: z.literal('room'),
    exits: z.array(RoomExit).max(UNDERSTORY_EXITS_PER_ROOM),
    ...SproutKindBody,
  })
  .superRefine((def, ctx) => {
    for (const problem of sproutDefinitionProblems(def))
      ctx.addIssue({ code: 'custom', message: problem });
  });
export type RoomDefinition2 = z.infer<typeof RoomDefinition2>;

/** An item: an anonymous kind of one (inherit null), or an instance of a kind. */
export const ItemDefinition2 = z
  .object({ ...SproutHeader, role: z.literal('item'), ...SproutKindBody })
  .superRefine((def, ctx) => {
    for (const problem of sproutDefinitionProblems(def))
      ctx.addIssue({ code: 'custom', message: problem });
  });
export type ItemDefinition2 = z.infer<typeof ItemDefinition2>;

export type SproutDefinition2 = RoomDefinition2 | ItemDefinition2;

bindFormat2(RoomDefinition2, ItemDefinition2);

/**
 * A kind (#341, §2.8): behaviour and defaults, never placed. `name` is
 * the display name a spawned instance carries ("Wet cup"); `kindName`
 * is what Sprout calls it (`WetCup`). Abstract messages are legal here.
 */
export const KindDefinition = z
  .object({ ...SproutHeader, role: z.literal('kind'), kindName: SproutKindName, ...SproutKindBody })
  .superRefine((def, ctx) => {
    for (const problem of sproutDefinitionProblems(def))
      ctx.addIssue({ code: 'custom', message: problem });
  });
export type KindDefinition = z.infer<typeof KindDefinition>;

/** `WetCup` → "Wet cup": a kind's default display name. */
export function humaniseKind(kindName: string): string {
  const words = kindName
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_+/g, ' ')
    .toLowerCase();
  return words === '' ? kindName : words[0]!.toUpperCase() + words.slice(1);
}

/** What a kind resolves to once its parents are folded in. */
export interface ResolvedDefinition {
  /** The flattened definition: every inherited member folded in, `inherit` the built-in root (or null). */
  definition: SproutDefinition2;
  /** The kind names on the chain, most specific first — what `is(Kind)` answers. */
  kinds: string[];
  /** Messages still abstract after folding — a placed instance with any cannot run them. */
  abstract: string[];
}

const RESOLVE_DEPTH = 8;

function chainOf(
  inherit: string | null,
  kinds: ReadonlyMap<string, KindDefinition>,
): { chain: KindDefinition[]; root: string | null } {
  const chain: KindDefinition[] = [];
  const seen = new Set<string>();
  let cur = inherit;
  while (cur !== null && !(SPROUT_BUILTIN_KINDS as readonly string[]).includes(cur)) {
    const kind = kinds.get(cur);
    if (!kind || seen.has(cur) || chain.length >= RESOLVE_DEPTH) return { chain, root: null };
    seen.add(cur);
    chain.push(kind);
    cur = kind.inherit;
  }
  return { chain, root: cur };
}

/**
 * Fold a definition's kinds into it (§2.8): parents first, each child
 * overriding by name — a property, a message, a handler, a hook, a pass
 * rule, a consent guard — with the most specific non-empty `describe`,
 * `names` and `prose` winning. The engine runs the flattened result and
 * asks `kinds` for `is(Kind)`.
 */
export function resolveDefinition(
  def: SproutDefinition2,
  kinds: ReadonlyMap<string, KindDefinition>,
): ResolvedDefinition {
  const { chain, root } = chainOf(def.inherit, kinds);
  const layers: SproutKindBody[] = [...chain].reverse().map((k) => k);
  const byKey = <T>(items: readonly T[], key: (t: T) => string): Map<string, T> =>
    new Map(items.map((t) => [key(t), t]));
  const merged: SproutKindBody = {
    properties: [],
    remembers: [],
    describe: [],
    messages: [],
    handlers: [],
    hooks: [],
    passRules: [],
    consents: [],
  };
  const fold = <T>(current: T[], next: readonly T[], key: (t: T) => string): T[] => {
    const table = byKey(current, key);
    for (const t of next) table.set(key(t), t);
    return [...table.values()];
  };
  let names = def.names;
  let prose = def.prose;
  let describe = def.describe;
  const bodies: SproutKindBody[] = [...layers, def];
  for (const body of bodies) {
    merged.properties = fold(merged.properties, body.properties, (p) => p.name);
    merged.remembers = fold(merged.remembers, body.remembers, (p) => p.name);
    merged.messages = fold(merged.messages, body.messages, (m) => m.name);
    merged.handlers = fold(merged.handlers, body.handlers, (h) => h.message);
    merged.hooks = fold(merged.hooks, body.hooks, (h) => h.property);
    merged.passRules = fold(merged.passRules, body.passRules, (p) => p.message ?? '*');
    merged.consents = fold(merged.consents, body.consents, (c) => c.guard);
  }
  for (const layer of [...chain]) {
    if (names.length === 0 && layer.names.length > 0) names = layer.names;
    if (prose === '' && layer.prose !== '') prose = layer.prose;
    if (describe.length === 0 && layer.describe.length > 0) describe = layer.describe;
  }
  merged.describe = describe;
  const definition: SproutDefinition2 = { ...def, names, prose, inherit: root, ...merged };
  return {
    definition,
    kinds: chain.map((k) => k.kindName),
    abstract: merged.messages.filter((m) => m.abstract).map((m) => m.name),
  };
}

/** A spawned instance's definition (§2.8): the kind, as an item of it, resolved. */
export function kindAsItem(
  kind: KindDefinition,
  kinds: ReadonlyMap<string, KindDefinition>,
): ResolvedDefinition {
  const instance: ItemDefinition2 = {
    format: 2,
    role: 'item',
    name: kind.name,
    names: [],
    prose: '',
    inherit: kind.kindName,
    source: null,
    properties: [],
    remembers: [],
    describe: [],
    messages: [],
    handlers: [],
    hooks: [],
    passRules: [],
    consents: [],
  };
  return resolveDefinition(instance, kinds);
}

/** Either format, as a saver receives it. The engine runs v1 until #339; a v2 row is upgraded-in-place v1 until then. */
export const AnySproutDefinition = z.union([
  RoomDefinition,
  ItemDefinition,
  RoomDefinition2,
  ItemDefinition2,
]);
export type AnySproutDefinition = z.infer<typeof AnySproutDefinition>;

// --- the compiler's checks that need no parser (§3) ------------------------------

function exprDepth(e: SproutExpr): number {
  switch (e.kind) {
    case 'not':
      return 1 + exprDepth(e.expr);
    case 'binary':
      return 1 + Math.max(exprDepth(e.left), exprDepth(e.right));
    default:
      return 1;
  }
}

/**
 * How deep a statement nests. An `else if` chain is one level, as it is
 * on the page (a describe upgraded from sixteen views is a chain of
 * sixteen, not a tree sixteen deep).
 */
function statementDepth(s: SproutStatement): number {
  switch (s.kind) {
    case 'if':
      return 1 + chainDepth(s);
    case 'each':
      return 1 + Math.max(0, ...s.body.map(statementDepth));
    default:
      return 1;
  }
}

function chainDepth(s: Extract<SproutStatement, { kind: 'if' }>): number {
  const own = Math.max(exprDepth(s.cond), ...s.then.map(statementDepth));
  const next = s.else.length === 1 && s.else[0]!.kind === 'if' ? s.else[0] : null;
  return Math.max(own, next ? chainDepth(next) : Math.max(0, ...s.else.map(statementDepth)));
}

function literalFits(field: SproutField, e: SproutExpr): boolean {
  if (e.kind === 'symbol') return field.type === 'enum' && field.options.includes(e.name);
  if (e.kind !== 'literal') return true; // a computed value is the engine's to fit at runtime
  switch (field.type) {
    case 'boolean':
      return typeof e.value === 'boolean';
    case 'integer':
      return typeof e.value === 'number';
    case 'enum':
      return typeof e.value === 'string' && field.options.includes(e.value);
    case 'media':
      return e.value === null || typeof e.value === 'string';
  }
}

interface Scope {
  self: Map<string, SproutField>;
  wellKnown: ReadonlyMap<string, SproutField>;
  remembers: Map<string, SproutField>;
  /** Names bound here: arguments, parameters, `each` variables. */
  names: Set<string>;
  /** Properties may be undeclared here because a kind supplies them. */
  inherits: boolean;
  where: string;
  /** Where `text` is legal (describe) and `say` is not. */
  describe: boolean;
  /** A consent guard: only `if`, `allow`, `refuse`. */
  consent: boolean;
}

function* exprProblems(e: SproutExpr, scope: Scope): Generator<string> {
  switch (e.kind) {
    case 'get':
      // A name is an argument, a parameter, an `each` variable, or a
      // named object in range — the last is only known at runtime, so
      // names are never refused here (the saver checks siblings, as v0).
      if (e.target.kind === 'self' && !scope.inherits) {
        if (!scope.self.has(e.property) && !scope.wellKnown.has(e.property)) {
          yield `${scope.where}: reads a property "${e.property}" that self does not declare.`;
        }
      }
      return;
    case 'recall':
      if (!scope.remembers.has(e.property) && !scope.inherits) {
        yield `${scope.where}: recalls "${e.property}", which self does not declare it remembers.`;
      }
      return;
    case 'ref':
      if (!scope.names.has(e.name)) {
        yield `${scope.where}: "${e.name}" is not a parameter or variable here.`;
      }
      return;
    case 'is':
    case 'count':
      return;
    case 'not':
      yield* exprProblems(e.expr, scope);
      return;
    case 'binary':
      yield* exprProblems(e.left, scope);
      yield* exprProblems(e.right, scope);
      return;
    default:
      return;
  }
}

function* statementProblems(body: readonly SproutStatement[], scope: Scope): Generator<string> {
  for (const s of body) {
    if (scope.consent && s.kind !== 'if' && s.kind !== 'allow' && s.kind !== 'refuse') {
      yield `${scope.where}: a consent guard may only test, allow or refuse — "${s.kind}" is not allowed there.`;
      continue;
    }
    if (!scope.consent && (s.kind === 'allow' || s.kind === 'refuse')) {
      yield `${scope.where}: "${s.kind}" belongs in a depart / release / accept guard.`;
      continue;
    }
    if (scope.describe && SPROUT_MUTATING_STATEMENTS.has(s.kind)) {
      // §2.12 (#441): looking at a thing changes nothing. A trap that
      // springs on examination is a later `on :describe` on the bus.
      yield `${scope.where}: "${s.kind}" changes the world, and describe only reads it — put it in a message or a handler.`;
      continue;
    }
    switch (s.kind) {
      case 'if':
        yield* exprProblems(s.cond, scope);
        yield* statementProblems(s.then, scope);
        yield* statementProblems(s.else, scope);
        break;
      case 'set':
      case 'adjust': {
        const field = scope.self.get(s.property) ?? scope.wellKnown.get(s.property);
        if (!field) {
          if (!scope.inherits)
            yield `${scope.where}: "${s.kind}" names a property "${s.property}" that self does not declare.`;
        } else if (s.kind === 'adjust' && field.type !== 'integer') {
          yield `${scope.where}: "adjust" only moves integer properties; "${s.property}" is ${field.type}.`;
        } else if (s.kind === 'set' && !literalFits(field, s.value)) {
          yield `${scope.where}: that is not a value of "${s.property}".`;
        }
        yield* exprProblems(s.kind === 'set' ? s.value : s.by, scope);
        break;
      }
      case 'remember': {
        const field = scope.remembers.get(s.property);
        if (!field) {
          if (!scope.inherits)
            yield `${scope.where}: remembers "${s.property}", which self does not declare it remembers.`;
        } else if (!literalFits(field, s.value)) {
          yield `${scope.where}: that is not a value of remembered "${s.property}".`;
        }
        yield* exprProblems(s.value, scope);
        break;
      }
      case 'say':
        if (scope.describe) yield `${scope.where}: "say" does not belong in describe — use "text".`;
        break;
      case 'text':
        if (!scope.describe) yield `${scope.where}: "text" only belongs in describe — use "say".`;
        break;
      case 'broadcast':
        if (s.value) yield* exprProblems(s.value, scope);
        break;
      case 'send':
        if (s.value) yield* exprProblems(s.value, scope);
        break;
      case 'show':
        break;
      case 'move':
        break;
      case 'spawn':
        break;
      case 'each': {
        if (scope.names.has(s.variable)) yield `${scope.where}: "${s.variable}" is already bound.`;
        const inner: Scope = { ...scope, names: new Set([...scope.names, s.variable]) };
        yield* statementProblems(s.body, inner);
        break;
      }
      default:
        break;
    }
  }
}

/** Messages the engine sends or the built-in verbs own (§2.3): never a verb the parser offers. */
export const SPROUT_RESERVED_MESSAGES: ReadonlySet<string> = new Set([
  'describe',
  'examine',
  'spawned',
  'depart',
  'release',
  'accept',
  'moved',
  'left',
  'entered',
  'take',
  'drop',
  'give',
  'go',
  'look',
  'inventory',
  'wait',
  'help',
]);

const RESERVED_MESSAGES = SPROUT_RESERVED_MESSAGES;

const GRAMMAR_SLOT = /\[([a-z][a-z0-9_]*)\]/g;

function isContainerKind(
  def: { role: 'room' | 'item' | 'kind'; inherit: string | null },
  zoneKinds?: ReadonlyMap<string, KindDefinition>,
): boolean | null {
  if (def.role === 'room') return true;
  if (def.inherit === null) return false;
  if (def.inherit === 'Container') return true;
  if ((SPROUT_BUILTIN_KINDS as readonly string[]).includes(def.inherit)) return false;
  if (!zoneKinds) return null; // a zone's own kind: only the saver, with the zone's kinds, can say
  return chainOf(def.inherit, zoneKinds).root === 'Container';
}

/**
 * Everything a v2 definition can get wrong on its own (sprout.md §3).
 * Returned as prose for the editor; `RoomDefinition2` / `ItemDefinition2`
 * refuse at parse when any is present, so nothing with problems is saved.
 */
export interface ProblemOptions {
  /** The zone's kinds by name; when given, `inherit` must name one (or a built-in). */
  zoneKinds?: ReadonlyMap<string, KindDefinition>;
}

export function sproutDefinitionProblems(
  def: Omit<RoomDefinition2, 'exits'> | ItemDefinition2 | KindDefinition,
  options: ProblemOptions = {},
): string[] {
  const problems: string[] = [];
  const wellKnown = wellKnownFor(
    def.role === 'kind' ? { role: 'item', inherit: def.inherit } : def,
  );
  const declare = (fields: readonly SproutField[], what: string): Map<string, SproutField> => {
    const table = new Map<string, SproutField>();
    for (const f of fields) {
      if (table.has(f.name)) problems.push(`The ${what} "${f.name}" is declared twice.`);
      const known = what === 'property' ? wellKnown.get(f.name) : undefined;
      if (known && known.type !== f.type) {
        problems.push(
          `"${f.name}" is a well-known ${known.type} property; it cannot be declared as ${f.type}.`,
        );
      }
      table.set(f.name, f);
    }
    return table;
  };
  const self = declare(def.properties, 'property');
  const remembers = declare(def.remembers, 'remembered property');
  const inherits =
    def.inherit !== null && !(SPROUT_BUILTIN_KINDS as readonly string[]).includes(def.inherit);
  if (def.inherit === 'Actor') problems.push('Nothing may inherit Actor.');
  if (def.role === 'room' && def.inherit !== null && def.inherit !== 'Room') {
    problems.push('A room is a Room; it cannot inherit anything else.');
  }
  if (def.role !== 'room' && def.inherit === 'Room') problems.push('Only a room is a Room.');
  if (def.role === 'kind' && def.inherit === def.kindName) {
    problems.push(`"${def.kindName}" cannot inherit itself.`);
  }
  if (inherits && options.zoneKinds && !options.zoneKinds.has(def.inherit!)) {
    problems.push(`No kind called "${def.inherit}" is defined here.`);
  }
  if (inherits && def.role !== 'kind') {
    const behaviour =
      def.messages.length +
      def.handlers.length +
      def.hooks.length +
      def.passRules.length +
      def.consents.length;
    if (behaviour > 0) {
      problems.push(
        'An instance of a kind may set its properties, names and describe — not behaviour. Write the kind.',
      );
    }
  }
  const base = (where: string): Scope => ({
    self,
    wellKnown,
    remembers,
    names: new Set(),
    inherits,
    where,
    describe: false,
    consent: false,
  });
  const deep = (where: string, body: readonly SproutStatement[], extra = 0) => {
    const depth = Math.max(extra, ...body.map(statementDepth));
    if (depth > UNDERSTORY_NODE_DEPTH_MAX) {
      problems.push(`${where}: nests too deep (${UNDERSTORY_NODE_DEPTH_MAX} at most).`);
    }
  };

  problems.push(...statementProblems(def.describe, { ...base('Describe'), describe: true }));
  deep('Describe', def.describe);

  const seenMessages = new Set<string>();
  for (const m of def.messages) {
    const where = `Message "${m.name}"`;
    if (seenMessages.has(m.name)) problems.push(`${where} is declared twice.`);
    seenMessages.add(m.name);
    if (m.abstract && def.role !== 'kind') {
      problems.push(
        `${where} is abstract, and abstract messages belong on kinds, not on something placed in a room.`,
      );
    }
    if (m.abstract && m.body.length > 0)
      problems.push(`${where}: abstract and has a body — one or the other.`);
    const argNames = new Set<string>();
    for (const a of m.args) {
      if (argNames.has(a.name))
        problems.push(`${where}: the argument "${a.name}" is declared twice.`);
      argNames.add(a.name);
    }
    for (const line of m.grammar) {
      for (const match of line.matchAll(GRAMMAR_SLOT)) {
        const slot = match[1]!;
        if (slot !== 'self' && !argNames.has(slot)) {
          problems.push(
            `${where}: the grammar line "${line}" names [${slot}], which is not an argument.`,
          );
        }
      }
    }
    const scope = { ...base(where), names: argNames };
    if (m.when) problems.push(...exprProblems(m.when, scope));
    problems.push(...statementProblems(m.body, scope));
    deep(where, m.body, m.when ? exprDepth(m.when) : 0);
  }

  const seenOn = new Set<string>();
  for (const h of def.handlers) {
    const where = `On "${h.message}"`;
    if (seenOn.has(h.message)) problems.push(`${where} is handled twice.`);
    seenOn.add(h.message);
    if ((SPROUT_CONSENTS as readonly string[]).includes(h.message)) {
      problems.push(`${where}: "${h.message}" is a consent guard, not a message to handle.`);
    }
    const names = new Set([h.from, h.value].filter((n): n is string => n !== null));
    problems.push(...statementProblems(h.body, { ...base(where), names }));
    deep(where, h.body);
  }

  const seenChanged = new Set<string>();
  for (const c of def.hooks) {
    const where = `Changed "${c.property}"`;
    if (seenChanged.has(c.property)) problems.push(`${where} is hooked twice.`);
    seenChanged.add(c.property);
    if (!self.has(c.property) && !wellKnown.has(c.property) && !inherits) {
      problems.push(`${where}: self does not declare a property "${c.property}".`);
    }
    const names = new Set([c.value, c.was].filter((n): n is string => n !== null));
    problems.push(...statementProblems(c.body, { ...base(where), names }));
    deep(where, c.body);
  }

  const container = isContainerKind(def, options.zoneKinds);
  if (def.passRules.length > 0 && container === false) {
    problems.push(
      'Only a container (a room, or a kind that inherits Container) can have pass rules.',
    );
  }
  const seenPass = new Set<string | null>();
  for (const p of def.passRules) {
    const key = p.message;
    if (seenPass.has(key))
      problems.push(`Pass ${key === null ? 'any' : `"${key}"`} is declared twice.`);
    seenPass.add(key);
    problems.push(...exprProblems(p.condition, base(`Pass ${key ?? 'any'}`)));
  }

  const seenConsent = new Set<string>();
  for (const c of def.consents) {
    const where = `${c.guard[0]!.toUpperCase()}${c.guard.slice(1)} guard`;
    if (seenConsent.has(c.guard)) problems.push(`${where} is declared twice.`);
    seenConsent.add(c.guard);
    const arity = c.guard === 'depart' ? 1 : 2;
    if (c.params.length > arity)
      problems.push(`${where} takes ${arity} parameter${arity === 1 ? '' : 's'}.`);
    if (c.guard !== 'depart' && container === false) {
      problems.push(`${where}: only a container can ${c.guard} things.`);
    }
    problems.push(
      ...statementProblems(c.body, { ...base(where), names: new Set(c.params), consent: true }),
    );
    deep(where, c.body);
  }

  if (JSON.stringify(def).length > UNDERSTORY_DEFINITION_BYTES_MAX) {
    problems.push(
      `The definition is too big (${UNDERSTORY_DEFINITION_BYTES_MAX / 1024} KB at most).`,
    );
  }
  return problems;
}

/**
 * Warnings (sprout.md §3): saved, shown in the editor. A `changed` for a
 * property nothing sets; an `on` for a message nothing here sends and
 * the engine does not emit — the zone-wide half (another object
 * broadcasting it) is the saver's, which knows the siblings.
 */
export function sproutDefinitionWarnings(
  def: SproutDefinition2,
  zoneMessages?: readonly string[],
): string[] {
  const warnings: string[] = [];
  const setHere = new Set<string>();
  const sentHere = new Set<string>();
  const walk = (body: readonly SproutStatement[]) => {
    for (const s of body) {
      if (s.kind === 'set' || s.kind === 'adjust') setHere.add(s.property);
      if (s.kind === 'broadcast' || s.kind === 'send') sentHere.add(s.message);
      if (s.kind === 'if') {
        walk(s.then);
        walk(s.else);
      }
      if (s.kind === 'each') walk(s.body);
    }
  };
  for (const m of def.messages) walk(m.body);
  for (const h of def.handlers) walk(h.body);
  for (const c of def.hooks) walk(c.body);
  for (const c of def.hooks) {
    if (!setHere.has(c.property)) {
      warnings.push(`Changed "${c.property}" never fires: nothing here sets it.`);
    }
  }
  const known = new Set([...sentHere, ...(zoneMessages ?? []), ...RESERVED_MESSAGES]);
  for (const h of def.handlers) {
    if (!known.has(h.message)) {
      warnings.push(
        `On "${h.message}" never fires: nothing sends it${zoneMessages ? ' in this zone' : ' here'}.`,
      );
    }
  }
  return warnings;
}

// --- the upgrade from format 1 (§4, §6) -------------------------------------------

function guardToExpr(g: SproutGuard): SproutExpr {
  switch (g.kind) {
    case 'all':
      return g.guards
        .map(guardToExpr)
        .reduce((l, r) => ({ kind: 'binary', op: '&&', left: l, right: r }));
    case 'any':
      return g.guards
        .map(guardToExpr)
        .reduce((l, r) => ({ kind: 'binary', op: '||', left: l, right: r }));
    case 'not':
      return { kind: 'not', expr: guardToExpr(g.guard) };
    case 'field': {
      const read: SproutExpr =
        g.on === 'self'
          ? { kind: 'get', target: { kind: 'self' }, property: g.field }
          : { kind: 'recall', property: g.field };
      const lit = (value: SproutValue): SproutExpr => ({ kind: 'literal', value });
      if (g.op === 'in') {
        const values = Array.isArray(g.value) ? g.value : [g.value];
        if (values.length === 0) return lit(false);
        return values
          .map((v): SproutExpr => ({ kind: 'binary', op: '==', left: read, right: lit(v) }))
          .reduce((l, r) => ({ kind: 'binary', op: '||', left: l, right: r }));
      }
      const value = Array.isArray(g.value) ? (g.value[0] ?? false) : g.value;
      const op: SproutBinaryOp = (
        { eq: '==', neq: '!=', gt: '>', lt: '<', gte: '>=', lte: '<=' } as const
      )[g.op];
      return { kind: 'binary', op, left: read, right: lit(value) };
    }
  }
}

function effectsToBody(effects: readonly SproutEffect[]): SproutStatement[] {
  const out: SproutStatement[] = [];
  for (const e of effects) {
    switch (e.op) {
      case 'set':
        out.push({ kind: 'set', property: e.field, value: { kind: 'literal', value: e.value } });
        break;
      case 'adjust':
        out.push({ kind: 'adjust', property: e.field, by: { kind: 'literal', value: e.by } });
        break;
      case 'set_visitor':
        out.push({
          kind: 'remember',
          property: e.field,
          value: { kind: 'literal', value: e.value },
        });
        break;
      case 'say':
        out.push({ kind: 'say', text: e.text });
        break;
      case 'send_message':
        if (e.to === 'room') {
          out.push({ kind: 'send', target: { kind: 'room' }, message: e.message, value: null });
        } else if (e.to === 'items') {
          // v0 "every item" reached the items and not the room; a broadcast
          // reaches the room too, which may now handle it (sprout.md §6).
          out.push({ kind: 'broadcast', message: e.message, value: null });
        } else {
          out.push({
            kind: 'send',
            target: { kind: 'name', name: messageIdent(e.item ?? '') },
            message: e.message,
            value: null,
          });
        }
        break;
      case 'branch':
        out.push({
          kind: 'if',
          cond: guardToExpr(e.guard),
          then: effectsToBody(e.then),
          else: effectsToBody(e.otherwise),
        });
        break;
    }
  }
  return out;
}

/** A v0 label ("Kick the wheel", "Brass key") as an identifier: `kick_the_wheel`. */
export function messageIdent(label: string): string {
  const ident = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[0-9]/, (d) => `n${d}`)
    .slice(0, 32);
  return ident === '' ? 'it' : ident;
}

/**
 * v0 → v2, mechanically and totally (sprout.md §4, §6): fields become
 * properties, `portable` a declared `:takeable`, views a `describe`
 * if-chain ending in the plain prose, verbs messages offered `when`
 * their guard passes with the label, as written, as their one grammar
 * line (grammar matches case-insensitively; the chip keeps the case), handlers
 * `on` handlers guarded by `if`, effects statements. The name and the
 * prose are kept as they are; `source` is null (the printer, #338,
 * shows it as Sprout). A v2 definition is returned unchanged.
 */
export function upgradeSproutDefinition(
  def: SproutDefinition | SproutDefinition2,
): SproutDefinition2 {
  if (def.format === 2) return def;
  const describe: SproutStatement[] = [];
  const plain: SproutStatement = { kind: 'text', text: def.prose };
  let unconditional = false;
  const chain: { cond: SproutExpr; text: string }[] = [];
  for (const v of def.views) {
    if (v.guard === null) {
      describe.push(...chainToBody(chain, { kind: 'text', text: v.prose }));
      unconditional = true;
      break;
    }
    chain.push({ cond: guardToExpr(v.guard), text: v.prose });
  }
  if (!unconditional && chain.length > 0) describe.push(...chainToBody(chain, plain));

  const taken = new Set<string>();
  const messages: SproutMessage[] = def.verbs.map((v) => {
    let name = messageIdent(v.name);
    for (let n = 2; taken.has(name); n++) name = `${messageIdent(v.name).slice(0, 29)}_${n}`;
    taken.add(name);
    return {
      name,
      args: [],
      grammar: [v.name.trim()],
      when: v.guard ? guardToExpr(v.guard) : null,
      abstract: false,
      body: effectsToBody(v.effects),
    };
  });
  const handlers: SproutOn[] = def.handlers.map((h) => ({
    message: h.message,
    from: null,
    value: null,
    body: h.guard
      ? [{ kind: 'if', cond: guardToExpr(h.guard), then: effectsToBody(h.effects), else: [] }]
      : effectsToBody(h.effects),
  }));
  const properties: SproutField[] = [...def.fields];
  const body: SproutKindBody = {
    properties,
    remembers: [...def.visitorFields],
    describe,
    messages,
    handlers,
    hooks: [],
    passRules: [],
    consents: [],
  };
  const header = {
    format: SPROUT_FORMAT,
    name: def.name,
    names: [],
    prose: def.prose,
    inherit: null,
    source: null,
  } satisfies Partial<SproutDefinition2>;
  if ('exits' in def) {
    return { ...header, role: 'room', exits: [...def.exits], ...body };
  }
  if (!properties.some((p) => p.name === 'takeable')) {
    properties.push({ type: 'boolean', name: 'takeable', default: def.portable });
  }
  return { ...header, role: 'item', ...body };
}

function chainToBody(
  chain: readonly { cond: SproutExpr; text: string }[],
  last: SproutStatement,
): SproutStatement[] {
  if (chain.length === 0) return [last];
  const [head, ...rest] = chain;
  return [
    {
      kind: 'if',
      cond: head!.cond,
      then: [{ kind: 'text', text: head!.text }],
      else: chainToBody(rest, last),
    },
  ];
}
