// What a receiver is: a kind known or narrowed, `self` or not, an actor
// or not, and whether it holds things.

import { describe, expect, it } from 'vitest';

import { objectOf, OPEN_OBJECT, valueOf } from '../bindings.js';
import { ACTOR } from '../../declare/actors.js';
import type { Expr } from '../../syntax/ast.js';
import { integer } from '../../declare/types.js';
import {
  at,
  bodyOf,
  call,
  CONTAINER,
  expression,
  KEY,
  kind,
  PRINTER,
  property,
  saidBy,
  VESSEL,
  vessel,
  read,
  word,
} from '../../fixtures/check.js';
import { inKind, nameSource } from '../../fixtures/names.js';
import type { CheckContext } from './checker.js';
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
      '`Key` has no `:waer`. Did you mean `:wear`? It has `:wear` and `:opens`: name one of those, or declare `:waer` in `Key` with its default.',
    ]);
  });

  it('narrows a read to the world’s own kind that declares it, and only a read', () => {
    const context = vessel();
    // `Vessel` composes `sprout.Container` and declares `:inked`.
    expect(declaredOn(CONTAINER, word(':inked'), context, 'target')).toBeNull();
    // Nothing of the world's declares `:lid`, and a write names no receiver.
    expect(declaredOn(CONTAINER, word(':lid'), context, 'target')).toBeNull();
    expect(declaredOn(CONTAINER, word(':inked'), context)).toBeNull();
    // `Printer` remembers `:handled`, which `get` never reads.
    const actor = kind('Actor', [], [], true, 'sprout');
    expect(declaredOn(actor, word(':handled'), context, 'actor')).toBeNull();
    expect(saidBy(context)).toEqual([
      "`sprout.Container` has no `:inked`. `:inked` is a `Vessel`'s. Read it as one first: `if (target.is(Vessel)) { … target.get(:inked) … }`.",
      '`sprout.Container` has no `:lid`. It holds no properties.',
      '`sprout.Container` has no `:inked`. It holds no properties.',
      '`sprout.Actor` has no `:handled`. It holds no properties.',
    ]);
  });

  it('names every one of the world’s kinds that declares it, where no person’s kind does', () => {
    const base = vessel();
    const robot = kind('Robot', [property(':oil 0 min 0 max 9')], [ACTOR]);
    const golem = kind('Golem', [property(':oil 0 min 0 max 9')], [ACTOR]);
    const kinds = { ...base.kinds, all: () => [...base.kinds.all(), robot, golem] };
    const context = { ...base, kinds };
    const actor = kind('Actor', [], [], true, 'sprout');
    expect(declaredOn(actor, word(':oil'), context, 'actor')).toBeNull();
    expect(saidBy(context)).toEqual([
      "`sprout.Actor` has no `:oil`. `:oil` is a `Robot`'s or a `Golem`'s. Read it as one of them first: `if (actor.is(Robot)) { … actor.get(:oil) … }`.",
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
      '`Key` holds nothing, so there is nothing to count. Write `contains` in the body of `Key` to let it hold things, or count something that does.',
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

/**
 * A vessel's body written in `shop.Lantern`'s, where `lamp` is whatever is
 * called that nearest each lantern, with `lamp` read once so the name is
 * recorded as the checker records it.
 */
function inLantern(): { context: CheckContext; lamp: Expr } {
  const source = nameSource();
  const names = { source, vantage: inKind(source, 'shop.Lantern'), world: null, table: new Map() };
  const context: CheckContext = { ...vessel(), names };
  const { expr: lamp, said } = read('lamp', context);
  expect(said).toEqual([]);
  return { context, lamp };
}

const NARROW_LAMP =
  'Name it with `let` and narrow that, as in `let found = lamp` and then `if (found.is(Thing)) { … }`; a passage said inside the branch may read `found` too.';
const placedLamp = (doing: string) =>
  `\`lamp\` is whatever is called that nearest each instance, so Sprout does not know what it is, and cannot ${doing} it. ${NARROW_LAMP}`;

describe('a name in a kind’s body as the receiver, asked directly', () => {
  it('is refused with the `let` that narrows it, by every question of its kind', () => {
    const { context, lamp } = inLantern();
    expect(receiverKind(OPEN_OBJECT, lamp.at, 'read a property from', context, lamp)).toBeNull();
    expect(remembers(OPEN_OBJECT, lamp.at, context, lamp)).toBe(false);
    expect(container(OPEN_OBJECT, lamp.at, context, lamp)).toBe(false);
    expect(countable(OPEN_OBJECT, lamp.at, context, lamp)).toBe(false);
    expect(saidBy(context)).toEqual([
      placedLamp('read a property from'),
      placedLamp('ask about memory of'),
      placedLamp('count'),
      placedLamp('count'),
    ]);
  });

  it('has the generic words where the receiver is a binding, not a placed name', () => {
    const { context } = inLantern();
    const target = expression('target');
    expect(
      receiverKind(OPEN_OBJECT, at('target'), 'read a property from', context, target),
    ).toBeNull();
    expect(remembers(OPEN_OBJECT, at('target'), context, target)).toBe(false);
    expect(container(OPEN_OBJECT, at('target'), context, target)).toBe(false);
    expect(countable(OPEN_OBJECT, at('target'), context, target)).toBe(false);
    expect(saidBy(context)).toEqual([
      'Sprout does not know what this is, so it cannot read a property from it. Narrow it first, as in `if (thing.is(Key)) { … }`.',
      'Sprout does not know whether this is someone who can be remembered about. Narrow it first, as in `if (item.is(Creature)) { … }`.',
      'Sprout does not know whether this holds anything. Narrow it first, as in `if (thing.is(sprout.Container)) { … }`.',
      'Sprout does not know whether this holds anything. Narrow it first, as in `if (thing.is(sprout.Container)) { … }`.',
    ]);
  });

  it('leaves a binding’s own remedy to the binding, where it is not a placed name', () => {
    const { context } = inLantern();
    const here = expression('here');
    const unplaced = {
      binds: 'object',
      kind: null,
      remedy: 'Compose `sprout.Place` into `Room`.',
    } as const;
    expect(receiverKind(unplaced, at('here'), 'read a property from', context, here)).toBeNull();
    expect(container(unplaced, at('here'), context, here)).toBe(false);
    expect(saidBy(context)).toEqual([
      'Sprout does not know what this is, so it cannot read a property from it. Compose `sprout.Place` into `Room`.',
      'Sprout does not know whether this holds anything. Compose `sprout.Place` into `Room`.',
    ]);
  });
});
