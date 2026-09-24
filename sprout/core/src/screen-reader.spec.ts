import { describe, expect, it } from 'vitest';

import { deliverWords, type WordsDelivery } from './delivery.js';
import {
  HALL,
  LANTERN,
  MARTA,
  showroom,
  showroomCatalogue,
  showroomHost,
  typed,
} from './fixtures/showroom.js';
import { announce, URGENCY } from './screen-reader.js';
import { runCommand } from './turns.js';

const catalogue = showroomCatalogue();
const host = showroomHost(catalogue);

/** What Marta's screen reader speaks of each line she types, one turn after another. */
async function spoken(...lines: string[]) {
  const store = await showroom(catalogue);
  const turns = [];
  for (const line of lines) {
    const turn = await runCommand(store, 'w', host, typed(MARTA, line));
    if (!turn.committed) throw new Error(turn.fault.detail);
    turns.push(announce(deliverWords(turn.effects, MARTA)));
  }
  return turns;
}

describe('a screen reader', () => {
  it('interrupts with a refusal, which is all its turn says', async () => {
    const [cold] = await spoken('project lantern');
    expect(cold).toEqual([{ kind: 'refused', urgency: 'assertive', text: 'The lantern is cold.' }]);
  });

  it('speaks everything else in order, an extension’s effect by its transcript line', async () => {
    const [, projected] = await spoken('light lantern', 'project lantern');
    expect(projected).toEqual([
      { kind: 'said', urgency: 'polite', text: 'The lantern throws a picture on the sheet.' },
      { kind: 'extension', urgency: 'polite', text: '[A slide: a ship in a storm]' },
    ]);
  });

  it('speaks a description one paragraph to a line', async () => {
    const [looked] = await spoken('look');
    expect(looked).toContainEqual({
      kind: 'described',
      urgency: 'polite',
      text: expect.stringContaining('A dark hall with a sheet hung at one end.'),
    });
  });

  it('speaks every delivery it is given, one announcement each, by its kind alone', () => {
    const kinds = Object.keys(URGENCY) as (keyof typeof URGENCY)[];
    const deliveries: WordsDelivery[] = kinds.map((kind, i) => ({
      kind,
      as: 'words',
      recorded: null,
      from: LANTERN,
      actor: null,
      to: HALL,
      paragraphs: [`first ${i}`, `second ${i}`],
    }));
    const said = announce(deliveries);
    expect(said.map((one) => one.kind)).toEqual(kinds);
    expect(said.map((one) => one.urgency)).toEqual(kinds.map((kind) => URGENCY[kind]));
    expect(said.every((one, i) => one.text === `first ${i}\nsecond ${i}`)).toBe(true);
    // Only a refusal interrupts.
    expect(kinds.filter((kind) => URGENCY[kind] === 'assertive')).toEqual(['refused']);
  });
});
