import { describe, expect, it } from 'vitest';

import {
  actorOf,
  BLANK,
  HALL,
  INES,
  LAMP,
  lookingAt,
  MARTA,
  MIRROR,
  renderingIn,
  STOOL,
  study,
} from '../fixtures/describe.js';
import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { Budget, BudgetExhausted } from '../runtime/budget.js';
import { describeFor } from '../runtime/describe.js';
import { engineLine } from '../runtime/engine-lines.js';
import { renderDescription } from './describe.js';

describe('a description, rendered', () => {
  it('is each line’s paragraphs in order, for the one looking', () => {
    const state = study();
    const marta = actorOf(state, MARTA);
    const heard = renderDescription(describeFor(LAMP, marta, lookingAt(state)), renderingIn(state));
    expect(heard).toEqual({
      reader: marta,
      paragraphs: ['The lamp is dark.', 'It hangs from a hook.'],
    });
  });

  it('names the one looking as "you", and anyone else by their name', () => {
    const state = study([
      [MARTA, HALL, 'Marta'],
      [INES, HALL, 'Ines'],
    ]);
    const marta = actorOf(state, MARTA);
    const seen = describeFor(MIRROR, marta, lookingAt(state));
    expect(renderDescription(seen, renderingIn(state)).paragraphs).toEqual([
      'The glass shows you, in a hall.',
    ]);
    const hall = describeFor(HALL, marta, lookingAt(state));
    expect(renderDescription(hall, renderingIn(state)).paragraphs).toEqual([
      'A long hall.',
      'A box stands by the wall.',
      'It is crowded, with 8 in it.',
    ]);
  });

  it('reads the world’s `unremarkable` where the thing has no describe, or where its lines render nothing', () => {
    const state = study();
    const marta = actorOf(state, MARTA);
    for (const [thing, words] of [
      [STOOL, 'There is nothing special about a stool.'],
      [BLANK, 'There is nothing special about a blank.'],
    ] as const) {
      const heard = renderDescription(
        describeFor(thing, marta, lookingAt(state)),
        renderingIn(state),
      );
      expect(heard.paragraphs, thing).toEqual([words]);
    }
    const shown = study(undefined, [[BLANK, 'shown', true]]);
    const card = describeFor(BLANK, actorOf(shown, MARTA), lookingAt(shown));
    expect(renderDescription(card, renderingIn(shown)).paragraphs).toEqual([
      'A card, now written on.',
    ]);
  });

  it('keeps no paragraph for a line that renders nothing, and reads the rest', () => {
    const state = study();
    const marta = actorOf(state, MARTA);
    const described = describeFor(LAMP, marta, lookingAt(state));
    const empty = { ...described.lines[0]!, said: engineLine('{if false}Never.{/if}') };
    const heard = renderDescription(
      { ...described, lines: [empty, described.lines[1]!] },
      renderingIn(state),
    );
    expect(heard.paragraphs).toEqual(['It hangs from a hook.']);
  });

  it('renders the same with no draws, as a poll does, and with a write turn’s', () => {
    const state = study();
    const described = describeFor(HALL, actorOf(state, MARTA), lookingAt(state));
    expect(renderDescription(described, renderingIn(state, 7))).toEqual(
      renderDescription(described, renderingIn(state)),
    );
  });

  it('is charged to the reader’s output, so a description too long for the actor faults as any line does', () => {
    const state = study();
    const marta = actorOf(state, MARTA);
    const described = describeFor(LAMP, marta, lookingAt(state));
    const tight = {
      ...renderingIn(state, null, marta),
      budget: new Budget({ ...DEFAULT_LIMITS.budgets, output: 10 }, 'poll'),
    };
    expect(() => renderDescription(described, tight)).toThrow(BudgetExhausted);
  });

  it('reads as nothing, not even `unremarkable`, to someone else it would take past their output', () => {
    const state = study();
    const marta = actorOf(state, MARTA);
    const described = describeFor(LAMP, marta, lookingAt(state));
    const tight = {
      ...renderingIn(state),
      budget: new Budget({ ...DEFAULT_LIMITS.budgets, output: 10 }),
    };
    expect(renderDescription(described, tight)).toEqual({ reader: marta, paragraphs: [] });
    expect(tight.budget.cutShort).toEqual([marta]);
    expect(tight.budget.spentOutput(marta)).toBe(0);
  });
});
