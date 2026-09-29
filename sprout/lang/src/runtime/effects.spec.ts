import { describe, expect, it } from 'vitest';

import { belfry, HALL, LOFT, WORLD } from '../fixtures/turns.js';
import { effectsTo, noticeLines, saidLines, SILENT, type Effect } from './effects.js';
import { boundObject, boundValue } from './evaluate.js';
import { visitKey, type InstanceId } from './ids.js';
import type { Notice } from './move.js';
import type { Said } from './reading.js';

const state = belfry();
const passage = (name: string) => state.instances.get(HALL)!.kind.passages.get(name)!;
const [marta, ines] = ['m', 'i'] as InstanceId[];
const walker = 'w' as InstanceId;

describe('what is said of someone moved between places', () => {
  it('is a notice from whoever words it to the place’s readers, with the one who moved as `item`', () => {
    const notices: Notice[] = [
      {
        notice: 'leaves',
        place: HALL,
        by: HALL,
        said: { passage: passage('leaves') },
        bindings: { item: walker, to: LOFT, way: 'up the ladder' },
        audience: [marta, ines],
      },
      {
        notice: 'arrives',
        place: LOFT,
        by: LOFT,
        said: { passage: passage('arrives') },
        bindings: { item: walker },
        audience: [ines],
      },
    ];
    const lines = noticeLines(notices);
    expect(lines.map((line) => [line.effect, line.by, line.to])).toEqual([
      ['notice', HALL, [marta, ines]],
      ['notice', LOFT, [ines]],
    ]);
    expect(lines[0]!.said).toEqual({ passage: passage('leaves') });
    expect(lines[0]!.speaker).toBeNull();
    // The place left or entered and the way are bound only where the move has them.
    expect([...lines[0]!.bindings]).toEqual([
      ['item', boundObject(walker)],
      ['to', boundObject(LOFT)],
      ['way', boundValue('up the ladder')],
    ]);
    expect([...lines[1]!.bindings]).toEqual([['item', boundObject(walker)]]);
  });

  it('leaves out the description, which the engine answers, and a notice nobody reads', () => {
    const notices: Notice[] = [
      {
        notice: 'leaves',
        place: HALL,
        by: HALL,
        said: { passage: passage('leaves') },
        bindings: { item: walker },
        audience: [],
      },
      { notice: 'described', place: LOFT, audience: [walker] },
    ];
    expect(noticeLines(notices)).toEqual([]);
  });
});

describe('what a turn says', () => {
  it('keeps its lines in the order said', () => {
    const line = (by: InstanceId): Said => ({
      effect: 'said',
      to: [marta],
      by,
      speaker: null,
      said: { absent: 'lamp.prose' },
      bindings: new Map(),
    });
    const [first, second] = [line(HALL), line(WORLD)];
    expect(saidLines([first, second])).toEqual([{ said: first }, { said: second }]);
  });

  it('is nothing, with no actor, for a turn that does not narrate', () => {
    expect(SILENT).toEqual({ actor: null, lines: [] });
  });

  it('is read by each person as the effects to them, in order', () => {
    const [m, i] = [visitKey('v-m'), visitKey('v-i')];
    const effect = (to: InstanceId, visit: typeof m, words: string): Effect => ({
      kind: 'told',
      from: HALL,
      actor: null,
      to,
      visit,
      paragraphs: [words],
      written: [],
    });
    const effects = [effect(marta, m, 'one'), effect(ines, i, 'two'), effect(marta, m, 'three')];
    expect(effectsTo(effects, m).map((one) => one.paragraphs[0])).toEqual(['one', 'three']);
    expect(effectsTo(effects, visitKey('v-nobody'))).toEqual([]);
  });
});
