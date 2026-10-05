import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { BudgetExhausted } from '../runtime/budget.js';
import { SproutList } from '../runtime/lists.js';
import {
  boundObject,
  BRASS_KEY,
  CRATE,
  ECHO,
  OAK_DOOR,
  PRESS,
  proseTurn,
  setOn,
  type ProseTurn,
} from '../fixtures/prose.js';
import { reflow } from './reflow.js';
import { renderProse } from './render.js';
import { NameOutOfRange } from '../runtime/named.js';
import { Draws } from '../runtime/draws.js';
import { chooser, readProseText } from '../fixtures/parse.js';
import { boundReadings, boundValue, type Evaluated } from '../runtime/evaluate.js';

/** `name` of `by`, rendered for `reader` and laid out, charging nothing to output. */
function rendered(
  turn: ProseTurn,
  by: typeof PRESS,
  name: string,
  reader: typeof PRESS,
  bindings: Record<string, Evaluated> = {},
): string[] {
  const passage = turn.draft.instance(by)!.kind.passages.get(name)!;
  const voice = { self: by, library: 'mill', bindings: new Map(Object.entries(bindings)) };
  return reflow(renderProse(passage.body.prose, voice, reader, turn.context, null));
}

describe('a slot renders what it reads', () => {
  it('an option humanised, a number in digits, and a string as written', () => {
    const turn = proseTurn();
    expect(rendered(turn, PRESS, 'mood', turn.marta)).toEqual([
      'Bone dry, 3 sheets, labelled the_albion.',
    ]);
  });

  it('an object as its reader reads it: “you” to itself, its name to anyone else', () => {
    const turn = proseTurn();
    const bindings = {
      actor: boundObject(turn.marta),
      tools: { binds: 'set' as const, ids: [BRASS_KEY, OAK_DOOR] },
    };
    expect(rendered(turn, PRESS, 'inked', turn.marta, bindings)).toEqual([
      'You inks a press with a brass key, an oak door.',
    ]);
    expect(rendered(turn, PRESS, 'inked', BRASS_KEY, bindings)).toEqual([
      'Marta inks a press with you, an oak door.',
    ]);
  });

  it('another object’s passage, with that object its own `self`', () => {
    const turn = proseTurn();
    expect(rendered(turn, CRATE, 'listing', turn.marta)).toEqual([
      'In the crate: an apple, a rib, a spare rib.',
      'A rib first, a rib',
    ]);
  });
});

describe('a passage a slot renders from a description', () => {
  it('is given `seen` beside `actor` and `here`, as the description has it', () => {
    const turn = proseTurn();
    const read = (seen: string) =>
      rendered(turn, CRATE, 'peek', turn.marta, { seen: boundValue(seen) });
    expect(read('look')).toEqual(['The crate, looked into, is full. Its lid is open.']);
    expect(read('poll')).toEqual(['The crate is full. Its lid is shut.']);
  });
});

describe('a name in a kind’s body narrowed by `{if}`', () => {
  it('is bound for the branch to the object the condition found, and read through its kind there', () => {
    const turn = proseTurn();
    expect(rendered(turn, ECHO, 'nearby', turn.marta)).toEqual(['The_albion']);
  });

  it('faults where it reaches nothing here now, as any read through it does', () => {
    const turn = proseTurn();
    // In the crate, the press is nothing the yard holds directly.
    turn.draft.place(PRESS, CRATE);
    expect(() => rendered(turn, ECHO, 'nearby', turn.marta)).toThrow(NameOutOfRange);
  });
});

describe('a dotted path in a slot', () => {
  it('renders the object it names, what it holds, and a passage of it', () => {
    const turn = proseTurn();
    expect(rendered(turn, ECHO, 'pathed', turn.marta)).toEqual(['The crate holds 3, a rib first']);
  });

  it('faults where what it names is out of range, as a name does', () => {
    const turn = proseTurn();
    turn.draft.place(CRATE, turn.draft.world);
    expect(() => rendered(turn, ECHO, 'pathed', turn.marta)).toThrow(NameOutOfRange);
  });
});

