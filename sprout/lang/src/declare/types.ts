// The five value types, resolved (the spec's Properties › The types),
// and an extension's, which a world pins (Extensions › What an extension
// may add). An extension's type is written `media.Image`, its literal as
// text in quotes that the extension reads, and it is never a list's
// element; where the extension is absent it resolves with no definition.
//
// Every value in Sprout has a declared type, every binding's type is
// known where it is bound, and there is no null — so the compiler checks
// expressions exactly, never guesses at a receiver, and never reports a
// problem that might not be one.
//
// A TypeExpr is what an author wrote; a ValueType is what it means, with
// an enum's name resolved to the enum. They are kept apart because the
// same written name resolves differently from inside different
// libraries, and because a written type has a span and a resolved one
// does not.
//
// The discriminant here is `type` rather than `kind` on purpose: a
// resolved type is not an AST node, and giving it a `kind` would make
// `unspanned()` treat it as a node that forgot its span.

import type { Literal, TypeExpr } from '../syntax/ast.js';
import type { Diagnostics } from '../source/diagnostics.js';
import type { DeclaredEnum, EnumTable } from './enums.js';
import { checkOption, nearestOption } from './enums.js';
import {
  namesExtension,
  readLiteral,
  type Extension,
  type ExtensionParameter,
  type ExtensionValueType,
  type PinnedExtension,
  type PinnedExtensions,
} from './extensions.js';

/** An integer declared without `min`/`max` ranges over these, which is also the range of `elapsed`. */
export const INTEGER_MIN = -2_147_483_648;
export const INTEGER_MAX = 2_147_483_647;

/** A value's type, resolved. */
export type ValueType =
  | { readonly type: 'boolean' }
  | { readonly type: 'integer'; readonly min: number; readonly max: number }
  | { readonly type: 'string' }
  | { readonly type: 'symbol'; readonly of: DeclaredEnum }
  | { readonly type: 'list'; readonly element: ValueType }
  | ExtensionType;

/** A value type an extension adds: its extension, its name, and its definition, null where the extension is absent. */
export interface ExtensionType {
  readonly type: 'extension';
  readonly extension: string;
  readonly name: string;
  readonly definition: ExtensionValueType | null;
}

// Annotated with `satisfies` rather than `: ValueType` for the same
// reason `integer()` returns its own arm: a caller asking for boolean
// should get back boolean, not the whole union.
export const BOOLEAN = { type: 'boolean' } as const satisfies ValueType;
export const STRING = { type: 'string' } as const satisfies ValueType;

/**
 * The integer arm on its own. `integer()` returns this rather than a
 * bare `ValueType` so that a range survives being built: a caller
 * would otherwise have to widen and narrow again to get back what it
 * just asked for.
 */
export type IntegerType = Extract<ValueType, { readonly type: 'integer' }>;

/** An integer over a range, defaulting to the whole of it. */
export function integer(min = INTEGER_MIN, max = INTEGER_MAX): IntegerType {
  return { type: 'integer', min, max };
}

/** The names a type may be written by, which are not names an enum may take. */
export const BUILT_IN_TYPES = ['boolean', 'integer', 'string'] as const;

/** A type as a message names it. */
export function showType(value: ValueType): string {
  switch (value.type) {
    case 'boolean':
      return 'boolean';
    case 'integer':
      return value.min === INTEGER_MIN && value.max === INTEGER_MAX
        ? 'integer'
        : `integer ${value.min} to ${value.max}`;
    case 'string':
      return 'string';
    case 'symbol':
      return value.of.name;
    case 'list':
      return `[${showType(value.element)}]`;
    case 'extension':
      return `${value.extension}.${value.name}`;
  }
}

/**
 * Whether two types are the same one. An integer's range is not part of
 * its identity — a `0 to 99` and a `0 to 9` are both integers, and what
 * a range does is bound the values, not make a different type.
 */
