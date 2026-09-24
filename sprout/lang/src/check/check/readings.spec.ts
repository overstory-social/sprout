// The readings a receiver answers: the rows of the spec's table that
// read, and each function of the module asked directly with the
// receiver's type already known.

import { describe, expect, it } from 'vitest';

import { objectOf, OPEN_OBJECT, roleBinding, showBindingType, valueOf } from '../bindings.js';
import { ACTOR } from '../../declare/actors.js';
import { BOOLEAN, integer } from '../../declare/types.js';
import { Diagnostics } from '../../source/diagnostics.js';
import {
  at,
  bodyOf,
  call,
  checking,
  effect,
  expression,
  KEY,
  PRINTER,
  read,
  saidBy,
  shapeOf,
  VESSEL,
  vessel,
  warded,
} from '../../fixtures/check.js';
import {
  callType,
  getCall,
  holdsCall,
  includesCall,
  isCall,
  memberType,
  READINGS,
  recallCall,
} from './readings.js';

describe('what the compiler checks — the table, row by row', () => {
  it('`x.get(:p)` — `p` declared on `x`’s type', () => {
    expect(shapeOf('self.get(:capacity)')).toBe('integer 0 to 9');
    expect(shapeOf('tool.get(:wear)', warded())).toBe('integer 0 to 99');
    expect(shapeOf('tool.get(:opens)', warded())).toBe('[Ward]');

    const missing = vessel();
    expect(read('self.get(:inkd)', missing).type).toBeNull();
    expect(saidBy(missing).join(' ')).toContain('Did you mean `:inked`?');
  });

  it('`x.get(:p)` — `x` is not of object type', () => {
    const open = vessel();
    const refused = read('target.get(:capacity)', open);
    expect(refused.type).toBeNull();
    expect(refused.said.join(' ')).toContain('Narrow it first');
  });

  it('reads `here` as `sprout.Place`, which holds things and declares no property of its own', () => {
    expect(shapeOf('here.count', vessel())).toBe('integer');
    const refused = read('here.get(:capacity)', vessel());
    expect(refused.said).toEqual(['`sprout.Place` has no `:capacity`. It has nothing.']);
  });

  it('`x.recall(:p)` — `x` composes `sprout.Actor`, `p` in `self`’s `remembers` block', () => {
    expect(shapeOf('actor.recall(:visits)', bodyOf(PRINTER))).toBe('integer 0 to 99');
    expect(effect('actor.remember(:handled, true)', bodyOf(PRINTER))).toBe(true);
    expect(effect('actor.adjust(:visits, 1)', bodyOf(PRINTER))).toBe(true);

    const notActor = bodyOf(PRINTER);
    expect(read('self.get(:capacity)', bodyOf(VESSEL)).type).not.toBeNull();
    expect(read('actor.recall(:capacity)', notActor).type).toBeNull();
    expect(saidBy(notActor).join(' ')).toContain('remembers nothing called `:capacity`');
  });

  it('`x.recall(:p)` — refuses a receiver that is not an actor, by name', () => {
    const notActor = bodyOf(
      VESSEL,
      roleBinding('tool', { fills: 'kind', kind: KEY }, null, at('tool'), new Diagnostics())!,
    );
    expect(read('tool.recall(:visits)', notActor).type).toBeNull();
    expect(saidBy(notActor).join(' ')).toContain('`shop.Key` is not someone');
    expect(saidBy(notActor).join(' ')).toContain(ACTOR);
  });

  it('`x.recall(:p)` — `p` is in SELF’s `remembers` block, never the receiver’s', () => {
    // `actor` is a Printer, which remembers `:visits`. Asked from
    // inside a Vessel, which remembers nothing, it is still refused:
    // memory is keyed to the object that declared it, and no object
    // reads another object's memory of anyone.
    const fromVessel = bodyOf(VESSEL);
    expect(read('actor.recall(:visits)', fromVessel).type).toBeNull();
    expect(saidBy(fromVessel).join(' ')).toContain('remembers nothing called `:visits`');

    // The same reading, from inside the kind that declared it, is fine.
    expect(shapeOf('actor.recall(:visits)', bodyOf(PRINTER))).toBe('integer 0 to 99');
  });

  it('`get` does not read memory, and says which word does', () => {
    const context = bodyOf(PRINTER);
    expect(read('self.get(:visits)', context).type).toBeNull();
    expect(saidBy(context).join(' ')).toContain('remembered about each actor');
    expect(saidBy(context).join(' ')).toContain('recall');
  });

  it('`recall` does not read a property the object holds, and says which word does', () => {
    const context = bodyOf(PRINTER);
    expect(read('actor.recall(:capacity)', context).type).toBeNull();
    expect(saidBy(context).join(' ')).toContain('remembers nothing called `:capacity`');
  });

  it('`x.includes(e)` — `x` a list or a set role, `e` its element type', () => {
    expect(shapeOf('tool.get(:opens).includes(:oak)', warded())).toBe('boolean');
    expect(shapeOf('tools.includes(target)', vessel())).toBe('boolean');

    const wrong = warded();
    expect(read('tool.get(:opens).includes(:wet)', wrong).type).toBeNull();
    expect(saidBy(wrong).join(' ')).toContain('`Ward` has no option `wet`');
  });

  it('`x.includes(e)` — a list of lists is asked after a whole list', () => {
    expect(shapeOf('self.get(:grid).includes(self.get(:row))', warded())).toBe('boolean');

    const wrong = warded();
    expect(read('self.get(:grid).includes(self.get(:ward))', wrong).type).toBeNull();
    expect(saidBy(wrong).join(' ')).toContain('This holds [Ward], and Ward is not one.');
  });

  it('`x.count`, `x.count(K)` — `x` a container or a set role', () => {
    expect(shapeOf('self.count', vessel())).toBe('integer');
    expect(shapeOf('tools.count', vessel())).toBe('integer');
    expect(shapeOf('tools.count(Rib)', vessel())).toBe('integer');
    expect(shapeOf('self.count(Rib)', vessel())).toBe('integer');

    const notContainer = warded();
    expect(read('self.count', notContainer).type).toBeNull();
    expect(saidBy(notContainer).join(' ')).toContain('holds nothing');

    const noSuchKind = vessel();
    expect(read('self.count(Kiln)', noSuchKind).type).toBeNull();
    expect(saidBy(noSuchKind).join(' ')).toContain('Nothing here is a `Kiln`');
  });

  it('`x.count` — a list too, which the checker’s own table leaves out', () => {
    // Lists names `count` as one of a list's four operations; the
    // checker's table names only a container and a set role. The
    // fuller sentence wins.
    expect(shapeOf('tool.get(:opens).count', warded())).toBe('integer');

    // `count(K)` counts contents that compose a kind, which a list has
    // none of.
    const kinded = warded();
    expect(read('tool.get(:opens).count(Rib)', kinded).type).toBeNull();
    expect(saidBy(kinded).join(' ')).toContain('not things of a kind');
  });

  it('`x.holds(y)` — `x` a container, `y` an object binding', () => {
    expect(shapeOf('self.holds(target)', vessel())).toBe('boolean');
    const value = vessel();
    expect(read('self.holds(1)', value).type).toBeNull();
    expect(saidBy(value).join(' ')).toContain('asks after a thing');
  });

  it('`x.is(K)` — `K` a kind in scope, `x` an object binding', () => {
    expect(shapeOf('tool.is(Key)', warded())).toBe('boolean');
    expect(shapeOf('here.is(sprout.Container)', warded())).toBe('boolean');
    const value = vessel();
    expect(read('self.get(:capacity).is(Rib)', value).type).toBeNull();
    expect(saidBy(value).join(' ')).toContain('asks what a thing is');
  });
});

