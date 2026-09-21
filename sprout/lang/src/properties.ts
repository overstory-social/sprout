// A property is a name, a type and a default (B06; the spec's
// Properties › Declaring a property, Per-actor memory).
//
// The type may be written or taken from the literal, so `:lit false` and
// `:lit boolean default false` are the same declaration. Every instance
// of the kind starts at the default, which is why a default is not
// optional: there is no null for it to be instead.
//
// An integer's `min`/`max` narrow the type rather than sitting beside
// it, so the default is checked against the declared range and not
// against the whole of the integer range. That is the check the issue
// calls "the default range", and it is the one a `:wear 0 min 5` gets
// wrong.
//
// Where a property is WRITTEN — inside a kind or an object — is B12's
// and B19's, as is what happens when two kinds declare the same one.

import type { PropertyDeclaration, RemembersDeclaration } from './ast.js';
import type { Diagnostics } from './diagnostics.js';
import type { EnumTable } from './enums.js';
import {
  checkLiteral,
  integer,
  resolveType,
  showType,
  typeOfLiteral,
  type SproutType,
} from './types.js';

/** A property with its type worked out: what a kind actually declares. */
export interface ResolvedProperty {
  readonly name: string;
  readonly type: SproutType;
  /** Whether it is held per actor rather than per object. */
  readonly remembered: boolean;
  readonly declaration: PropertyDeclaration;
}

/**
 * Work out what a property declares, or refuse it. Returns null when it
 * could not be resolved, having said why — the caller drops it rather
 * than carrying a property whose type nobody knows.
 */
export function resolveProperty(
  declared: PropertyDeclaration,
  enums: EnumTable,
  from: string,
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

  if (!checkLiteral(type, declared.default!, diagnostics)) return null;
  return { name: declared.name.text, type, remembered, declaration: declared };
}

/**
 * What an object remembers about each actor, typed by the same rules and
 * written in the same syntax. Only the object that declared them may
 * read or write them, and no object can read another object's memory of
 * anyone — that last part is B08's and B09's to enforce.
 */
export function resolveRemembers(
  declared: RemembersDeclaration,
  enums: EnumTable,
  from: string,
  diagnostics: Diagnostics,
): ResolvedProperty[] {
  const resolved: ResolvedProperty[] = [];
  const seen = new Set<string>();
  for (const property of declared.properties) {
    if (seen.has(property.name.text)) {
      diagnostics.refuse(
        property.name.at,
        `\`${property.name.text}\` is remembered twice.`,
        'A remembered property is declared once. Remove the second.',
      );
      continue;
    }
    seen.add(property.name.text);
    const one = resolveProperty(property, enums, from, diagnostics, true);
    if (one !== null) resolved.push(one);
  }
  return resolved;
}
