// A property is a name, a type and a default (the spec's Properties ›
// Declaring a property, Per-actor memory).
//
// The type may be written or taken from the literal, so `:lit false` and
// `:lit boolean default false` are the same declaration. Every instance
// of the kind starts at the default, which is why a default is not
// optional: there is no null for it to be instead.
//
// An integer's `min`/`max` narrow the type rather than sitting beside
// it, so the default is checked against the declared range and not
// against the whole of the integer range: `:wear 0 min 5` is refused.
//
// A property's ORIGIN is the kind that declared it, and it is what
// composition merges on (`compose.ts`): one origin reached twice is one
// property, two origins are refused until the composer restates it. A
// restatement keeps the type it restates, so there `:ward iron` is
// enough, and the restating kind becomes the origin, superseding the one
// it restated wherever both reach one composer.

import type { Literal, PropertyDeclaration, RemembersDeclaration } from '../syntax/ast.js';
import { Diagnostics } from '../source/diagnostics.js';
import { shownName, type EnumTable } from './enums.js';
import {
  checkLiteral,
  identicalType,
  integer,
  resolveType,
  showType,
  typeOfLiteral,
  type ValueType,
} from './types.js';

/** A property with its type worked out: what a kind actually declares. */
export interface ResolvedProperty {
  readonly name: string;
  readonly type: ValueType;
  /** Whether it is held per actor rather than per object. */
  readonly remembered: boolean;
  /**
   * The kind that declared it, or last restated it, by qualified name:
   * `sprout.Container`. An object's own body is its anonymous kind,
   * named for the object; a world's is named for the world.
   */
  readonly origin: string;
  readonly declaration: PropertyDeclaration;
}

/**
 * Work out what a property declares, refusing what is wrong in it. Null
 * only when its type could not be resolved, having said why; a refused
 * default keeps the property, so its uses are checked against its type
 * and the one mistake is said once, at the default.
 */
export function resolveProperty(
  declared: PropertyDeclaration,
  enums: EnumTable,
  from: string,
  origin: string,
  diagnostics: Diagnostics,
  remembered = false,
): ResolvedProperty | null {
  const written = declared.type;
  let type =
    written === null
      ? typeOfLiteral(declared.default!, diagnostics)
      : resolveType(written, enums, from, diagnostics);
  if (type === null) return null;

  if (declared.min !== null || declared.max !== null) {
    if (type.type !== 'integer') {
      diagnostics.refuse(
        (declared.min ?? declared.max)!.at,
        `\`:${declared.name.text}\` holds ${showType(type)}, which has no range.`,
        'Only an integer takes a `min` and a `max`.',
      );
      return null;
    }
    const min = declared.min?.value ?? type.min;
    const max = declared.max?.value ?? type.max;
    if (min > max) {
      diagnostics.refuse(
        (declared.max ?? declared.min)!.at,
        `\`:${declared.name.text}\` has a min of ${min} and a max of ${max}.`,
        'A min is never above its max.',
      );
      return null;
    }
    type = integer(min, max);
  }

  checkLiteral(type, declared.default!, diagnostics, `\`:${declared.name.text}\` holds`);
  return { name: declared.name.text, type, remembered, origin, declaration: declared };
}

/**
 * What an object remembers about each actor, typed by the same rules and
 * written in the same syntax. Only the object that declared them may
 * read or write them, and no object can read another object's memory of
 * anyone — that last part is `check/`'s to enforce.
 */
export function resolveRemembers(
  declared: RemembersDeclaration,
  enums: EnumTable,
  from: string,
  origin: string,
  diagnostics: Diagnostics,
): ResolvedProperty[] {
  const resolved: ResolvedProperty[] = [];
  const seen = new Set<string>();
  for (const property of declared.properties) {
    if (seen.has(property.name.text)) {
      diagnostics.refuse(
        property.name.at,
        `\`:${property.name.text}\` is remembered twice.`,
        'A remembered property is declared once. Remove the second.',
      );
      continue;
    }
    seen.add(property.name.text);
    const one = resolveProperty(property, enums, from, origin, diagnostics, true);
    if (one !== null) resolved.push(one);
  }
  return resolved;
}

/**
 * A composed property restated in a composer's body, which changes its
 * default and keeps its type: with no type written the default is
 * checked against the composed type, so `:ward iron` is enough; a type
 * or a range written must be the composed one exactly, and remembered
 * stays remembered. The composer is `origin`. Null having said why.
 */
export function restateProperty(
  composed: ResolvedProperty,
  declared: PropertyDeclaration,
  remembered: boolean,
  enums: EnumTable,
  from: string,
  origin: string,
  diagnostics: Diagnostics,
): ResolvedProperty | null {
  const name = declared.name.text;
  const where = shownName(composed.origin, from);
  if (remembered !== composed.remembered) {
    diagnostics.refuse(
      declared.name.at,
      composed.remembered
        ? `\`:${name}\` is remembered about each actor in \`${where}\`, and whatever composes it keeps that.`
        : `\`:${name}\` is not remembered in \`${where}\`, and whatever composes it keeps that.`,
      `Restate it as it is declared there: ${restatementOf(composed, declared.default)}.`,
    );
    return null;
  }

  const wrote = declared.type ?? declared.min ?? declared.max;
  if (wrote !== null) {
    const written = resolveProperty(declared, enums, from, origin, diagnostics, remembered);
    if (written === null) return null;
    if (!identicalType(written.type, composed.type)) {
      diagnostics.refuse(
        wrote.at,
        `\`:${name}\` holds ${showType(composed.type)} in \`${where}\`, and whatever composes it keeps that type.`,
        `Restate only its default, as in ${restatementOf(composed, declared.default)}; a property holding something else takes a name of its own.`,
      );
      return null;
    }
    return { ...written, type: composed.type };
  }

  if (!checkLiteral(composed.type, declared.default!, diagnostics, `\`:${name}\` holds`))
    return null;
  return { name, type: composed.type, remembered, origin, declaration: declared };
}

/**
 * How to restate a property, written out for a remedy: `:open true`, or
 * `remembers { :opened false }`. The default shown is `preferred` where it
 * is a value of the property's type, else the property's own where that
 * is, else a plain value of the type, since a remedy never quotes what the
 * compiler refuses.
 */
export function restatementOf(
  property: ResolvedProperty,
  preferred: Literal | null = null,
): string {
  const own = property.declaration.default!;
  const literal = [preferred, own].find(
    (one): one is Literal => one !== null && checkLiteral(property.type, one, new Diagnostics()),
  );
  const value =
    literal === undefined
      ? plainValueOf(property.type)
      : literal.at.source.text.slice(literal.at.start, literal.at.end);
  if (value === null) {
    return `\`:${property.name}\` with a default that is ${showType(property.type)}`;
  }
  return property.remembered
    ? `\`remembers { :${property.name} ${value} }\``
    : `\`:${property.name} ${value}\``;
}

/** A value of `type` as a default is written, or null where the type has no literal of its own. */
function plainValueOf(type: ValueType): string | null {
  switch (type.type) {
    case 'boolean':
      return 'false';
    case 'integer':
      return String(type.min <= 0 && type.max >= 0 ? 0 : type.min);
    case 'string':
      return '""';
    case 'symbol':
      return type.of.options[0] ?? null;
    case 'list':
      return '[]';
    case 'extension':
      return null;
  }
}