describe('it never guesses, and never dies', () => {
  it('refuses a call that writes where a value is wanted', () => {
    const context = vessel();
    expect(read('self.set(:inked, true) && self.get(:inked)', context).type).toBeNull();
    expect(saidBy(context).join(' ')).toContain('it is not a value');
  });
});

describe('the readings, asked directly', () => {
  it('reads `count` without brackets and names every reading when a word is none', () => {
    expect([...READINGS]).toEqual(['get', 'recall', 'count', 'holds', 'is', 'includes']);
    const context = vessel();
    const set = context.scope.lookup('tools')!.type;
    const count = expression('tools.count');
    const size = expression('tools.size');
    if (count.kind !== 'member' || size.kind !== 'member') throw new Error('not a member');
    expect(memberType(count.receiver, set, count.member, context)).toEqual(valueOf(integer()));
    expect(memberType(size.receiver, set, size.member, context)).toBeNull();
    expect(saidBy(context)).toEqual([
      'Sprout does not know how to read `size`. A reading is one of `get`, `recall`, `count`, `holds`, `is` and `includes`, and `count` is the only one written without brackets.',
    ]);
  });

  it('refuses a word that is no reading, naming the six', () => {
    const context = checking(vessel());
    const written = call('self.mangle(:inked)');
    expect(
      callType(written.receiver, objectOf(VESSEL), written.method, written.arguments, context),
    ).toBeNull();
    expect(saidBy(context)).toEqual([
      'Sprout does not know how to read `mangle`. A reading is one of `get`, `recall`, `count`, `holds`, `is` and `includes`.',
    ]);
  });

  it('gets a property off a receiver whose kind is known, and off nothing else', () => {
    const context = vessel();
    const written = call('tool.get(:wear)');
    expect(
      showBindingType(
        getCall(written.receiver, objectOf(KEY), written.method, written.arguments, context)!,
      ),
    ).toBe('integer 0 to 99');
    expect(
      getCall(written.receiver, OPEN_OBJECT, written.method, written.arguments, context),
    ).toBeNull();
    expect(
      getCall(written.receiver, valueOf(integer()), written.method, written.arguments, context),
    ).toBeNull();
    expect(saidBy(context)).toEqual([
      'Sprout does not know what this is, so it cannot read a property from it. Narrow it first, as in `if (thing.is(Key)) { … }`.',
      'Only a thing in the world has properties, and this is integer. Name a binding that holds a thing in the world.',
    ]);
  });

  it('recalls what `self` remembers, of an actor', () => {
    const context = bodyOf(PRINTER);
    const written = call('actor.recall(:visits)');
    expect(
      showBindingType(
        recallCall(
          written.receiver,
          objectOf(PRINTER),
          written.method,
          written.arguments,
          context,
        )!,
      ),
    ).toBe('integer 0 to 99');
    expect(
      recallCall(written.receiver, objectOf(KEY), written.method, written.arguments, context),
    ).toBeNull();
    expect(saidBy(context).join(' ')).toContain(`Only a kind composing \`${ACTOR}\` is.`);
  });

  it('asks `is` of a thing, `holds` of a container and `includes` of a list or a set', () => {
    const context = checking(vessel());
    const is = call('target.is(Key)');
    expect(isCall(OPEN_OBJECT, is.method, is.arguments, context)).toBe(true);
    expect(isCall(valueOf(BOOLEAN), is.method, is.arguments, context)).toBe(false);

    const holds = call('self.holds(target)');
    expect(
      holdsCall(holds.receiver, objectOf(VESSEL), holds.method, holds.arguments, context),
    ).toBe(true);
    expect(holdsCall(holds.receiver, objectOf(KEY), holds.method, holds.arguments, context)).toBe(
      false,
    );

    const includes = call('tools.includes(target)');
    const set = context.scope.lookup('tools')!.type;
    expect(includesCall(set, includes.method, includes.arguments, context)).toBe(true);
    expect(includesCall(objectOf(VESSEL), includes.method, includes.arguments, context)).toBe(
      false,
    );

    expect(context.diagnostics.refusals.map((d) => d.message)).toEqual([
      '`is` asks what a thing is, and this is boolean.',
      '`shop.Key` holds nothing, so there is nothing to count.',
      '`includes` asks what a list or a set holds, and this is shop.Vessel.',
    ]);
  });
});
