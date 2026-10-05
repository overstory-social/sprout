import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { boundObject, BRASS_KEY, OAK_DOOR, PRESS, proseTurn } from '../fixtures/prose.js';
import { Draws } from '../runtime/draws.js';
import { engineLine } from '../runtime/engine-lines.js';
import type { InstanceId } from '../runtime/ids.js';
import type { Said } from '../runtime/reading.js';
import type { StateReader } from '../runtime/state.js';
import { renderHeard, type Heard } from './heard.js';
import { LineDraws } from './line-draws.js';

/** What each reader read, without where its words were written. */
function words(heard: readonly Heard[]): { reader: InstanceId; paragraphs: readonly string[] }[] {
  return heard.map(({ reader, paragraphs }) => ({ reader, paragraphs }));
}

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
    expect(words(renderHeard(told, turn.context))).toEqual([
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
    expect(words(renderHeard(told, turn.context))).toEqual([
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
  it('is heard as the NPC speaking, through the engine’s `npc_says`, as one quotation', () => {
    const turn = proseTurn();
    // The oak door stands in for an NPC, speaking a line the press's body said.
    const said = line(
      '{actor} leans on {self}.\n\nIt creaks.',
      [turn.marta, BRASS_KEY],
      OAK_DOOR,
      turn.marta,
    );
    expect(words(renderHeard(said, turn.context))).toEqual([
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

  it('is framed in the NPC’s own `npc_says`, where it words one', () => {
    const turn = proseTurn();
    const library = turn.draft.instance(turn.draft.world)!.kind.passages.get('npc_says')!;
    const text = '{actor} rasps, "{words}"';
    const own = {
      ...library,
      origin: 'mill.door',
      yields: false,
      body: { ...library.body, text, prose: engineLine(text).prose },
    };
    const door = turn.draft.instance(OAK_DOOR)!;
    const state: StateReader = {
      ...turn.draft,
      world: turn.draft.world,
      instance: (id) =>
        id === OAK_DOOR
          ? { ...door, kind: { ...door.kind, passages: new Map([['npc_says', own]]) } }
          : turn.draft.instance(id),
      children: (id) => turn.draft.children(id),
      visitor: (visit) => turn.draft.visitor(visit),
      tombstoned: (id) => turn.draft.tombstoned(id),
    };
    const said = line('Miaow.', [BRASS_KEY], OAK_DOOR, turn.marta);
    expect(words(renderHeard(said, { ...turn.context, state }))).toEqual([
      { reader: BRASS_KEY, paragraphs: ['An oak door rasps, "Miaow."'] },
    ]);
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
      expect(words(renderHeard(told, context)), String(seed)).toEqual([
        { reader: turn.marta, paragraphs: [`${call}, you.`] },
        { reader: BRASS_KEY, paragraphs: [`${call}, Marta.`] },
        { reader: OAK_DOOR, paragraphs: [`${call}, Marta.`] },
      ]);
      expect(draws.drawn, String(seed)).toBe(1);
    }
    expect(reached.size).toBe(CALLS.length);
  });
});

describe('where a line’s words were written', () => {
  it('is noted for each reader: the one-line passage, where its string stands', () => {
    const turn = proseTurn();
    const told = line('{actor} leans on {self}.', [turn.marta, BRASS_KEY], null, turn.marta);
    const heard = renderHeard(told, turn.context);
    expect(heard.map((one) => one.written)).toEqual([
      [{ line: 'the engine:1:1' }],
      [{ line: 'the engine:1:1' }],
    ]);
  });

  it('is the line, then the NPC’s `npc_says` passage that frames it', () => {
    const turn = proseTurn();
    const [heard] = renderHeard(line('Miaow.', [BRASS_KEY], OAK_DOOR, turn.marta), turn.context);
    expect(heard!.written).toEqual([
      { line: 'the engine:1:1' },
      { passage: 'npc_says', origin: 'sprout.World', at: 'sprout/world.sprout:27:11' },
    ]);
  });

  it('is nothing for a line that renders nothing, and is not noted in the context it was given', () => {
    const turn = proseTurn();
    const nothing: Said = {
      ...line('x', [turn.marta], null, turn.marta),
      said: { absent: 'gone' },
    };
    expect(renderHeard(nothing, turn.context)).toEqual([]);
    expect(turn.context.written).toBeUndefined();
  });
});