describe('a block renders what it guards, and a loop what it walks', () => {
  it('renders the first branch whose condition holds, and a block that renders nothing leaves no paragraph', () => {
    const turn = proseTurn();
    expect(rendered(turn, PRESS, 'sheets', turn.marta)).toEqual([
      'Some sheets.',
      'The end,\nAnd a line kept. A brace: {.',
    ]);
    setOn(turn, PRESS, { sheets: 7 });
    expect(rendered(turn, PRESS, 'sheets', turn.marta)[0]).toBe('Many sheets.');
    setOn(turn, PRESS, { sheets: 0 });
    expect(rendered(turn, PRESS, 'sheets', turn.marta).slice(0, 2)).toEqual([
      'No sheets.',
      'Nothing at all.',
    ]);
  });

  it('walks a list in its order, with where the walk is bound, counting from 1', () => {
    const turn = proseTurn();
    expect(rendered(turn, PRESS, 'moods', turn.marta)).toEqual([
      '1 of 2: bone dry; 2 of 2: drowsy',
    ]);
    const moods = turn.draft.instance(PRESS)!.properties.get('moods') as SproutList;
    setOn(turn, PRESS, { moods: moods.remove('bone_dry') });
    expect(rendered(turn, PRESS, 'moods', turn.marta)).toEqual(['1 of 1: drowsy']);
  });

  it('walks `readings`, each already the words a visitor would type for it', () => {
    const turn = proseTurn();
    const { prose } = readProseText(
      '{for reading of readings}{reading}{if $last}.{else}, {/if}{/for}',
    );
    const voice = {
      self: PRESS,
      library: 'mill',
      bindings: new Map([['readings', boundReadings(['look', 'wait'])]]),
    };
    expect(reflow(renderProse(prose, voice, turn.marta, turn.context, null))).toEqual([
      'Look, wait.',
    ]);
  });

  it('walks and counts only what is in range of `self`, so a shut crate lists nothing from outside', () => {
    const open = proseTurn();
    const turn = { ...open, context: { ...open.context, passes: (c: string) => c !== CRATE } };
    const { prose } = readProseText(
      '{crate.count}: {for t in crate}{t}{if !$last}, {/if}{/for}; {for r: Rib in crate}{r}{if !$last}, {/if}{/for}.',
    );
    const voice = {
      self: PRESS,
      library: 'mill',
      bindings: new Map([['crate', boundObject(CRATE)]]),
    };
    expect(reflow(renderProse(prose, voice, turn.marta, turn.context, null))).toEqual(['0: ; .']);
    expect(reflow(renderProse(prose, voice, open.marta, open.context, null))).toEqual([
      '3: an apple, a rib, a spare rib; a rib, a spare rib.',
    ]);
    // The crate, shut, still lists all it holds: an object reaches its own contents.
    expect(rendered(turn, CRATE, 'listing', turn.marta)).toEqual(
      rendered(open, CRATE, 'listing', open.marta),
    );
  });

  it('walks nothing where there is nothing, and says nothing for it', () => {
    const turn = proseTurn();
    const bindings = { actor: boundObject(turn.marta), tools: { binds: 'set' as const, ids: [] } };
    expect(rendered(turn, PRESS, 'inked', OAK_DOOR, bindings)).toEqual(['Marta inks a press with']);
  });
});

