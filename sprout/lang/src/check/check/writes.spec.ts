// The four that write and the one that remembers: the rows of the spec's
// table that write, and each function of the module asked directly.

import { describe, expect, it } from 'vitest';

import { objectOf } from '../bindings.js';
import {
  bodyOf,
  call,
  checking,
  effect,
  KEY,
  PRINTER,
  saidBy,
  vessel,
  VESSEL,
  warded,
  word,
} from '../../fixtures/check.js';
import { EFFECTS, effectCall, listChange, wholeNumber } from './writes.js';

describe('what the compiler checks — the table, row by row', () => {
  it('`self.set(:p, e)` — `e` is `p`’s declared type', () => {
    expect(effect('self.set(:inked, true)', vessel())).toBe(true);
    expect(effect('self.set(:state, :cured)', warded())).toBe(true);
    expect(effect('self.set(:note, "a line")', warded())).toBe(true);
    expect(effect('self.set(:inked, 1)', vessel())).toBe(false);
  });

  it('`self.set(:p, e)` — an integer within its range, where the compiler can tell', () => {
    expect(effect('self.set(:capacity, 9)', vessel())).toBe(true);
    expect(effect('self.set(:capacity, 0)', vessel())).toBe(true);

    const over = vessel();
    expect(effect('self.set(:capacity, 10)', over)).toBe(false);
    expect(over.diagnostics.refusals[0]!.message).toBe('10 is outside 0 to 9.');
    expect(effect('self.set(:capacity, -1)', vessel())).toBe(false);

    // And where it cannot tell, it says nothing: a value read at run
    // time carries the whole range, and the runtime faults.
    expect(effect('self.set(:capacity, self.get(:capacity) + 1)', vessel())).toBe(true);
  });

  it('`self.adjust(:p, e)` — both integer; the step is not bound by the range', () => {
    expect(effect('self.adjust(:capacity, 1)', vessel())).toBe(true);
    // The RESULT is clamped rather than refused, so a step outside the
    // property's own range is ordinary.
    expect(effect('self.adjust(:capacity, -50)', vessel())).toBe(true);
    expect(effect('self.adjust(:inked, 1)', vessel())).toBe(false);
  });

  it('`self.add(:p, e)`, `self.remove(:p, e)` — `p` a list, `e` its element type', () => {
    expect(effect('self.add(:opens, :silver)', bodyOf(KEY))).toBe(true);
    expect(effect('self.remove(:opens, :oak)', bodyOf(KEY))).toBe(true);

    const wrongOption = bodyOf(KEY);
    expect(effect('self.add(:opens, :brass)', wrongOption)).toBe(false);
    expect(wrongOption.diagnostics.refusals[0]!.message).toContain('`Ward` has no option `brass`');

    const notAList = bodyOf(KEY);
    expect(effect('self.add(:wear, 1)', notAList)).toBe(false);
    expect(notAList.diagnostics.refusals[0]!.message).toContain('changes a list');
  });

  it('`self.add(:p, e)`, `self.remove(:p, e)` — a list of lists takes a whole list', () => {
    // A list's element type may itself be a list, and the only
    // expression of list type is a `get` of a list property.
    expect(effect('self.add(:grid, self.get(:row))', warded())).toBe(true);
    expect(effect('self.remove(:grid, self.get(:row))', warded())).toBe(true);

    const wrong = warded();
    expect(effect('self.add(:grid, self.get(:ward))', wrong)).toBe(false);
    expect(wrong.diagnostics.refusals[0]!.message).toBe(
      'This holds a list of Ward, and this is an option of Ward.',
    );
  });

  it('`x.remember(:p, e)` — the same rule, and the same refusal', () => {
    const fromVessel = bodyOf(VESSEL);
    expect(effect('actor.remember(:handled, true)', fromVessel)).toBe(false);
    expect(saidBy(fromVessel).join(' ')).toContain('remembers nothing called `:handled`');
  });

  it('nothing but `remember` writes memory, for any of the four that write', () => {
    // The line `get` draws: a `set` that reached memory would write one
    // object's idea of everybody at once.
    for (const text of [
      'self.set(:visits, 5)',
      'self.adjust(:visits, 1)',
      'self.add(:seen, :silver)',
      'self.remove(:seen, :oak)',
    ]) {
      const context = bodyOf(PRINTER);
      expect(effect(text, context), text).toBe(false);
      expect(saidBy(context).join(' '), text).toContain('remembered about each actor');
      expect(saidBy(context).join(' '), text).toContain('remember');
    }
    // And the word that does write memory still does.
    expect(effect('actor.remember(:visits, 5)', bodyOf(PRINTER))).toBe(true);
  });

  it('sends `adjust` to `adjust`, not to `remember`, which would lose the step', () => {
    // Stepping by one is not overwriting with one. An author who
    // follows the remedy literally must end up with what they asked
    // for, so only `adjust` is told to step it on the actor.
    const stepping = bodyOf(PRINTER);
    expect(effect('self.adjust(:visits, 1)', stepping)).toBe(false);
    expect(saidBy(stepping).join(' ')).toContain('actor.adjust(:visits');
    // The remedy, not the message — which says "remembered about each
    // actor" and so contains the word either way.
    expect(stepping.diagnostics.refusals[0]!.remedy).not.toContain('remember');

    const writing = bodyOf(PRINTER);
    expect(effect('self.set(:visits, 1)', writing)).toBe(false);
    expect(saidBy(writing).join(' ')).toContain('actor.remember(:visits');

    // The reading it points at is the one that works.
    expect(effect('actor.adjust(:visits, 1)', bodyOf(PRINTER))).toBe(true);
  });
});

