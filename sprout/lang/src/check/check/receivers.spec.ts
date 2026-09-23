// What a receiver is: a kind known or narrowed, `self` or not, an actor
// or not, and whether it holds things.

import { describe, expect, it } from 'vitest';

import { objectOf, OPEN_OBJECT, valueOf } from '../bindings.js';
import { ACTOR } from '../../declare/actors.js';
import { integer } from '../../declare/types.js';
import {
  at,
  bodyOf,
  call,
  expression,
  KEY,
  PRINTER,
  saidBy,
  VESSEL,
  vessel,
  word,
} from '../../fixtures/check.js';
import {
  container,
  countable,
  declaredOn,
  describe as describeReceiver,
  onlySelf,
  ownMemory,
  receiverKind,
  remembers,
} from './receivers.js';

const OPENS = valueOf(KEY.properties.get('opens')!.type);

describe('a receiver’s kind', () => {
  it('is known, or refused with what to do about it', () => {
    const context = vessel();
    expect(receiverKind(objectOf(KEY), at('tool'), 'read a property from', context)).toBe(KEY);
    expect(receiverKind(OPEN_OBJECT, at('tool'), 'read a property from', context)).toBeNull();
    expect(receiverKind(valueOf(integer()), at('tool'), 'write to', context)).toBeNull();
    expect(saidBy(context)).toEqual([
      'Sprout does not know what this is, so it cannot read a property from it. Narrow it first, as in `if (thing.is(Key)) { … }`.',
      'Only a thing in the world has properties, and this is integer. Name a binding that holds a thing in the world.',
    ]);
  });

  it('declares the property a call names, or suggests the nearest it has', () => {
    const context = vessel();
    expect(declaredOn(KEY, word(':wear'), context)).toBe(KEY.properties.get('wear'));
    expect(declaredOn(KEY, word(':waer'), context)).toBeNull();
    expect(saidBy(context)).toEqual([
      '`shop.Key` has no `:waer`. Did you mean `:wear`? It has `:wear` and `:opens`.',
    ]);
  });
});

describe('only `self` writes `self`, asked directly', () => {
  it('lets the writable binding through and refuses every other by name', () => {
    const context = vessel();
    const set = call('self.set(:inked, true)').method;
    expect(onlySelf(expression('self'), objectOf(VESSEL), set, context)).toBe(VESSEL);
    expect(onlySelf(expression('target'), OPEN_OBJECT, set, context)).toBeNull();
    expect(
      onlySelf(expression('self.get(:capacity)'), valueOf(integer()), set, context),
    ).toBeNull();
    expect(context.diagnostics.refusals.map((d) => d.message)).toEqual([
      'Only `self` writes its own state, and this is `target`.',
      'Only `self` writes its own state, and this is integer.',
    ]);
  });

  it('names a receiver by its binding, and `self` or no binding by its type', () => {
    const context = vessel();
    expect(describeReceiver(context.scope.lookup('target'), OPEN_OBJECT)).toBe('`target`');
    expect(describeReceiver(context.scope.lookup('self'), objectOf(VESSEL))).toBe('shop.Vessel');
    expect(describeReceiver(null, valueOf(integer()))).toBe('integer');
  });
});

describe('memory, asked directly', () => {
  it('is asked only of an actor', () => {
    const context = bodyOf(PRINTER);
    expect(remembers(objectOf(PRINTER), at('actor'), context)).toBe(true);
    expect(remembers(objectOf(KEY), at('tool'), context)).toBe(false);
    expect(remembers(OPEN_OBJECT, at('here'), context)).toBe(false);
    expect(remembers(valueOf(integer()), at('n'), context)).toBe(false);
    const said = saidBy(context);
    expect(said[0]).toContain('`shop.Key` is not someone a thing is remembered about.');
    expect(said[0]).toContain(ACTOR);
    expect(said[1]).toContain('Narrow it first');
    expect(said[2]).toContain('Only an actor is remembered about, and this is integer.');
  });

  it('is `self`’s own, and says which word reads a property it holds', () => {
    const printer = bodyOf(PRINTER);
    expect(ownMemory(word(':visits'), printer)).toBe(PRINTER.properties.get('visits'));
    expect(ownMemory(word(':capacity'), printer)).toBeNull();
    expect(saidBy(printer).join(' ')).toContain('This remembers nothing called `:capacity`.');

    const vessel = bodyOf(VESSEL);
    expect(ownMemory(word(':capacity'), vessel)).toBeNull();
    expect(saidBy(vessel)).toEqual([
      '`:capacity` is held by the object, not remembered about each actor. Read it with `get`, as in `self.get(:capacity)`.',
    ]);
  });
});

describe('what a receiver holds, asked directly', () => {
  it('counts a container, a set role and a list', () => {
    const context = vessel();
    expect(countable(context.scope.lookup('tools')!.type, at('tools'), context)).toBe(true);
    expect(countable(OPENS, at('tool'), context)).toBe(true);
    expect(countable(objectOf(VESSEL), at('self'), context)).toBe(true);
    expect(countable(objectOf(KEY), at('tool'), context)).toBe(false);
    expect(saidBy(context)).toEqual([
      '`shop.Key` holds nothing, so there is nothing to count. Containment is a declaration: a kind that holds things writes `contains`.',
    ]);
  });

  it('holds things only where a kind declares `contains`', () => {
    const context = vessel();
    expect(container(objectOf(VESSEL), at('self'), context)).toBe(true);
    expect(container(OPEN_OBJECT, at('here'), context)).toBe(false);
    expect(container(OPENS, at('tool'), context)).toBe(false);
    expect(saidBy(context)).toEqual([
      'Sprout does not know whether this holds anything. Narrow it first, as in `if (thing.is(sprout.Container)) { … }`.',
      'Only a thing that holds things can be counted, and this is [Ward]. Ask it of a container, or of a role marked `many`.',
    ]);
  });
});
