import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { boundObject, BRASS_KEY, OAK_DOOR, PRESS, proseTurn } from '../fixtures/prose.js';
import { Draws } from '../runtime/draws.js';
import { engineLine } from '../runtime/engine-lines.js';
import type { InstanceId } from '../runtime/ids.js';
import type { Said } from '../runtime/reading.js';
import { renderHeard } from './heard.js';
import { LineDraws } from './line-draws.js';

/** A line `by` the press, read by `to`, in words the engine reads as a one-line passage. */
function line(
  text: string,
  to: readonly InstanceId[],
  speaker: InstanceId | null,
  actor: InstanceId,
): Said {
  return {
    effect: speaker === null ? 'told' : 'said',
    to,
    by: PRESS,
    speaker,
    said: engineLine(text),
    bindings: new Map([['actor', boundObject(actor)]]),
  };
}

describe('a line is rendered once for each of its readers', () => {
  it('in the order it names them, each reading "you" for themself and a name for another', () => {
    const turn = proseTurn();
    const told = line('{actor} leans on {self}.', [turn.marta, BRASS_KEY], null, turn.marta);
    expect(renderHeard(told, turn.context)).toEqual([
      { reader: turn.marta, paragraphs: ['You leans on a press.'] },
      { reader: BRASS_KEY, paragraphs: ['Marta leans on a press.'] },
    ]);
  });

  it('leaves out a reader for whom it renders nothing', () => {
    const turn = proseTurn();
    const nothing: Said = {
      ...line('x', [turn.marta], null, turn.marta),
      said: { absent: 'gone' },
    };
    expect(renderHeard(nothing, turn.context)).toEqual([]);
    expect(renderHeard(line('{actor}', [], null, turn.marta), turn.context)).toEqual([]);
  });

  it('charges each reader for what they read, and nobody else', () => {
    const turn = proseTurn();
    renderHeard(line('{actor} leans.', [BRASS_KEY], null, turn.marta), turn.context);
    expect(turn.context.budget.spentOutput(BRASS_KEY)).toBe('Marta leans.'.length);
    expect(turn.context.budget.spentOutput(turn.marta)).toBe(0);
  });
});

describe('a line too long for someone other than the actor', () => {
  it('leaves them out of it, and the actor still reads it', () => {
    // The line fits "you", 21 characters, and not Marta's name, 23.
    const turn = proseTurn({ ...DEFAULT_LIMITS.budgets, output: 21 });
    const told = line('{actor} lean on it, hard.', [turn.marta, BRASS_KEY], null, turn.marta);
    expect(renderHeard(told, turn.context)).toEqual([
      { reader: turn.marta, paragraphs: ['You lean on it, hard.'] },
    ]);
    expect(turn.context.budget.cutShort).toEqual([BRASS_KEY]);
  });

  it('leaves out a hearer whom an NPC’s frame, and not the line, takes past their output', () => {
    const turn = proseTurn({ ...DEFAULT_LIMITS.budgets, output: 10 });
    const said = line('Miaow.', [BRASS_KEY], OAK_DOOR, turn.marta);
    expect(renderHeard(said, turn.context)).toEqual([]);
    expect(turn.context.budget.cutShort).toEqual([BRASS_KEY]);
  });
});

describe('a line an NPC says', () => {
  it('is heard as the NPC speaking, in the engine’s fixed words, as one quotation', () => {
    const turn = proseTurn();
    // The oak door stands in for an NPC, speaking a line the press's body said.
    const said = line(
      '{actor} leans on {self}.\n\nIt creaks.',
      [turn.marta, BRASS_KEY],
      OAK_DOOR,
      turn.marta,
    );
    expect(renderHeard(said, turn.context)).toEqual([
      { reader: turn.marta, paragraphs: ['An oak door says "You leans on a press. It creaks."'] },
      { reader: BRASS_KEY, paragraphs: ['An oak door says "Marta leans on a press. It creaks."'] },
    ]);
  });

  it('charges the frame to each reader with the words it holds', () => {
    const turn = proseTurn();
    const [heard] = renderHeard(line('Miaow.', [BRASS_KEY], OAK_DOOR, turn.marta), turn.context);
    expect(heard!.paragraphs).toEqual(['An oak door says "Miaow."']);
    expect(turn.context.budget.spentOutput(BRASS_KEY)).toBe([...heard!.paragraphs[0]!].length);
  });
});

describe('a `tell` in quotes that draws', () => {
  const CALLS = ['Hello', 'Halloo', 'Who is there'];

  it('is drawn once, and every reader reads that one draw', () => {
    const reached = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      const turn = proseTurn();
      const draws = new Draws(seed);
      const context = { ...turn.context, draws: new LineDraws(draws) };
      const told = line(
        '{one of}Hello{or}Halloo{or}Who is there{/one of}, {actor}.',
        [turn.marta, BRASS_KEY, OAK_DOOR],
        null,
        turn.marta,
      );
      const call = CALLS[new Draws(seed).below(3)]!;
      reached.add(call);
      expect(renderHeard(told, context), String(seed)).toEqual([
        { reader: turn.marta, paragraphs: [`${call}, you.`] },
        { reader: BRASS_KEY, paragraphs: [`${call}, Marta.`] },
        { reader: OAK_DOOR, paragraphs: [`${call}, Marta.`] },
      ]);
      expect(draws.drawn, String(seed)).toBe(1);
    }
    expect(reached.size).toBe(CALLS.length);
  });
});