describe('the writes, asked directly', () => {
  it('names the four that write and the one that remembers, and no reading', () => {
    expect([...EFFECTS].sort()).toEqual(['add', 'adjust', 'remember', 'remove', 'set']);
    for (const reading of ['get', 'recall', 'count', 'holds', 'is', 'includes']) {
      expect(EFFECTS.has(reading), reading).toBe(false);
    }
  });

  it('checks a write on a receiver whose type is already known', () => {
    const context = checking(vessel());
    const written = call('self.set(:inked, true)');
    expect(
      effectCall(written.receiver, objectOf(VESSEL), written.method, written.arguments, context),
    ).toBe(true);
    const other = call('target.set(:inked, true)');
    expect(
      effectCall(other.receiver, objectOf(VESSEL), other.method, other.arguments, context),
    ).toBeNull();
    expect(saidBy(context).join(' ')).toContain('Only `self` writes its own state');
  });

  it('adds to a list only what the list holds', () => {
    const context = checking(bodyOf(KEY));
    const opens = KEY.properties.get('opens')!;
    const wear = KEY.properties.get('wear')!;
    const add = call('self.add(:opens, :oak)').method;
    expect(
      listChange(
        opens,
        word(':opens'),
        add,
        call('self.add(:opens, :silver)').arguments[1]!,
        context,
      ),
    ).toBe(true);
    expect(
      listChange(wear, word(':wear'), add, call('self.add(:wear, 1)').arguments[1]!, context),
    ).toBe(false);
    expect(context.diagnostics.refusals.map((d) => d.message)).toEqual([
      '`add` changes a list, and `:wear` holds integer 0 to 99.',
    ]);
  });

  it('steps a number by any whole number, and refuses to step anything else', () => {
    const context = checking(vessel());
    const capacity = VESSEL.properties.get('capacity')!;
    const inked = VESSEL.properties.get('inked')!;
    expect(
      wholeNumber(
        capacity,
        word(':capacity'),
        call('self.adjust(:capacity, -50)').arguments[1]!,
        context,
      ),
    ).toBe(true);
    expect(
      wholeNumber(
        capacity,
        word(':capacity'),
        call('self.adjust(:capacity, true)').arguments[1]!,
        context,
      ),
    ).toBe(false);
    expect(
      wholeNumber(inked, word(':inked'), call('self.adjust(:inked, 1)').arguments[1]!, context),
    ).toBe(false);
    expect(saidBy(context)).toEqual([
      'This holds a whole number, and `true` is true or false. Write a whole number, as in `1`.',
      '`adjust` steps a number, and `:inked` holds boolean. Write it with `set` instead.',
    ]);
  });
});
