import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '../bundle/limits.js';
import {
  boundObject,
  BRASS_KEY,
  OAK_DOOR,
  PRESS,
  proseTurn,
  type ProseTurn,
} from '../fixtures/prose.js';
import { BudgetExhausted } from '../runtime/budget.js';
import type { Description } from '../runtime/describe.js';
import { Draws } from '../runtime/draws.js';
import type { EffectContext } from '../runtime/effects.js';
import { engineLine } from '../runtime/engine-lines.js';
import { visitKey, type InstanceId } from '../runtime/ids.js';
import type { Said } from '../runtime/reading.js';
import { renderEffects } from './effects.js';

const [MARTA, KEY] = [visitKey('v-marta'), visitKey('v-key')];

/** What rendering reads in `turn`, Marta and the brass key each a reader, and `actor` whose turn it is. */
function contextOf(
  turn: ProseTurn,
  draws = new Draws(7),
  actor: InstanceId | null = null,
): EffectContext {
  const { state, catalogue, passes, budget, nicknames } = turn.context;
  return {
    state,
    catalogue,
    passes,
    budget,
    nicknames,
    draws,
    visits: new Map([
      [turn.marta, MARTA],
      [BRASS_KEY, KEY],
    ]),
    actor,
  };
}

/** A line `effect` by the press, in the engine's words, read by `to`, with `actor` bound. */
function line(
  text: string,
  to: readonly InstanceId[],
  actor: InstanceId,
  effect: Said['effect'] = 'told',
  speaker: InstanceId | null = null,
): Said {
  return {
    effect,
    to,
    by: PRESS,
    speaker,
    said: engineLine(text),
    bindings: new Map([['actor', boundObject(actor)]]),
  };
}

describe('a turn’s lines, rendered as its effects', () => {
  it('are one effect for each reader of each line, in the order said', () => {
    const turn = proseTurn();
    const effects = renderEffects(
      [
        { said: line('You lean on {self}.', [turn.marta], turn.marta, 'said') },
        { said: line('{actor} leans on {self}.', [BRASS_KEY, turn.marta], turn.marta) },
        { said: line('It creaks.', [turn.marta], turn.marta, 'notice') },
      ],
      contextOf(turn, new Draws(7), turn.marta),
    );
    expect(effects.map((one) => [one.kind, one.visit, one.paragraphs])).toEqual([
      ['said', MARTA, ['You lean on a press.']],
      ['told', KEY, ['Marta leans on a press.']],
      ['told', MARTA, ['You leans on a press.']],
      ['notice', MARTA, ['It creaks.']],
    ]);
  });

  it('carry the object each came from, the actor, and the reader', () => {
    const turn = proseTurn();
    const [effect] = renderEffects(
      [{ said: line('Hm.', [BRASS_KEY], turn.marta) }],
      contextOf(turn, new Draws(7), turn.marta),
    );
    expect(effect).toEqual({
      kind: 'told',
      from: PRESS,
      actor: turn.marta,
      to: BRASS_KEY,
      visit: KEY,
      paragraphs: ['Hm.'],
    });
  });

  it('carry no actor where nobody acted, as in a tick', () => {
    const turn = proseTurn();
    const [effect] = renderEffects(
      [{ said: line('Wind.', [turn.marta], turn.marta) }],
      contextOf(turn),
    );
    expect(effect!.actor).toBeNull();
  });

  it('leave out a line nobody reads, and a reader it renders nothing for', () => {
    const turn = proseTurn();
    const draws = new Draws(7);
    const effects = renderEffects(
      [
        { said: line('{one of}Nobody{or}hears{/one of} this.', [], turn.marta, 'refused') },
        { said: { ...line('x', [turn.marta], turn.marta), said: { absent: 'press.prose' } } },
      ],
      contextOf(turn, draws),
    );
    expect(effects).toEqual([]);
    // A line nobody reads is never rendered, so it draws nothing.
    expect(draws.drawn).toBe(0);
  });

  it('frame what an NPC says for each reader', () => {
    const turn = proseTurn();
    const effects = renderEffects(
      [{ said: line('Miaow.', [turn.marta], turn.marta, 'said', OAK_DOOR) }],
      contextOf(turn),
    );
    expect(effects.map((one) => [one.kind, one.from, one.paragraphs])).toEqual([
      ['said', PRESS, ['An oak door says "Miaow."']],
    ]);
  });

  it('give a description as one effect to the one looking, from the thing described', () => {
    const turn = proseTurn();
    const described = (text: string): Said => ({
      ...line(text, [turn.marta], turn.marta, 'described'),
    });
    const description: Description = {
      of: PRESS,
      to: turn.marta,
      lines: [described('An iron press.'), described('It is cold.')],
      unremarkable: described('Nothing special.'),
    };
    expect(renderEffects([{ description }], contextOf(turn))).toEqual([
      {
        kind: 'described',
        from: PRESS,
        actor: null,
        to: turn.marta,
        visit: MARTA,
        paragraphs: ['An iron press.', 'It is cold.'],
      },
    ]);
  });

  it('give every reader of one line the same draw, after the draws the turn made', () => {
    const calls = ['Hello', 'Halloo', 'Who is there'];
    const reached = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      const turn = proseTurn();
      const draws = new Draws(seed);
      // The turn's bodies drew once before its lines were rendered.
      draws.below(5);
      const effects = renderEffects(
        [
          {
            said: line(
              '{one of}Hello{or}Halloo{or}Who is there{/one of}, {actor}.',
              [turn.marta, BRASS_KEY],
              turn.marta,
            ),
          },
        ],
        contextOf(turn, draws),
      );
      const stream = new Draws(seed);
      stream.below(5);
      const call = calls[stream.below(3)]!;
      reached.add(call);
      expect(
        effects.map((one) => one.paragraphs),
        String(seed),
      ).toEqual([[`${call}, you.`], [`${call}, Marta.`]]);
    }
    expect(reached.size).toBe(calls.length);
  });
});

