import { describe, expect, it } from 'vitest';

import type { Effect } from './effects.js';
import { effectsTo } from './effects.js';
import { visitKey, type InstanceId } from './ids.js';

const MARTA = visitKey('v-marta');
const INES = visitKey('v-ines');

/** A line said to `visit`. */
const to = (visit: typeof MARTA, words: string): Effect => ({
  kind: 'said',
  from: 'shop.hall' as InstanceId,
  actor: null,
  to: `shop#${visit}` as InstanceId,
  visit,
  paragraphs: [words],
  written: [],
});

describe('the effects one visitor reads', () => {
  it('are theirs alone, in the order the turn said them', () => {
    const effects = [to(MARTA, 'one'), to(INES, 'two'), to(MARTA, 'three')];
    expect(effectsTo(effects, MARTA).map((one) => one.paragraphs[0])).toEqual(['one', 'three']);
    expect(effectsTo(effects, visitKey('v-nobody'))).toEqual([]);
  });
});
