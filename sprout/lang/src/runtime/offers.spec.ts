import { describe, expect, it } from 'vitest';

import {
  actorOf,
  BOX,
  CAT,
  HALL,
  INES,
  LAMP,
  lookingAt,
  LOFT,
  MARTA,
  PIN,
  study,
} from '../fixtures/describe.js';
import { words } from '../fixtures/reading.js';
import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { Budget, BudgetExhausted } from './budget.js';
import { offersTo } from './offers.js';

const typedBy = (state: ReturnType<typeof study>) =>
  offersTo(actorOf(state, MARTA), lookingAt(state)).map((offer) => offer.typed);

describe('what an actor is offered', () => {
  it('is every verb they may type, in the order the parser tries them, once for each filling', () => {
    const typed = typedBy(study());
    // The world's own verbs first, then the standard library's.
    expect(typed.slice(0, 2)).toEqual(['pull hall', 'pull lamp']);
    expect(typed.indexOf('pull pin')).toBeLessThan(typed.indexOf('go north'));
    expect(typed.indexOf('go north')).toBeLessThan(typed.indexOf('look'));
    const engine = ['look', 'inventory', 'wait', 'help'];
    expect(typed.filter((one) => engine.includes(one))).toEqual(engine);
  });

  it('fills a role a thing fills with each thing in range it fits, the actor left out', () => {
    const state = study([
      [MARTA, HALL, 'Marta'],
      [INES, HALL, 'Ines'],
    ]);
    const typed = typedBy(state);
    const examined = typed.filter((one) => one.startsWith('examine '));
    expect(examined).toEqual([
      'examine hall',
      'examine lamp',
      'examine mirror',
      'examine stool',
      'examine blank',
      'examine box',
      'examine cat',
      'examine Ines',
      'examine pin',
    ]);
    expect(typed).not.toContain('examine Marta');
    // `give`'s recipient composes `sprout.Actor`; nothing fills two roles of one offer.
    expect(typed.filter((one) => one.startsWith('give lamp'))).toEqual([
      'give lamp to cat',
      'give lamp to Ines',
    ]);
    expect(typed).not.toContain('give cat to cat');
  });

  it('fills `go`’s way with each exit that applies, by its direction', () => {
    expect(typedBy(study()).filter((one) => one.startsWith('go '))).toEqual(['go north']);
    const up = study([[MARTA, LOFT, 'Marta']]);
    expect(typedBy(up).filter((one) => one.startsWith('go '))).toEqual(['go down']);
  });

  it('leaves a value role unbound, typed `…`, since only a participant’s `from` hears a value', () => {
    const state = study();
    const asked = offersTo(actorOf(state, MARTA), lookingAt(state)).find(
      (offer) => offer.typed === 'ask cat about …',
    )!;
    expect(asked).toBeDefined();
    expect([...asked.reading.bindings]).toEqual([['target', { object: CAT }]]);
  });

  it('carries each reading’s consent pass: a refusal where one refuses, else none', () => {
    const lit = study(undefined, [[LAMP, 'lit', true]]);
    const pull = offersTo(actorOf(lit, MARTA), lookingAt(lit)).find(
      (offer) => offer.typed === 'pull lamp',
    )!;
    expect(words(pull.refused!.said)).toBe('It is already lit.');
    expect(pull.refused!.by).toBe(LAMP);
    const dark = study();
    const offered = offersTo(actorOf(dark, MARTA), lookingAt(dark));
    expect(offered.find((offer) => offer.typed === 'pull lamp')!.refused).toBeNull();
  });

  it('reaches what range reaches, what a container holds included', () => {
    const typed = typedBy(study());
    expect(typed).toContain('take pin');
    expect(offersTo(actorOf(study(), MARTA), lookingAt(study())).map((o) => o.reading)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ bindings: new Map([['target', { object: PIN }]]) }),
        expect.objectContaining({ bindings: new Map([['target', { object: BOX }]]) }),
      ]),
    );
  });

  it('costs a step for each offer, so a world too large to list faults as any work does', () => {
    const state = study();
    const context = {
      ...lookingAt(state),
      budget: new Budget({ ...DEFAULT_LIMITS.budgets, pollSteps: 40 }, 'poll'),
    };
    expect(() => offersTo(actorOf(state, MARTA), context)).toThrow(BudgetExhausted);
  });

  it('is asked of one who stands somewhere', () => {
    const state = study();
    expect(() => offersTo(state.world, lookingAt(state))).toThrow(/is away/);
  });
});
