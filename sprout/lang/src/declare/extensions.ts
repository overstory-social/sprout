// What an extension is, as a host installs it, and what a world pins of
// the ones installed (the spec's Extensions; The compiler › What absent
// means).
//
// An extension is host-trusted TypeScript that adds value types, the
// statements that use them, and the effects those statements record. It
// never performs anything: a statement's `run` is handed a frozen,
// read-only view of its frame and returns a payload the turn appends to
// what it says. A world names the extensions it uses by major version;
// one the host does not supply at that major is absent, and its
// statements record nothing and its types hold their defaults.

import type { SourceFile } from '../source/source.js';

/** A value an extension reads, holds and records: JSON's shapes, frozen. */
export type Plain =
  null | boolean | number | string | readonly Plain[] | { readonly [key: string]: Plain };

/** What an extension says is wrong with what an author wrote, in an author's words. */
export interface ExtensionProblem {
  readonly problem: string;
  /** What to write instead. */
  readonly remedy: string;
}

/**
 * A value type: how it is written as a literal (text in quotes, which it
 * reads), how it persists and is restored, how it prints, and whether it
 * compares and renders. `compares` and `renders` are each a function or
 * `false`, so the compiler always knows whether `==` and a `{slot}` are
 * legal for it.
 */
export interface ExtensionValueType {
  /** Its name, capitalised as an enum's is: `Image`, written `media.Image`. */
  readonly name: string;
  /** The value text in quotes writes, or why it is not one. */
  read(text: string): { readonly value: Plain } | ExtensionProblem;
  /** The value as stored state holds it. */
  persist(value: Plain): string;
  /** A stored value read back; null where it is no longer one of this type's, and the default stands. */
  restore(stored: string): Plain | null;
  /** The value as a moderator or a diagnostic reads it. */
  print(value: Plain): string;
  /** Whether two values are the same, or `false` where `==` is refused on the type. */
  readonly compares: ((a: Plain, b: Plain) => boolean) | false;
  /** The words a slot renders the value as, or `false` where a slot of it is refused. */
  readonly renders: ((value: Plain) => string) | false;
}

/** What one argument of a statement is: a value of the language's, or one of the extension's own types by name. */
export type ExtensionParameterType = 'boolean' | 'integer' | 'string' | { readonly type: string };

export interface ExtensionParameter {
  readonly name: string;
  readonly type: ExtensionParameterType;
}

/** A schema a host validates a recorded payload against: a zod schema is one. */
export interface EffectSchema {
  safeParse(payload: unknown): { readonly success: boolean };
}

/** What a statement's `run` is handed: its arguments and who ran it, frozen. */
export interface ExtensionFrame {
  readonly arguments: readonly Plain[];
  /** The object whose body ran it, by id. */
  readonly self: string;
  /** The turn's actor, by id, or null where there is none. */
  readonly actor: string | null;
}

/**
 * A statement, written `media.show(…)`: its arguments, a compile-time
 * check over the ones written as literals, whether it may stand in a
 * `describe`, the shape of the effect it records, and the transcript
 * line a text-only client shows instead of that effect.
 */
export interface ExtensionStatementDefinition {
  /** Its name, lower-case: `show`. */
  readonly name: string;
  readonly parameters: readonly ExtensionParameter[];
  /** Whether it may stand in a `describe`, where it records into the view. None may stand in a guard or a `permit`. */
  readonly describe: boolean;
  /** Each literal argument's value, `undefined` where one is not a literal; a problem refuses the statement. */
  check?(literals: readonly (Plain | undefined)[]): ExtensionProblem | null;
  /** The effect's payload, from a frozen view of the frame. */
  run(frame: ExtensionFrame): Plain;
  readonly effect: EffectSchema;
  /** The words a text-only client shows instead of the effect: never empty. */
  transcript(payload: Plain): string;
}

/** An extension as a host installs it. */
export interface Extension {
  /** One flat, host-curated namespace: `media`. */
  readonly name: string;
  readonly major: number;
  readonly types: readonly ExtensionValueType[];
  readonly statements: readonly ExtensionStatementDefinition[];
  /** A paragraph for the generated skill, in a builder's terms. */
  readonly skill: string;
}

