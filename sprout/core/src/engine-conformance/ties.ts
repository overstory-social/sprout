import { equal, match, ok } from './check.js';
import { MARTA, played, seeded, storedIn, WEST, WEST_OF_HOUSE, type EngineCase } from './worlds.js';

// The suite's cases on a line the parser answers with a partial reading
// (the spec's Parsing › Choosing a reading; When nothing matches): the
// partial readings rank by nearness as whole readings do, so the visitor's
// own place is named only where nothing in it answers as well, and a tie
// still standing is drawn and logged as a warning.

/** Marta's `text`, typed with `seed`. */
const command = (text: string, seed: number) => ({
  visit: MARTA,
  text,
  seed,
  mayHold: null,
  now: 0,
});

/** The words of the one effect a turn told Marta. */
function told(effects: readonly unknown[]): string {
  const [one] = effects as readonly { readonly paragraphs?: readonly string[] }[];
  return one?.paragraphs?.join(' ') ?? '';
}

export const tieCases: EngineCase[] = [
  {
    name: 'a partial reading names the place only where nothing in it answers as well',
    proves:
      'a line read in part whose noun names both the visitor’s place and a thing in it is answered naming the thing under every seed, and nothing is drawn',
    async run(make) {
      const store = await seeded(WEST, [[MARTA, WEST_OF_HOUSE, 'Marta']]);
      const host = played(make, WEST);
      const stored = await storedIn(store);
      for (let seed = 0; seed < 8; seed++) {
        const step = host.engine!.command(stored, command('look behind house', seed));
        ok(step.turn.committed, `seed ${seed}: the line commits`);
        equal(step.turn.value, { answered: { drawn: null } }, `seed ${seed}: nothing drawn`);
        equal(
          told(step.turn.effects),
          "You can't look behind the white house.",
          `seed ${seed}: the words`,
        );
        match(step.entry, { kind: 'command', drawn: null }, `seed ${seed}: no warning logged`);
      }
    },
  },
  {
    name: 'a partial reading drawn from a tie is logged as a warning',
    proves:
      'a line read in part whose noun names two things equally near is answered naming one drawn from the turn’s seed, which varies with it, and the draw is noted and logged as a warning',
    async run(make) {
      const store = await seeded(WEST, [[MARTA, WEST_OF_HOUSE, 'Marta']]);
      const host = played(make, WEST);
      const stored = await storedIn(store);
      const named = new Set<string>();
      for (let seed = 0; seed < 8; seed++) {
        const step = host.engine!.command(stored, command('look behind bell', seed));
        ok(step.turn.committed, `seed ${seed}: the line commits`);
        equal(
          step.turn.value,
          { answered: { drawn: { among: 2 } } },
          `seed ${seed}: drawn among two`,
        );
        match(
          step.entry,
          { kind: 'command', drawn: { level: 'warning', among: 2 } },
          `seed ${seed}: the draw logged`,
        );
        named.add(told(step.turn.effects));
      }
      equal(
        [...named].sort(),
        ["You can't look behind the brass bell.", "You can't look behind the iron bell."],
        'each bell drawn under some seed',
      );
    },
  },
];
