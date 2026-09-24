// What a property holds while the world runs (the spec's Properties,
// types and values › The types, Lists).
//
// A value is a boolean, an integer, a string, an option, a list or a
// value of an extension's type (`extension-values.ts`), and never an
// object: there is no object-valued property, so nothing a value holds
// can dangle. An option is its bare name, `oak`, because the
// enum it belongs to is always known from the type it is held under.
// Whether a value fits a type is the one question stored state asks of
// it (the spec's The runtime › State): a value that no longer fits is
// dropped and the declared default stands.

import type { Literal } from '../syntax/ast.js';
import type { StaticCaps } from '../bundle/limits.js';
import type { ResolvedProperty } from '../declare/properties.js';
import { qualifiedName } from '../declare/enums.js';
import { sameType, showType, type ValueType } from '../declare/types.js';
import { SproutList } from './lists.js';
import { ExtensionValue, extensionLiteral } from './extension-values.js';

/** A run-time value: what a property holds, what a list holds. An option is its bare name, as lists already hold it. */
export type Value = boolean | number | string | SproutList | ExtensionValue;

/**
 * A type's identity as stored state records it: `boolean`, `integer`,
 * `string`, an enum's qualified name, a list's element key in brackets,
 * or an extension's type as written, `media.Image`. An integer's range is not part of it, as it is not part of
 * a type's identity.
 */
export function typeKey(type: ValueType): string {
  switch (type.type) {
    case 'boolean':
    case 'integer':
    case 'string':
      return type.type;
    case 'symbol':
      return qualifiedName(type.of.library, type.of.name);
    case 'list':
      return `[${typeKey(type.element)}]`;
    case 'extension':
      return showType(type);
  }
}

/**
 * Whether a value is one of this type's: an integer within its range, an
 * option of its enum, a list of its element type within the host's cap
 * whose every element fits.
 */
export function fits(type: ValueType, value: Value, caps: StaticCaps): boolean {
  switch (type.type) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'string':
      return typeof value === 'string';
    case 'integer':
      return (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= type.min &&
        value <= type.max
      );
    case 'symbol':
      return typeof value === 'string' && type.of.options.includes(value);
    case 'list':
      return (
        value instanceof SproutList &&
        sameType(value.holds, type.element) &&
        value.count <= caps.listElements &&
        value.elements.every((element) => fits(type.element, element, caps))
      );
    case 'extension':
      return value instanceof ExtensionValue && sameType(value.type, type);
  }
}

/** The value a literal writes, under the type it was checked against. */
export function valueOfLiteral(type: ValueType, literal: Literal, caps: StaticCaps): Value {
  const value = literalValue(type, literal, caps);
  if (!fits(type, value, caps)) {
    throw new Error(`a literal that is not a value of ${showType(type)} reached the runtime.`);
  }
  return value;
}

function literalValue(type: ValueType, literal: Literal, caps: StaticCaps): Value {
  switch (literal.kind) {
    case 'boolean':
    case 'integer':
      return literal.value;
    case 'string':
      return type.type === 'extension' ? extensionLiteral(type, literal.value) : literal.value;
    case 'option-literal':
      return literal.name.text;
    case 'list-literal': {
      if (type.type !== 'list') {
        throw new Error(`a list literal reached the runtime as ${showType(type)}.`);
      }
      const elements = literal.elements.map((element) =>
        valueOfLiteral(type.element, element, caps),
      );
      return SproutList.of(type.element, elements, caps);
    }
  }
}

/** What every instance starts at: the declaration's default, which the declare tier has checked. */
export function defaultOf(property: ResolvedProperty, caps: StaticCaps): Value {
  const written = property.declaration.default;
  if (written === null)
    throw new Error(`\`:${property.name}\` reached the runtime with no default.`);
  return valueOfLiteral(property.type, written, caps);
}
