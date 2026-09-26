import { describe, expect, it } from 'vitest';

import { visitKey } from '@overstory/sprout/lang';

import { HALL, MARTA } from '../fixtures/tally.js';
import { SaidEntry, saidEntry } from './said.js';

describe('a line said in the log', () => {
  const INES = visitKey('v-ines');
  const said = { from: MARTA, place: HALL, to: [MARTA, INES], text: 'shall we?', at: 7 };

  it('keeps who said it, who heard it, the place, the instant and the words', () => {
    const entry = saidEntry(said);
    expect(entry).toEqual({
      kind: 'said',
      now: 7,
      from: MARTA,
      place: HALL,
      to: [MARTA, INES],
      text: 'shall we?',
    });
    expect(SaidEntry.parse(entry)).toEqual(entry);
  });

  it('is heard by at least the speaker, and has words', () => {
    expect(SaidEntry.safeParse({ ...saidEntry(said), to: [] }).success).toBe(false);
    expect(SaidEntry.safeParse({ ...saidEntry(said), text: '' }).success).toBe(false);
  });

  it('refuses an instant that is not whole host seconds', () => {
    expect(() => saidEntry({ ...said, at: 0.5 })).toThrow(/whole seconds/);
  });
});
