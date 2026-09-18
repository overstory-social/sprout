import { z } from 'zod';

import type { SproutValue } from './definitions.js';

// Extensions (design/proposals/2026-09-17-sprout-split.md §3.5): what a
// host may add to the language without changing its computation class.
// Five declarative points — a value type, a well-known property, a
// statement, a compile-time check on that statement, a transcript line
// for the effect it records — under one rule: **an extension statement
// records an effect; it never performs one.** `run` is handed a frozen,
// read-only view of the frame and returns a value the evaluator
// appends to the outcome; what happens because of that effect (a
// lightbox, a signed URL, a line in a terminal) is the host's, after the
// turn. Extensions are host-trusted code, not sandboxed: the evaluator
// contains a buggy one the way it contains a faulting object (a throw
// becomes a fault naming the extension, every run is charged against
// the event budget, effects per action are capped, and `checkExtension`
// verifies a statement that claims to belong in `describe` really does
// nothing), but it cannot stop a malicious one — the trust boundary is
// host ↔ extension author, an npm boundary.
//
// A source names the extensions it depends on with `use <name>` lines at
// its top, so a source is portable and a host without the extension
// refuses it at compile time ("this host has no media").

/** The literal form of an extension value type after a property's name: `:image media "m-…"`. */
export interface LiteralSyntax {
  /** The word that introduces the literal — reserved as a keyword in sources that `use` the extension. */
  keyword: string;
  /** What may follow the keyword: nothing, a quoted string, or either. */
  takes: 'none' | 'string' | 'optional-string';
}

/**
 * A value type an extension adds: how it is written, how a stored value
 * is fit to it, what it defaults to, how it prints, and the persisted
 * shape (part of the language's public storage contract, §3.2).
 */
export interface ValueType {
  /** The `type` tag on a field declared with it. Lower-case identifier; may not shadow a built-in type. */
  name: string;
  literal: LiteralSyntax;
  /** Storage → value, or `undefined` when it does not fit (the engine then keeps the default). */
  fit(raw: unknown): SproutValue | undefined;
  default: SproutValue;
  /** The literal text for a value, as the printer writes it after the property's name. */
  print(value: SproutValue): string;
  /** The persisted shape. */
  storage: z.ZodType<SproutValue>;
}

/** A well-known property an extension adds (sprout.md §2.2's table), and where it applies. */
export interface WellKnownProperty {
  name: string;
  /** A built-in type or one of the extension's own value types. */
  type: string;
  default: SproutValue;
  /** Rooms, items (kinds are items), or both. */
  on: readonly ('room' | 'item')[];
}

export type StatementArgKind = 'target' | 'symbol' | 'string' | 'expr';

/** One argument of an extension statement, in the order it is written. */
export interface StatementArg {
  name: string;
  kind: StatementArgKind;
  optional?: boolean;
}

/** An object as an extension body may see it: its id, what it is, and its name — nothing writable. */
export interface ObjectRef {
  readonly id: string;
  readonly kind: 'room' | 'item' | 'actor';
  readonly name: string;
}

/** The whole api an extension's `run` programs against. Frozen; every path reads. */
export interface ReadOnlyFrame {
  readonly self: ObjectRef;
  readonly room: ObjectRef;
  readonly container: ObjectRef | null;
  readonly actor: ObjectRef;
  /** A name in scope — an argument, a parameter, a named object in range — or null. */
  resolve(name: string): ObjectRef | null;
  /** A property of an object in range: its state, else its well-known default, else null. */
  get(ref: ObjectRef, property: string): SproutValue | null;
  is(ref: ObjectRef, kindName: string): boolean;
}

/** The arguments of one statement as `run` receives them: resolved targets, symbol names, strings, evaluated expressions. */
export type BoundArgs = Readonly<Record<string, ObjectRef | SproutValue | null | undefined>>;

/** The arguments as the compiler sees them, for `check`: the AST forms, by name. */
export type StaticArgs = Readonly<
  Record<
    string,
    | { kind: 'target'; target: { kind: string; name?: string } }
    | { kind: 'symbol'; name: string }
    | { kind: 'string'; text: string }
    | { kind: 'expr' }
    | null
    | undefined
  >
>;

/** What the compiler tells `check` about the object being compiled. */
export interface CheckScope {
  /** The properties self declares, by name, with their type tags. */
  properties: ReadonlyMap<string, { type: string }>;
  /** The well-known properties that apply to self. */
  wellKnown: ReadonlyMap<string, { type: string }>;
  /** Self inherits a kind the compiler cannot see, so an undeclared property may be the kind's. */
  inherits: boolean;
}