/** Why a pinned extension is absent: the host has none of that name, or none at that major. */
export type ExtensionAbsence = 'not-installed' | 'other-major';

/** One extension a world pins, and what the host supplies for it. */
export interface PinnedExtension {
  readonly name: string;
  readonly major: number;
  /** The host's, at the pinned major; null where it is absent. */
  readonly installed: Extension | null;
  /** Why it is absent; null where it is installed. */
  readonly absence: ExtensionAbsence | null;
}

/** The extensions a bundle pins, and which each of its source files names at its top. */
export interface PinnedExtensions {
  readonly pinned: ReadonlyMap<string, PinnedExtension>;
  readonly named: ReadonlyMap<SourceFile, ReadonlySet<string>>;
}

/** A bundle that pins none. */
export const NO_EXTENSIONS: PinnedExtensions = { pinned: new Map(), named: new Map() };

/** Each pin, against what the host installed: the one of its name at its major, or absent. */
export function pinExtensions(
  pins: readonly { readonly name: string; readonly major: number }[],
  installed: readonly Extension[],
): Map<string, PinnedExtension> {
  const pinned = new Map<string, PinnedExtension>();
  for (const { name, major } of pins) {
    const named = installed.filter((extension) => extension.name === name);
    const at = named.find((extension) => extension.major === major) ?? null;
    const absence = at !== null ? null : named.length === 0 ? 'not-installed' : 'other-major';
    pinned.set(name, { name, major, installed: at, absence });
  }
  return pinned;
}

/** Whether `file` names `extension` at its top. */
export function namesExtension(
  extensions: PinnedExtensions,
  file: SourceFile,
  extension: string,
): boolean {
  return extensions.named.get(file)?.has(extension) ?? false;
}

/**
 * A frozen copy of `value` where it is plain, JSON's shapes with finite
 * numbers; undefined where anything in it is not, so nothing handed to
 * or taken from an extension can change after, or carry more than data.
 */
export function frozenPlain(value: unknown): Plain | undefined {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    const elements: Plain[] = [];
    for (const element of value) {
      const copy = frozenPlain(element);
      if (copy === undefined) return undefined;
      elements.push(copy);
    }
    return Object.freeze(elements);
  }
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    return undefined;
  }
  const fields: Record<string, Plain> = {};
  for (const [key, field] of Object.entries(value as Record<string, unknown>)) {
    const copy = frozenPlain(field);
    if (copy === undefined) return undefined;
    fields[key] = copy;
  }
  return Object.freeze(fields);
}

/**
 * What text in quotes is as a value of `type`: its reading, frozen, or
 * why it is not one. The extension's own code runs here, so a throw, or
 * a reading that is not plain, is said as its problem rather than thrown.
 */
export function readLiteral(
  extension: string,
  type: ExtensionValueType,
  text: string,
): { readonly value: Plain } | ExtensionProblem {
  let read: ReturnType<ExtensionValueType['read']>;
  try {
    read = type.read(text);
  } catch (thrown) {
    return {
      problem: `The extension \`${extension}\` failed reading this as \`${extension}.${type.name}\`: ${thrown instanceof Error ? thrown.message : String(thrown)}.`,
      remedy: `Tell whoever runs this host that \`${extension}\` failed; the fault is theirs to fix, not yours.`,
    };
  }
  if (!('value' in read)) return read;
  const value = frozenPlain(read.value);
  if (value !== undefined) return { value };
  return {
    problem: `The extension \`${extension}\` read this as something that is not a value.`,
    remedy: `Tell whoever runs this host that \`${extension}\` failed; the fault is theirs to fix, not yours.`,
  };
}

/** The statement `extension` declares by `name`, where it is installed and declares one. */
export function extensionStatement(
  extension: PinnedExtension,
  name: string,
): ExtensionStatementDefinition | null {
  return extension.installed?.statements.find((statement) => statement.name === name) ?? null;
}
