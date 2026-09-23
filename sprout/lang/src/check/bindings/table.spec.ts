// Where types come from — the spec's table, row by row: every engine
// binding's constructor gives the type and origin the table names, every
// binding points at real text, and only `self` is ever written through.

import { describe, expect, it } from 'vitest';

import {
  actorBinding,
  elapsedBinding,
  forElementBinding,
  handlerParameters,
  hereBinding,
  letBinding,
  loopBinding,
  guardParameterBinding,
  moverBinding,
  objectOf,
  OPEN_OBJECT,
  roleBinding,
  selfBinding,
  setMemberBinding,
  setOf,
  setRoleBinding,
  showBindingType,
  valueOf,
  wasBinding,
  type Binding,
} from '../bindings.js';
import { Diagnostics } from '../../source/diagnostics.js';
import { BOOLEAN, integer, STRING } from '../../declare/types.js';
import {
  at,
  FILE,
  fromProperty,
  KNOWS,
  LOCKABLE,
  message,
  NOTE,
  parameters,
  SEALED,
  trying,
  VESSEL,
  VISITOR,
  WEAR,
} from '../../fixtures/bindings.js';

describe('where types come from — the table, row by row', () => {
  it('`self` — the composed kind', () => {
    const self = selfBinding(VESSEL, at('self'));
    expect(self.type).toEqual(objectOf(VESSEL));
    expect(self.origin).toBe('self');
  });

  it('`actor` — the world’s visitor kind', () => {
    expect(actorBinding(VISITOR, at('actor')).type).toEqual(objectOf(VISITOR));
  });

  it('`here` — object; the actor’s place', () => {
    expect(hereBinding(at('here')).type).toEqual(OPEN_OBJECT);
  });

  it('`mover`, in a guard — object; whatever proposed the move', () => {
    expect(moverBinding(at('mover')).type).toEqual(OPEN_OBJECT);
  });

  it('a guard’s `to`, `item` or `from` — object, under the name the guard gives it', () => {
    const item = guardParameterBinding('thing', at('item'));
    expect(item.name).toBe('thing');
    expect(item.type).toEqual(OPEN_OBJECT);
    expect(item.origin).toBe('parameter');
    expect(item.writable).toBe(false);
  });

  it('a role — the kind the verb declares', () => {
    const { made, said } = trying((d) =>
      roleBinding('target', { fills: 'kind', kind: LOCKABLE }, null, at('target'), d),
    );
    expect(said).toEqual([]);
    expect(made!.type).toEqual(objectOf(LOCKABLE));
  });

  it('a role — object where the verb declares none', () => {
    const { made } = trying((d) => roleBinding('tools', { fills: 'open' }, null, at('tools'), d));
    expect(made!.type).toEqual(OPEN_OBJECT);
  });

  it('a set role — as above, as a set', () => {
    expect(setRoleBinding('tools', LOCKABLE, at('tools')).type).toEqual(setOf(LOCKABLE));
    expect(setRoleBinding('tools', null, at('tools')).type).toEqual(setOf(null));
  });

  it('a role narrowed by `from` — the element type of the property named', () => {
    const { made, said } = trying((d) =>
      roleBinding('topic', { fills: 'symbol' }, fromProperty(KNOWS), at('topic'), d),
    );
    expect(said).toEqual([]);
    expect(showBindingType(made!.type)).toBe('Topic');
  });

  it('an `each` variable — its kind filter, or object without one', () => {
    expect(loopBinding('pot', VESSEL, at('pot')).type).toEqual(objectOf(VESSEL));
    expect(loopBinding('thing', null, at('thing')).type).toEqual(OPEN_OBJECT);
    expect(loopBinding('pot', VESSEL, at('pot')).origin).toBe('each');
  });

  it('a `{for}` variable — the same, and the element type over a list', () => {
    expect(loopBinding('thing', VESSEL, at('thing'), true).origin).toBe('for');
    expect(loopBinding('thing', VESSEL, at('thing'), true).type).toEqual(objectOf(VESSEL));
    const element = forElementBinding('topic', integer(1, 12), at('topic'));
    expect(element.type).toEqual(valueOf(integer(1, 12)));
    expect(element.origin).toBe('for');
  });

  it('`each … of` a set role — each member, at the role’s kind', () => {
    expect(setMemberBinding('pot', VESSEL, at('pot')).type).toEqual(objectOf(VESSEL));
    expect(setMemberBinding('thing', null, at('thing')).type).toEqual(OPEN_OBJECT);
  });

  it('calls a set role’s member what the author called it, in a body or in a passage', () => {
    expect(setMemberBinding('pot', VESSEL, at('pot')).origin).toBe('each');
    expect(setMemberBinding('pot', VESSEL, at('pot'), true).origin).toBe('for');
    // The same two forms a container has, and the same flag, so the two
    // constructors cannot drift apart.
    expect(loopBinding('thing', null, at('thing')).origin).toBe('each');
    expect(loopBinding('thing', null, at('thing'), true).origin).toBe('for');
  });

  it('a `let` binding — the expression it names, exactly', () => {
    expect(letBinding('n', valueOf(integer(0, 99)), at('n')).type).toEqual(valueOf(integer(0, 99)));
    expect(letBinding('pot', objectOf(VESSEL), at('pot')).type).toEqual(objectOf(VESSEL));
  });

  it('a handler’s sender — object', () => {
    const made = handlerParameters(
      message('gust'),
      parameters('from'),
      at('from'),
      new Diagnostics(),
    );
    expect(made).toHaveLength(1);
    expect(made[0]!.type).toEqual(OPEN_OBJECT);
  });

  it('a handler’s value — the message’s declaration', () => {
    const made = handlerParameters(
      message('illuminating'),
      parameters('from', 'value'),
      at('value'),
      new Diagnostics(),
    );
    expect(made.map((b) => showBindingType(b.type))).toEqual(['an object', 'boolean']);
  });

  it('a hook’s previous value — the property that changed', () => {
    const { made, said } = trying(() => wasBinding('was', SEALED, at('was')));
    expect(said).toEqual([]);
    expect(made!.type).toEqual(valueOf(BOOLEAN));
    expect(wasBinding('was', WEAR, at('was')).type).toEqual(valueOf(integer(0, 99)));
    expect(wasBinding('was', NOTE, at('was')).type).toEqual(valueOf(STRING));
  });

  it('`elapsed` — integer', () => {
    expect(elapsedBinding('elapsed', at('elapsed')).type).toEqual(valueOf(integer()));
  });

  it('points every binding at something, so a diagnostic about one has a place', () => {
    const every: Binding[] = [
      selfBinding(VESSEL, at('self')),
      actorBinding(VISITOR, at('actor')),
      hereBinding(at('here')),
      moverBinding(at('mover')),
      setRoleBinding('tools', null, at('tools')),
      loopBinding('pot', VESSEL, at('pot')),
      forElementBinding('topic', integer(), at('topic')),
      setMemberBinding('thing', null, at('thing')),
      letBinding('n', valueOf(BOOLEAN), at('n')),
      elapsedBinding('elapsed', at('elapsed')),
    ];
    for (const binding of every) {
      expect(binding.at.source, binding.name).toBe(FILE);
      expect(binding.at.end, binding.name).toBeGreaterThan(binding.at.start);
    }
  });
});

describe('only `self` writes `self`', () => {
  it('is the one binding written through', () => {
    expect(selfBinding(VESSEL, at('self')).writable).toBe(true);
  });

  it('and nothing else is', () => {
    const every: Binding[] = [
      actorBinding(VISITOR, at('actor')),
      hereBinding(at('here')),
      moverBinding(at('mover')),
      setRoleBinding('tools', VESSEL, at('tools')),
      loopBinding('pot', VESSEL, at('pot')),
      setMemberBinding('thing', null, at('thing')),
      letBinding('n', valueOf(BOOLEAN), at('n')),
      elapsedBinding('elapsed', at('elapsed')),
      wasBinding('was', SEALED, at('was')),
    ];
    for (const binding of every) expect(binding.writable, binding.name).toBe(false);
  });
});