/** What an extension statement records. `extension` and `kind` are the discriminator; the rest is the extension's. */
export interface Effect {
  extension: string;
  kind: string;
  [key: string]: unknown;
}

export interface StatementSpec<E extends Effect = Effect> {
  args: readonly StatementArg[];
  /** May appear in `describe`, where nothing may write (sprout.md §2.12). Verified by `checkExtension`. */
  inDescribe: boolean;
  /** May appear in a consent guard — where a refusal must leave the world exactly as it was (§8-4). Default false. */
  inConsent?: boolean;
  /** At save: problems with these arguments on this object. */
  check?(args: StaticArgs, scope: CheckScope): string[];
  /** At play: read, and record — or record nothing. */
  run(frame: ReadOnlyFrame, args: BoundArgs): E | void;
}

export interface SproutExtension<E extends Effect = Effect> {
  /** What `use <name>` names. Lower-case identifier. */
  name: string;
  valueTypes?: readonly ValueType[];
  wellKnown?: readonly WellKnownProperty[];
  statements?: Readonly<Record<string, StatementSpec<E>>>;
  /** The wire shape of every effect this extension records — a host validates against it. */
  effect: z.ZodType<E>;
  /** A line for a client that prints text: "[a picture opens]". */
  transcript?(effect: E): string;
  /** A paragraph for the generated skill: what the extension adds, in the builder's terms. */
  skill?: string;
}

const NAME = /^[a-z][a-z0-9_]{0,31}$/;
export const SPROUT_BUILTIN_TYPES: ReadonlySet<string> = new Set([
  'boolean',
  'integer',
  'enum',
  'string',
]);

/**
 * The extensions a language instance was configured with, indexed for
 * the compiler, the printer, the engine and the skill. Built once by
 * `sprout({ extensions })` (or directly); the empty set is the language
 * as sprout.md §2 defines it minus pictures.
 */
export class ExtensionSet {
  readonly extensions: readonly SproutExtension[];
  private readonly byName = new Map<string, SproutExtension>();
  private readonly types = new Map<string, { ext: SproutExtension; type: ValueType }>();
  private readonly literals = new Map<string, { ext: SproutExtension; type: ValueType }>();
  private readonly statements = new Map<string, { ext: SproutExtension; spec: StatementSpec }>();

  constructor(extensions: readonly SproutExtension[] = []) {
    this.extensions = [...extensions];
    for (const ext of extensions) {
      if (!NAME.test(ext.name))
        throw new Error(`An extension needs a lower-case name: "${ext.name}".`);
      if (this.byName.has(ext.name)) throw new Error(`Two extensions are called "${ext.name}".`);
      this.byName.set(ext.name, ext);
      for (const type of ext.valueTypes ?? []) {
        if (SPROUT_BUILTIN_TYPES.has(type.name) || this.types.has(type.name)) {
          throw new Error(`"${ext.name}" redefines the value type "${type.name}".`);
        }
        if (this.literals.has(type.literal.keyword)) {
          throw new Error(`"${ext.name}" reuses the literal keyword "${type.literal.keyword}".`);
        }
        this.types.set(type.name, { ext, type });
        this.literals.set(type.literal.keyword, { ext, type });
      }
      for (const [keyword, spec] of Object.entries(ext.statements ?? {})) {
        if (!NAME.test(keyword))
          throw new Error(`"${ext.name}": "${keyword}" is not a statement name.`);
        if (this.statements.has(keyword)) {
          throw new Error(`Two extensions define a statement "${keyword}".`);
        }
        this.statements.set(keyword, { ext, spec });
      }
      for (const w of ext.wellKnown ?? []) {
        if (!SPROUT_BUILTIN_TYPES.has(w.type) && !this.types.has(w.type)) {
          throw new Error(
            `"${ext.name}": well-known ":${w.name}" has an unknown type "${w.type}".`,
          );
        }
      }
    }
  }