describe('what each reader reads is charged to their own output', () => {
  const tight = (output: number) => proseTurn({ ...DEFAULT_LIMITS.budgets, output });

  it('so a line read by many costs each of them, and never adds up across them', () => {
    const turn = tight(12);
    const context = contextOf(turn);
    renderEffects([{ said: line('Tick tock.', [turn.marta, BRASS_KEY], turn.marta) }], context);
    expect(context.budget.spentOutput(turn.marta)).toBe('Tick tock.'.length);
    expect(context.budget.spentOutput(BRASS_KEY)).toBe('Tick tock.'.length);
  });

  it('and more than the host allows the turn’s actor faults the turn', () => {
    const turn = tight(12);
    const context = contextOf(turn, new Draws(7), turn.marta);
    const lines = [
      { said: line('Tick tock.', [turn.marta], turn.marta) },
      { said: line('Tick tock.', [turn.marta], turn.marta) },
    ];
    expect(() => renderEffects(lines, context)).toThrow(BudgetExhausted);
  });

  it('and anyone else it would take past it is cut short, reading nothing more, for everyone else unchanged', () => {
    const turn = tight(14);
    const context = contextOf(turn, new Draws(7), turn.marta);
    const effects = renderEffects(
      [
        { said: line('Tick tock.', [turn.marta, BRASS_KEY], turn.marta) },
        { said: line('Tick tock.', [BRASS_KEY], turn.marta) },
        { said: line('Hm.', [BRASS_KEY, turn.marta], turn.marta) },
      ],
      context,
    );
    // The key would have room for `Hm.`, and still reads nothing after the line that did not fit.
    expect(effects.map((one) => [one.visit, one.paragraphs])).toEqual([
      [MARTA, ['Tick tock.']],
      [KEY, ['Tick tock.']],
      [MARTA, ['Hm.']],
    ]);
    expect(context.budget.cutShort).toEqual([BRASS_KEY]);
  });

  it('and a turn with no actor never faults on it, whoever reads too much', () => {
    const turn = tight(12);
    const context = contextOf(turn);
    const lines = [
      { said: line('Tick tock.', [turn.marta], turn.marta) },
      { said: line('Tick tock.', [turn.marta], turn.marta) },
    ];
    expect(renderEffects(lines, context).map((one) => one.paragraphs)).toEqual([['Tick tock.']]);
    expect(context.budget.cutShort).toEqual([turn.marta]);
  });
});

describe('a reader who is not a visitor', () => {
  it('is the engine’s defect, since only a person reads', () => {
    const turn = proseTurn();
    expect(() =>
      renderEffects([{ said: line('Hm.', [OAK_DOOR], turn.marta) }], contextOf(turn)),
    ).toThrow(/is not a visitor/);
  });
});
