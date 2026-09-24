// What a binding can be: `showBindingType` for every arm a `BindingType`
// takes, `isObjectBinding` telling an object binding from a value one
// (the only distinction `is()` narrows on), and `describeOrigin` for
// every `BindingOrigin` there is. `check/bindings/*.spec.ts` holds the
// rest of `bindings.ts`'s own concerns — the table, value roles,
// handlers and hooks, and scope.

import { describe, expect, it } from 'vitest';

import {
  describeOrigin,
  elapsedBinding,
  hereBinding,
  isObjectBinding,
  objectOf,
  OPEN_OBJECT,
  selfBinding,
  setOf,
  setRoleBinding,
  showBindingType,
  valueOf,
  type BindingOrigin,
  type BindingType,
} from './bindings.js';
import { BOOLEAN, integer, STRING } from '../declare/types.js';
import { at, HERE_UNKNOWN, KNOWS, LOCKABLE, VESSEL } from '../fixtures/bindings.js';

describe('a binding type is not a property type', () => {
  it('says what it is, for every arm there is', () => {
    const every: [BindingType, string][] = [
      [valueOf(BOOLEAN), 'boolean'],
      [valueOf(integer(0, 99)), 'integer 0 to 99'],
      [valueOf(STRING), 'string'],
      [valueOf(KNOWS.type), '[Topic]'],
      [objectOf(VESSEL), 'printers_shop.Vessel'],
      [OPEN_OBJECT, 'an object'],
      [setOf(LOCKABLE), 'a set of sprout.Lockable'],
      [setOf(null), 'a set of objects'],
    ];
    for (const [type, said] of every) expect(showBindingType(type)).toBe(said);
  });

  it('knows an object binding from a value one, which is what `is()` narrows', () => {
    expect(isObjectBinding(hereBinding(HERE_UNKNOWN, at('here')))).toBe(true);
    expect(isObjectBinding(selfBinding(VESSEL, at('self')))).toBe(true);
    expect(isObjectBinding(elapsedBinding('elapsed', at('elapsed')))).toBe(false);
    expect(isObjectBinding(setRoleBinding('tools', null, at('tools')))).toBe(false);
  });

  it('describes every origin there is, so a refusal can name the first one', () => {
    const every: BindingOrigin[] = [
      'self',
      'actor',
      'here',
      'mover',
      'role',
      'each',
      'for',
      'let',
      'parameter',
    ];
    for (const origin of every) {
      expect(describeOrigin(origin), origin).not.toBe('');
      expect(describeOrigin(origin), origin).not.toContain('undefined');
    }
  });
});