  get names(): string[] {
    return [...this.byName.keys()];
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  extension(name: string): SproutExtension | undefined {
    return this.byName.get(name);
  }

  /** A value type by its `type` tag, with the extension that owns it. */
  valueType(name: string): { ext: SproutExtension; type: ValueType } | undefined {
    return this.types.get(name);
  }

  /** A value type by the keyword that introduces its literal. */
  literal(keyword: string): { ext: SproutExtension; type: ValueType } | undefined {
    return this.literals.get(keyword);
  }

  statement(keyword: string): { ext: SproutExtension; spec: StatementSpec } | undefined {
    return this.statements.get(keyword);
  }

  /** The words one extension reserves: its statements and its literal keywords. */
  keywordsOf(name: string): string[] {
    const ext = this.byName.get(name);
    if (!ext) return [];
    return [
      ...Object.keys(ext.statements ?? {}),
      ...(ext.valueTypes ?? []).map((t) => t.literal.keyword),
    ];
  }

  /** The well-known properties every extension adds to a room or an item, in extension order. */
  wellKnownFor(role: 'room' | 'item'): WellKnownProperty[] {
    return this.extensions.flatMap((e) => (e.wellKnown ?? []).filter((w) => w.on.includes(role)));
  }

  /** The default transcript line for an effect, when its extension offers one. */
  transcript(effect: Effect): string | null {
    const ext = this.byName.get(effect.extension);
    if (!ext?.transcript) return null;
    const parsed = ext.effect.safeParse(effect);
    return parsed.success ? ext.transcript(parsed.data) : null;
  }

  /** Whether an effect is one of a configured extension's, in the shape it declared. */
  validEffect(effect: unknown): effect is Effect {
    if (!effect || typeof effect !== 'object') return false;
    const ext = this.byName.get(String((effect as Effect).extension));
    return ext ? ext.effect.safeParse(effect).success : false;
  }
}

export const NO_EXTENSIONS = new ExtensionSet([]);

/**
 * The extension conformance check (§3.5): what the language can verify
 * about an extension without trusting its flags. Every statement that
 * claims `inDescribe` is run against a frame whose every path reads and
 * whose objects are frozen, with the plainest arguments its spec allows;
 * it must not throw, and whatever it records must parse as the
 * extension's own `effect` shape. Every value type must fit its own
 * default and print it. Returns the problems; an extension's spec
 * asserts the list is empty.
 */
export function checkExtension(ext: SproutExtension): string[] {
  const problems: string[] = [];
  const ref = (id: string, kind: ObjectRef['kind']): ObjectRef =>
    Object.freeze({ id, kind, name: id });
  const room = ref('room', 'room');
  const self = ref('self', 'item');
  const actor = ref('actor', 'actor');
  const frame: ReadOnlyFrame = Object.freeze({
    self,
    room,
    container: room,
    actor,
    resolve: (name: string) => (name === 'self' ? self : name === 'room' ? room : null),
    get: (_ref: ObjectRef, property: string) => {
      const known = (ext.wellKnown ?? []).find((w) => w.name === property);
      return known ? known.default : null;
    },
    is: (r: ObjectRef, kindName: string) =>
      (kindName === 'Room' && r.kind === 'room') || (kindName === 'Actor' && r.kind === 'actor'),
  });
  for (const type of ext.valueTypes ?? []) {
    if (type.fit(type.default) === undefined) {
      problems.push(`"${type.name}" does not fit its own default.`);
    }
    if (!type.storage.safeParse(type.default).success) {
      problems.push(`"${type.name}"'s default is not in its storage shape.`);
    }
    if (typeof type.print(type.default) !== 'string') {
      problems.push(`"${type.name}" does not print its default.`);
    }
  }
  for (const [keyword, spec] of Object.entries(ext.statements ?? {})) {
    const args: Record<string, ObjectRef | SproutValue | null> = {};
    for (const a of spec.args) {
      if (a.optional) continue;
      args[a.name] =
        a.kind === 'target' ? self : a.kind === 'symbol' ? 'x' : a.kind === 'string' ? '' : null;
    }
    let effect: Effect | void;
    try {
      effect = spec.run(frame, Object.freeze(args));
    } catch (err) {
      problems.push(
        `"${keyword}" throws on a plain call: ${err instanceof Error ? err.message : String(err)}.`,
      );
      continue;
    }
    if (effect !== undefined) {
      if (effect.extension !== ext.name) {
        problems.push(
          `"${keyword}" records an effect for "${effect.extension}", not "${ext.name}".`,
        );
      } else if (!ext.effect.safeParse(effect).success) {
        problems.push(`"${keyword}" records an effect that is not in the extension's own shape.`);
      }
    }
  }
  return problems;
}