export function sameType(a: ValueType, b: ValueType): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'symbol' && b.type === 'symbol') {
    return a.of.library === b.of.library && a.of.name === b.of.name;
  }
  if (a.type === 'list' && b.type === 'list') return sameType(a.element, b.element);
  if (a.type === 'extension' && b.type === 'extension') {
    return a.extension === b.extension && a.name === b.name;
  }
  return true;
}

/**
 * Whether two types are the same one AND bound the same values: an
 * integer's range counts here. This is what a restatement under
 * composition is held to, since it keeps the type it restates and a
 * narrower or wider range would change what the slot may hold.
 */
export function identicalType(a: ValueType, b: ValueType): boolean {
  if (!sameType(a, b)) return false;
  if (a.type === 'integer' && b.type === 'integer') return a.min === b.min && a.max === b.max;
  if (a.type === 'list' && b.type === 'list') return identicalType(a.element, b.element);
  return true;
}

/** What a written type means, read from inside the library `from`. */
export function resolveType(
  written: TypeExpr,
  enums: EnumTable,
  from: string,
  diagnostics: Diagnostics,
): ValueType | null {
  if (written.kind === 'list-type') {
    // A list's element type may itself be a list, `[[Ward]]`, so long
    // as every element is of that one type (the spec's Lists).
    const element = resolveType(written.element, enums, from, diagnostics);
    if (element === null) return null;
    if (element.type === 'extension') {
      diagnostics.refuse(
        written.at,
        `A list does not hold \`${showType(element)}\`, which is an extension's type.`,
        'Declare one property of it for each value the kind holds.',
      );
      return null;
    }
    return { type: 'list', element };
  }

  const extension =
    written.library === null ? undefined : enums.extensions.pinned.get(written.library.text);
  if (extension !== undefined) {
    return extensionType(written, extension, enums.extensions, diagnostics);
  }

  const name = written.name.text;
  if (written.library === null) {
    if (name === 'boolean') return BOOLEAN;
    if (name === 'integer') return integer();
    if (name === 'string') return STRING;
    if (name === 'object') {
      diagnostics.refuse(
        written.at,
        'The object type is never written.',
        'A property holds a boolean, an integer, a string, an option of an enum, or a list, as in `[Ward]` or `[[Ward]]`.',
      );
      return null;
    }
  }

  const declared =
    written.library === null
      ? enums.unqualified(name, from)
      : enums.qualified(written.library.text, name);
  if (declared !== null) return { type: 'symbol', of: declared };

  const full = written.library === null ? name : `${written.library.text}.${name}`;
  diagnostics.refuse(
    written.at,
    `\`${full}\` is not a type.`,
    `Write \`boolean\`, \`integer\`, \`string\`, the name of an enum, or \`[…]\` for a list of those — and a list may hold lists, as in \`[[Ward]]\`.`,
  );
  return null;
}

/**
 * `media.Image`: a type of an extension the world pins, which the file it
 * is written in must name at its top. Where the extension is absent the
 * type resolves with no definition, and holds its default.
 */
function extensionType(
  written: TypeExpr & { readonly kind: 'named-type' },
  extension: PinnedExtension,
  extensions: PinnedExtensions,
  diagnostics: Diagnostics,
): ExtensionType | null {
  const full = `${extension.name}.${written.name.text}`;
  if (!namesExtension(extensions, written.at.source, extension.name)) {
    diagnostics.refuse(
      written.at,
      `\`${full}\` is a type of the extension \`${extension.name}\`, which this file does not name.`,
      `Write \`extension ${extension.name} ${extension.major}\` at the top of the file.`,
    );
    return null;
  }
  const base = { type: 'extension', extension: extension.name, name: written.name.text } as const;
  if (extension.installed === null) return { ...base, definition: null };
  const definition = extension.installed.types.find((type) => type.name === written.name.text);
  if (definition !== undefined) return { ...base, definition };
  const types = extension.installed.types.map((type) => `\`${extension.name}.${type.name}\``);
  diagnostics.refuse(
    written.at,
    `The extension \`${extension.name}\` has no type \`${written.name.text}\`.`,
    types.length === 0 ? `\`${extension.name}\` adds no types.` : `Its types: ${types.join(', ')}.`,
  );
  return null;
}

