import { describe, expect, it } from 'vitest';

import { compileWorld } from '../fixtures/bundle.js';
import { locationOf } from '../source/source.js';

/** What compiling a world whose own file ends in `intents` refused, as `line:col message`. */
function refused(intents: string): string[] {
  return compileWorld('shop', {
    'shop.sprout': `world shop is sprout.World {
  visitors are Person
  visitors arrive at hall
  object hall is sprout.Place
}
${intents}`,
    'person.sprout': 'kind Person is sprout.Visitor { }\n',
  }).diagnostics.flatMap((d) =>
    d.severity === 'refusal'
      ? [`${locationOf(d.at).slice('shop.sprout:'.length)} ${d.message}`]
      : [],
  );
}

describe('a step’s `when`', () => {
  it('reads each slot as what fills the role the step gives it, and `actor` and `here`', () => {
    expect(
      refused(
        'intent a { "a [y] with [x]"  do unlock (target: y, tool: x) when (y.get(:locked) && actor != y && here != y) }\n',
      ),
    ).toEqual([]);
  });

  it('refuses a property the kind of a slot’s role lacks', () => {
    expect(refused('intent a { "a [y]"  do open (target: y) when (y.get(:locked)) }\n')).toEqual([
      '6:53 `sprout.Container` has no `:locked`.',
    ]);
  });

  it('refuses a condition that is not true or false', () => {
    expect(refused('intent a { "a [y]"  do open (target: y) when (y.get(:capacity)) }\n')).toEqual([
      "6:47 A step's `when` says whether it runs, so it is true or false, and this is integer.",
    ]);
  });

  it('refuses a draw, since it is read before the line runs', () => {
    expect(refused('intent a { "a [y]"  do open (target: y) when (chance(2)) }\n')).toEqual([
      "6:47 An intent's `when` may not use `chance`: it is read before the line runs, to decide which steps run, so a roll would decide unseen.",
    ]);
  });
});
