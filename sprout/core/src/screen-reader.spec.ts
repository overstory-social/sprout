import { describe, expect, it } from 'vitest';

import { deliverWords, type WordsDelivery } from './delivery.js';
import { COLD, HALL, LANTERN, LOOKED, MARTA, PROJECTED } from './fixtures/showroom.js';
import { announce, URGENCY } from './screen-reader.js';

/** What Marta's screen reader speaks of what a turn told her. */
const spoken = (effects: Parameters<typeof deliverWords>[0]) =>
  announce(deliverWords(effects, MARTA));

describe('a screen reader', () => {
  it('interrupts with a refusal, which is all its turn says', () => {
    expect(spoken(COLD)).toEqual([
      { kind: 'refused', urgency: 'assertive', text: 'The lantern is cold.' },
    ]);
  });

  it('speaks everything else in order, an extension’s effect by its transcript line', () => {
    expect(spoken(PROJECTED)).toEqual([
      { kind: 'said', urgency: 'polite', text: 'The lantern throws a picture on the sheet.' },
      { kind: 'extension', urgency: 'polite', text: '[A slide: a ship in a storm]' },
    ]);
  });

  it('speaks a description one paragraph to a line', () => {
    expect(spoken(LOOKED)).toContainEqual({
      kind: 'described',
      urgency: 'polite',
      text: expect.stringContaining('A dark hall with a sheet hung at one end.'),
    });
  });

  it('speaks every delivery it is given, one announcement each, by its kind alone', () => {
    const kinds = Object.keys(URGENCY) as (keyof typeof URGENCY)[];
    const deliveries: WordsDelivery[] = kinds.map((kind, i) => {
      const parts = {
        as: 'words',
        from: LANTERN,
        actor: null,
        to: HALL,
        paragraphs: [`first ${i}`, `second ${i}`],
      } as const;
      return kind === 'extension'
        ? { ...parts, kind, recorded: { extension: 'slides', statement: 'show' } }
        : { ...parts, kind, recorded: null };
    });
    const said = announce(deliveries);
    expect(said.map((one) => one.kind)).toEqual(kinds);
    expect(said.map((one) => one.urgency)).toEqual(kinds.map((kind) => URGENCY[kind]));
    expect(said.every((one, i) => one.text === `first ${i}\nsecond ${i}`)).toBe(true);
    // Only a refusal interrupts.
    expect(kinds.filter((kind) => URGENCY[kind] === 'assertive')).toEqual(['refused']);
  });
});
