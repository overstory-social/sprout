// A place's `lit`, checked against the whole bundle (the spec's Range ›
// Sight; The compiler › What it refuses).
//
// Only a place is lit or dark, since only a place holds the visitor who
// looks. The condition is read-only and pure, as an exit's `when` is:
// it is polled for whoever looks, so `actor` and `here` are not bound and
// nothing draws. It is the one body that may read `sees`.

import type { GrammarLit } from '../syntax/ast-grammar.js';
import type { Diagnostics } from '../source/diagnostics.js';
import type { KindLookup, KindRef } from '../declare/kinds.js';
import { Scope, selfBinding, showBindingType } from './bindings.js';
import { typeOf, type CheckContext } from './check.js';
import type { NameScope } from './names.js';

/** What a `lit` is checked against: the kinds, where its names resolve, and somewhere to say what is wrong. */
export interface LitSetting {
  readonly kinds: KindLookup;
  readonly diagnostics: Diagnostics;
  readonly names: NameScope;
}

/** Check the `lit` `self` wrote: `self` is a place, and the condition a boolean. Returns whether nothing was refused. */
export function checkLit(lit: GrammarLit, self: KindRef, setting: LitSetting): boolean {
  const { diagnostics } = setting;
  if (!self.containsActors) {
    diagnostics.refuse(
      lit.at,
      `\`${self.name}\` is not a place, so nobody stands in it to see by its light.`,
      'Write `lit` on a place: something that composes `sprout.Place` or writes `contains actors`.',
    );
    return false;
  }
  const { condition } = lit;
  const scope = Scope.root();
  scope.introduce(selfBinding(self, condition.at), diagnostics);
  for (const name of ['actor', 'here']) {
    const words = {
      message: `\`${name}\` is not bound in a place's \`lit\`: it is asked of the place, whoever looks.`,
      remedy:
        'Read the place through `self`, as in `lit (self.sees(sprout.LightSource, :lit))`, or a thing by its name.',
    };
    scope.withhold(
      { name, at: condition.at, unread: words, bound: { bindable: false, words } },
      diagnostics,
    );
  }
  const context: CheckContext = {
    scope,
    kinds: setting.kinds,
    from: self.library,
    self,
    diagnostics,
    names: setting.names,
    undrawn: { by: 'lit' },
    sight: true,
  };
  const type = typeOf(condition, context);
  if (type === null) return false;
  if (type.binds !== 'value' || type.type.type !== 'boolean') {
    diagnostics.refuse(
      condition.at,
      `A place's \`lit\` says whether it can be seen, so it is true or false, and this is ${showBindingType(type)}.`,
      'Write a condition, as in `lit (self.sees(sprout.LightSource, :lit))`.',
    );
    return false;
  }
  return true;
}