/**
 * What one argument of an extension's statement is typed as: a value of
 * the language's, or one of `extension`'s own types. Null where it names
 * a type the extension does not add, which is the host's defect.
 */
export function parameterType(
  extension: Extension,
  parameter: ExtensionParameter,
): ValueType | null {
  const written = parameter.type;
  if (written === 'boolean') return BOOLEAN;
  if (written === 'integer') return integer();
  if (written === 'string') return STRING;
  const definition = extension.types.find((type) => type.name === written.type);
  if (definition === undefined) return null;
  return { type: 'extension', extension: extension.name, name: definition.name, definition };
}

/**
 * The type a literal gives a property that did not write one. A bare
 * option cannot say which enum it belongs to, so a symbol property
 * writes its enum; every other literal names its own type.
 */
export function typeOfLiteral(literal: Literal, diagnostics: Diagnostics): ValueType | null {
  switch (literal.kind) {
    case 'boolean':
      return BOOLEAN;
    case 'integer':
      return integer();
    case 'string':
      return STRING;
    case 'option-literal':
      diagnostics.refuse(
        literal.at,
        `\`${literal.name.text}\` does not say which enum it belongs to.`,
        `Write the enum with it, as in \`:state Drying.${literal.name.text}\` or \`:state Drying default ${literal.name.text}\`.`,
      );
      return null;
    case 'list-literal':
      diagnostics.refuse(
        literal.at,
        'A list does not say what it holds when it is empty of a written type.',
        'Write the element type, as in `:opens [Ward] default [oak]`.',
      );
      return null;
  }
}

/**
 * Whether a literal is a value of this type, refusing at the literal when
 * it is not; `holder` begins the refusal, as `` `:door` holds `` does.
 */
export function checkLiteral(
  expected: ValueType,
  literal: Literal,
  diagnostics: Diagnostics,
  holder = 'This holds',
): boolean {
  switch (expected.type) {
    case 'boolean':
      return want(expected, literal, literal.kind === 'boolean', diagnostics, holder);
    case 'string':
      return want(expected, literal, literal.kind === 'string', diagnostics, holder);
    case 'integer': {
      if (!want(expected, literal, literal.kind === 'integer', diagnostics, holder)) return false;
      const value = (literal as { value: number }).value;
      if (value < expected.min || value > expected.max) {
        diagnostics.refuse(
          literal.at,
          `${value} is outside ${expected.min} to ${expected.max}.`,
          `Write a whole number from ${expected.min} to ${expected.max}.`,
        );
        return false;
      }
      return true;
    }
    case 'symbol': {
      if (!want(expected, literal, literal.kind === 'option-literal', diagnostics, holder))
        return false;
      const option = literal as { name: { text: string } };
      return checkOption(expected.of, option.name.text, literal.at, diagnostics);
    }
    case 'list': {
      if (!want(expected, literal, literal.kind === 'list-literal', diagnostics, holder))
        return false;
      const list = literal as { elements: readonly Literal[] };
      let ok = true;
      const seen = new Set<string>();
      for (const element of list.elements) {
        if (!checkLiteral(expected.element, element, diagnostics)) {
          ok = false;
          continue;
        }
        const written = elementKey(element);
        if (seen.has(written)) {
          diagnostics.refuse(
            element.at,
            `This list holds ${written} twice.`,
            'A list holds no duplicates. Remove the second.',
          );
          ok = false;
          continue;
        }
        seen.add(written);
      }
      return ok;
    }
    case 'extension': {
      if (!want(expected, literal, literal.kind === 'string', diagnostics, holder)) return false;
      // An absent extension cannot read its literal, which is held as written.
      if (expected.definition === null) return true;
      const text = (literal as { value: string }).value;
      const read = readLiteral(expected.extension, expected.definition, text);
      if ('value' in read) return true;
      diagnostics.refuse(literal.at, read.problem, read.remedy);
      return false;
    }
  }
}

