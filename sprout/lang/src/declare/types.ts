// The five value types, resolved (the spec's Properties › The types).
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
import { checkOption } from './enums.js';

/** An integer declared without `min`/`max` ranges over these, which is also the range of `elapsed`. */
export const INTEGER_MIN = -2_147_483_648;
export const INTEGER_MAX = 2_147_483_647;

/** A value's type, resolved. */
export type ValueType =
  | { readonly type: 'boolean' }
  | { readonly type: 'integer'; readonly min: number; readonly max: number }
  | { readonly type: 'string' }
  | { readonly type: 'symbol'; readonly of: DeclaredEnum }
  | { readonly type: 'list'; readonly element: ValueType };

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
    return { type: 'list', element };
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

/** Whether a literal is a value of this type, refusing at the literal when it is not. */
export function checkLiteral(
  expected: ValueType,
  literal: Literal,
  diagnostics: Diagnostics,
): boolean {
  switch (expected.type) {
    case 'boolean':
      return want(expected, literal, literal.kind === 'boolean', diagnostics);
    case 'string':
      return want(expected, literal, literal.kind === 'string', diagnostics);
    case 'integer': {
      if (!want(expected, literal, literal.kind === 'integer', diagnostics)) return false;
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
      if (!want(expected, literal, literal.kind === 'option-literal', diagnostics)) return false;
      const option = literal as { name: { text: string } };
      return checkOption(expected.of, option.name.text, literal.at, diagnostics);
    }
    case 'list': {
      if (!want(expected, literal, literal.kind === 'list-literal', diagnostics)) return false;
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
): boolean {
  if (matched) return true;
  diagnostics.refuse(
    literal.at,
    `This holds ${showType(expected)}, and ${describeLiteral(literal)} is not one.`,
    remedyFor(expected),
  );
  return false;
}

/** A literal as a person would describe it. */
export function describeLiteral(literal: Literal): string {
  switch (literal.kind) {
    case 'boolean':
      return `\`${literal.value}\``;
    case 'integer':
      return `the number ${literal.value}`;
    case 'string':
      return 'text in quotes';
    case 'option-literal':
      return `\`${literal.name.text}\``;
    case 'list-literal':
      return 'a list';
  }
}

function remedyFor(expected: ValueType): string {
  switch (expected.type) {
    case 'boolean':
      return 'Write `true` or `false`.';
    case 'integer':
      return `Write a whole number from ${expected.min} to ${expected.max}.`;
    case 'string':
      return 'Write text in quotes, as in `"a line"`.';
    case 'symbol':
      return `Write one of: ${expected.of.options.join(', ')}.`;
    case 'list':
      return `Write a list in brackets, as in \`[…]\`, holding ${showType(expected.element)}.`;
  }
}