describe('rendering is charged, and bounded, as a body is', () => {
  it('charges every iteration and every expression a step', () => {
    const turn = proseTurn();
    const before = turn.context.budget.spentSteps;
    rendered(turn, PRESS, 'moods', turn.marta);
    const once = turn.context.budget.spentSteps - before;
    const moods = turn.draft.instance(PRESS)!.properties.get('moods') as SproutList;
    setOn(turn, PRESS, { moods: moods.remove('drowsy') });
    const again = turn.context.budget.spentSteps;
    rendered(turn, PRESS, 'moods', turn.marta);
    expect(turn.context.budget.spentSteps - again).toBeLessThan(once);
    expect(once).toBeGreaterThan(2);
  });

  it('faults a passage that renders itself, at the host’s passage depth', () => {
    const turn = proseTurn({ ...DEFAULT_LIMITS.budgets, passageDepth: 3 });
    const passage = turn.draft.instance(ECHO)!.kind.passages.get('ring')!;
    const voice = { self: ECHO, library: 'mill', bindings: new Map() };
    let thrown: unknown;
    try {
      renderProse(passage.body.prose, voice, turn.marta, turn.context, null);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(BudgetExhausted);
    expect((thrown as BudgetExhausted).limit).toBe('passageDepth');
    expect(turn.context.budget.passageDepth).toBe(0);
  });

  it('faults at the step budget, however much there is to walk', () => {
    const turn = proseTurn({ ...DEFAULT_LIMITS.budgets, steps: 5 });
    expect(() => rendered(turn, CRATE, 'listing', turn.marta)).toThrow(BudgetExhausted);
  });
});

describe('a `{one of}` renders one of its choices, drawn', () => {
  const CALLS = ['Hello, you.', 'Halloo, you.', 'Who is there, you.'];
  const actor = (turn: ProseTurn) => ({ actor: boundObject(turn.marta) });

  /** `name` of the echo for Marta, drawing from `draws`. */
  const drawnWith = (turn: ProseTurn, name: string, draws: Draws | null, bindings = {}) => {
    const passage = turn.draft.instance(ECHO)!.kind.passages.get(name)!;
    const voice = {
      self: ECHO,
      library: 'mill',
      bindings: new Map(Object.entries({ ...actor(turn), ...bindings })),
    };
    return reflow(renderProse(passage.body.prose, voice, turn.marta, turn.context, draws));
  };

  it('renders the choice the draw names, one step for the choosing', () => {
    const turn = proseTurn();
    const draws = new Draws(7);
    const expected = new Draws(7);
    for (let i = 0; i < 10; i++) {
      expect(drawnWith(turn, 'call', draws)).toEqual([CALLS[expected.below(3)]]);
    }
    const before = turn.context.budget.spentSteps;
    drawnWith(turn, 'call', new Draws(7));
    expect(turn.context.budget.spentSteps - before).toBeGreaterThanOrEqual(1);
  });

  it('draws again for each time a loop comes round, and in a passage a slot renders', () => {
    const turn = proseTurn();
    const tools = { binds: 'set', ids: [BRASS_KEY, OAK_DOOR, CRATE, PRESS] } as const;
    const draws = new Draws(12);
    const [calls] = drawnWith(turn, 'calls', draws, { tools });
    expect(calls!.split(' ')).toHaveLength(4);
    expect(draws.drawn).toBe(4);
    const tossed = new Draws(12);
    const [toss] = drawnWith(turn, 'toss', tossed);
    expect(tossed.drawn).toBe(2);
    expect(toss).toMatch(/^(Heads|Tails), and (Hello|Halloo|Who is there), you\.$/);
  });

  it('renders the same for the same seed, and reaches every choice across seeds', () => {
    const turn = proseTurn();
    const run = (seed: number) => drawnWith(turn, 'call', new Draws(seed));
    expect(run(99)).toEqual(run(99));
    const seen = new Set(Array.from({ length: 60 }, (_, seed) => run(seed)[0]));
    expect([...seen].sort()).toEqual([...CALLS].sort());
  });

  it('renders only a choice it holds, whatever the seed', () => {
    const turn = proseTurn();
    const c = chooser(5);
    for (let i = 0; i < 200; i++) {
      expect(CALLS).toContain(drawnWith(turn, 'call', new Draws(c.below(4_000_000_000)))[0]);
    }
  });

  it('renders the one choice of a `{one of}` that has one, drawing once for it', () => {
    const turn = proseTurn();
    const c = chooser(9);
    for (let i = 0; i < 20; i++) {
      const draws = new Draws(c.below(4_000_000_000));
      expect(drawnWith(turn, 'hum', draws)).toEqual(['Hmm, you.']);
      expect(draws.drawn).toBe(1);
    }
  });

  it('is the engine’s defect where nothing draws, which the checker refuses', () => {
    const turn = proseTurn();
    expect(() => drawnWith(turn, 'call', null)).toThrow(/where nothing draws/);
  });
});
