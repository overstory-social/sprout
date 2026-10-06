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
import {
  CATALOGUE as WAYS_CATALOGUE,
  MARTA as WAYS_MARTA,
  MOUTH,
  ways,
  YARD,
} from '../fixtures/exits.js';
import { words } from '../fixtures/reading.js';
import { Draft } from './draft.js';
import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { Budget, BudgetExhausted } from './budget.js';
import { offersTo } from './offers.js';
import * as D from '../fixtures/darkness.js';
import {
  BOOK as BENCH_BOOK,
  BRASS_KEY as BENCH_KEY,
  CRATE as BENCH_CRATE,
  POUCH as BENCH_POUCH,
  bench,
} from '../fixtures/bench.js';
import { commandContext } from '../fixtures/parser.js';

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

  it('never fills a role only the actor plays with the actor’s own place, as `all` leaves it out', () => {
    const typed = typedBy(study());
    // Nothing plays `take`'s or `examine`'s target; the lamp plays `pull`'s.
    expect(typed).not.toContain('take hall');
    expect(typed).not.toContain('examine hall');
    expect(typed).toContain('take lamp');
    expect(typed).toContain('pull hall');
  });

  it('fills `go`’s way with each exit that applies, by its direction', () => {
    expect(typedBy(study()).filter((one) => one.startsWith('go '))).toEqual(['go north']);
    const up = study([[MARTA, LOFT, 'Marta']]);
    expect(typedBy(up).filter((one) => one.startsWith('go '))).toEqual(['go down']);
  });

  it('fills `go`’s way with each link that applies, by its label, since a link has no direction', () => {
    const draft = new Draft(ways([[WAYS_MARTA, MOUTH]]));
    draft.write({ ...draft.instance(MOUTH)!, links: new Map([['back', YARD]]) });
    const state = draft.commit().state;
    const marta = state.visitors.get(WAYS_MARTA)!.instance!;
    const offered = offersTo(marta, {
      state: new Draft(state),
      catalogue: WAYS_CATALOGUE,
      budget: new Budget(DEFAULT_LIMITS.budgets, 'poll'),
      passes: () => true,
      nicknames: new Map(),
    }).map((offer) => offer.typed);
    expect(offered.filter((one) => one.startsWith('go '))).toEqual([
      'go the way you came',
      'go up',
    ]);
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

  it('offers `go` by the exits it is handed, where its caller has asked them already', () => {
    const state = study();
    const marta = actorOf(state, MARTA);
    const ways = (offers: ReturnType<typeof offersTo>) =>
      offers.filter((offer) => offer.typed.startsWith('go ')).map((offer) => offer.typed);
    expect(ways(offersTo(marta, lookingAt(state)))).toEqual(['go north']);
    const handed = [{ direction: 'down' as const, label: 'down the well', to: LOFT }];
    expect(ways(offersTo(marta, lookingAt(state), handed))).toEqual(['go down']);
    expect(ways(offersTo(marta, lookingAt(state), []))).toEqual([]);
  });

  it('is asked of one who stands somewhere', () => {
    const state = study();
    expect(() => offersTo(state.world, lookingAt(state))).toThrow(/is away/);
  });
});

describe('what a carried role is offered with', () => {
  it('is only what the actor carries, through an open pouch, and never what lies further out', () => {
    const one = bench([
      [BENCH_KEY, null],
      [BENCH_POUCH, null],
      [BENCH_BOOK, BENCH_POUCH],
    ]);
    const typed = offersTo(one.people[0]!, commandContext(one, [])).map((offer) => offer.typed);
    const unlocking = typed.filter((line) => line.startsWith('unlock '));
    expect(unlocking).toEqual([
      'unlock chest with brass key',
      'unlock chest with pouch',
      'unlock chest with book',
    ]);
    // `put`'s container is not carried, so the crate on the floor is offered.
    expect(typed).toContain('put brass key in crate');
  });
});

describe('an offer whose move would put a thing inside itself', () => {
  it('is greyed with the engine’s `inside_itself`, as the move would refuse it', () => {
    const one = bench([
      [BENCH_POUCH, null],
      [BENCH_CRATE, BENCH_POUCH],
      [BENCH_KEY, null],
    ]);
    const offered = offersTo(one.people[0]!, commandContext(one, []));
    const into = offered.find((offer) => offer.typed === 'put pouch in crate')!;
    expect(words(into.refused!.said)).toBe(
      'sprout.World inside_itself: {item} cannot go inside itself.',
    );
    expect(into.refused!.bindings.get('item')).toEqual({ binds: 'object', id: BENCH_POUCH });
    expect(offered.find((offer) => offer.typed === 'put brass key in crate')!.refused).toBeNull();
  });
});

describe('what an actor is offered in the dark', () => {
  it('is only what they carry, beside the ways out', () => {
    const state = D.dark(undefined, [], [[D.MARTA, D.LAMP]]);
    const typed = offersTo(D.personOf(state, D.MARTA), D.darkContext(state)).map(
      (offer) => offer.typed,
    );
    expect(typed.some((line) => line.includes('coal') || line.includes('cellar'))).toBe(false);
    expect(typed).toContain('examine lamp');
    expect(typed).toContain('go up');
    const lit = D.dark(undefined, [[D.LAMP, 'lit', true]], [[D.MARTA, D.LAMP]]);
    const seen = offersTo(D.personOf(lit, D.MARTA), D.darkContext(lit)).map((offer) => offer.typed);
    expect(seen.some((line) => line.includes('coal'))).toBe(true);
  });
});