/** A literal as written, for saying that a list holds one twice. */
function elementKey(literal: Literal): string {
  switch (literal.kind) {
    case 'boolean':
      return String(literal.value);
    case 'integer':
      return String(literal.value);
    case 'string':
      return JSON.stringify(literal.value);
    case 'option-literal':
      return literal.name.text;
    case 'list-literal':
      return `[${literal.elements.map(elementKey).join(', ')}]`;
  }
}

/** Refuse a literal of the wrong shape, naming both what was wanted and what was written. */
function want(
  expected: ValueType,
  literal: Literal,
  matched: boolean,
  diagnostics: Diagnostics,
  holder: string,
): boolean {
  if (matched) return true;
  diagnostics.refuse(
    literal.at,
    `${holder} ${describeType(expected)}, and ${describeLiteral(literal)}.`,
    remedyFor(expected, literal.kind === 'string' ? literal.value : null, 'declared'),
  );
  return false;
}

/**
 * What a value of `type` is, as a sentence for an author says it: `true
 * or false`, `one of open, closed`, `a whole number from 0 to 9`.
 */
export function describeType(type: ValueType): string {
  switch (type.type) {
    case 'boolean':
      return 'true or false';
    case 'integer':
      return type.min === INTEGER_MIN && type.max === INTEGER_MAX
        ? 'a whole number'
        : `a whole number from ${type.min} to ${type.max}`;
    case 'string':
      return 'text';
    case 'symbol':
      return `one of ${type.of.options.join(', ')}`;
    case 'list':
      return `a list of ${showType(type.element)}`;
    case 'extension':
      return `\`${type.extension}.${type.name}\``;
  }
}

/** A literal as written, and what it is: `"closed" is text in quotes`, `4 is a number`. */
export function describeLiteral(literal: Literal): string {
  switch (literal.kind) {
    case 'boolean':
      return `\`${literal.value}\` is true or false`;
    case 'integer':
      return `${literal.value} is a number`;
    case 'string':
      return `${JSON.stringify(literal.value)} is text in quotes`;
    case 'option-literal':
      return `\`${literal.name.text}\` is an option`;
    case 'list-literal':
      return 'this is a list';
  }
}

/**
 * What to write instead of a value that is not `expected`: in a
 * declaration, where an option is written bare, or in an expression,
 * where it takes its colon. Text in quotes that names an option, or
 * nearly, is answered with that option.
 */
export function remedyFor(
  expected: ValueType,
  quoted: string | null,
  where: 'declared' | 'expression',
): string {
  switch (expected.type) {
    case 'boolean':
      return where === 'declared'
        ? 'Write `true` or `false`.'
        : 'Write `true` or `false`, or a condition, as in `self.get(:open)`.';
    case 'integer':
      return expected.min === INTEGER_MIN && expected.max === INTEGER_MAX
        ? 'Write a whole number, as in `1`.'
        : `Write a whole number from ${expected.min} to ${expected.max}.`;
    case 'string':
      return 'Write text in quotes, as in `"a line"`.';
    case 'symbol': {
      const { options } = expected.of;
      const meant =
        quoted === null ? null : options.includes(quoted) ? quoted : nearestOption(quoted, options);
      const colon = where === 'declared' ? '' : ':';
      if (meant !== null) return `Write \`${colon}${meant}\`, without quotes.`;
      return where === 'declared'
        ? `Write one of: ${options.join(', ')}.`
        : `Write an option, as in \`:${options[0] ?? 'option'}\`. Options: ${options.join(', ')}.`;
    }
    case 'list':
      return `Write a list in brackets, as in \`[…]\`, holding ${showType(expected.element)}.`;
    case 'extension':
      return `Write it as text in quotes, which the extension \`${expected.extension}\` reads.`;
  }
}
