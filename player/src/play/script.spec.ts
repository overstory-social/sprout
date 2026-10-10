import { describe, expect, it } from 'vitest';

import { playScript } from '../play.js';
import { scriptOf, transcriptOf } from '../fixtures/scripts.js';
import { bundleOf, KILN_YARD } from '../fixtures/worlds.js';
import { bundle, play } from '../fixtures/play.js';

describe('playScript', () => {
  it('writes each line, then what every reader read of it, under their nickname and the kind', () => {
    expect(play('@arrive Marta\n@arrive Ines\nMarta> fire kiln\nMarta> fire kiln\n')).toBe(
      [
        '@arrive Marta',
        '  Marta (described): A kiln yard.',
        '@arrive Ines',
        '  Marta (notice): Ines arrives.',
        '  Ines (described): A kiln yard.',
        'Marta> fire kiln',
        '  Marta (said): The chamber takes the flame.',
        'Marta> fire kiln',
        '  Marta (refused): It is firing already.',
        '',
      ].join('\n'),
    );
  });

  it('keeps what the script is about and its comments, and fills each step’s `expect` afresh', () => {
    const played = playScript(
      bundle,
      {
        about: 'A walk.',
        steps: [
          { comment: 'in we go' },
          { arrive: 'Marta', expect: [{ words: 'whatever was here before' }] },
          { as: 'Marta', type: 'go in' },
        ],
      },
      'walk.json',
    );
    expect(played).toEqual({
      about: 'A walk.',
      steps: [
        { comment: 'in we go' },
        {
          arrive: 'Marta',
          expect: [{ reader: 'Marta', kind: 'described', words: 'A kiln yard.' }],
        },
        {
          as: 'Marta',
          type: 'go in',
          expect: [{ reader: 'Marta', kind: 'described', words: 'A dark shed.' }],
        },
      ],
    });
  });

  it('is its own golden: a script played again plays as written', () => {
    const script = scriptOf(
      '@arrive Marta\nMarta> fire kiln\n@tick\n@advance 2 hours\nMarta> look\n',
    );
    const once = playScript(bundle, script, 'yard.json');
    expect(playScript(bundle, once, 'yard.json')).toEqual(once);
  });

  it('expects a host line at its level: a note at info, a fault at error', () => {
    const played = playScript(
      bundle,
      scriptOf('@arrive Marta\nMarta> fire kiln\n@advance 2 hours\nMarta> kick kiln\n'),
      'yard.json',
    );
    const expected = played.steps.flatMap((step) => ('expect' in step ? (step.expect ?? []) : []));
    expect(expected).toContainEqual({
      level: 'info',
      text: 'yard.kiln woke, 3600 seconds after it asked',
    });
    expect(expected.filter((one) => 'level' in one && one.level === 'error')).toHaveLength(1);
  });

  it('ticks each place a visitor stands in, and says so where a tick says nothing', () => {
    expect(play('@arrive Marta\n@tick\nMarta> go in\n@tick\n')).toBe(
      [
        '@arrive Marta',
        '  Marta (described): A kiln yard.',
        '@tick',
        '  Marta (told): Smoke drifts.',
        'Marta> go in',
        '  Marta (described): A dark shed.',
        '@tick',
        '  (nothing)',
        '',
      ].join('\n'),
    );
  });

  it('delivers a wake live at the instant it falls due, while anyone is there', () => {
    const page = play(
      '@arrive Marta\nMarta> fire kiln\n@advance 59 minutes\n@advance 30 minutes\n',
    );
    expect(page).toContain('@advance 59 minutes\n  (nothing)\n');
    expect(page).toContain(
      '@advance 30 minutes\n  yard.kiln woke, 3600 seconds after it asked\n  Marta (told): The kiln ticks as it cools.\n',
    );
  });

  it('keeps a wake for the next arrival’s catch-up while nobody is there, which says nothing', () => {
    const page = play(
      '@arrive Marta\nMarta> fire kiln\n@leave Marta\n@advance 5 hours\n@arrive Marta\nMarta> fire kiln\n',
    );
    expect(page).toContain('@advance 5 hours\n  (nothing)\n');
    expect(page).toContain(
      '@arrive Marta\n  caught up: yard.kiln woke, 18000 seconds after it asked\n  Marta (described): A kiln yard.\n',
    );
    expect(page).toContain('Marta> fire kiln\n  Marta (said): The chamber takes the flame.\n');
  });

  it('gives every turn after `@seed` that seed, and writes nothing for the line itself', () => {
    const seeds = [0, 1, 2, 3, 4, 5, 6, 7];
    // Each is `@seed n`, `@tick`, its line, `@tick`, its line.
    const heard = seeds.map((seed) =>
      play(`@arrive Marta\n@seed ${seed}\n@tick\n@tick\n`).split('\n').slice(2, 7),
    );
    for (const [seed, lines] of heard.entries()) {
      expect(lines.slice(0, 2)).toEqual([`@seed ${seed}`, '@tick']);
      expect(lines[4], `seed ${seed}: each tick draws from the one seed`).toBe(lines[2]);
    }
    expect(new Set(heard.map((lines) => lines[2]))).toEqual(
      new Set(['  Marta (told): Smoke drifts.', '  Marta (told): The air is still.']),
    );
  });

  it('gives each place a tick reaches a turn of its own, seeded by its own path', () => {
    // The shed ticks as the yard does, so a shared seed would make both say the same.
    const twoYards = bundleOf('kiln_yard', {
      ...KILN_YARD,
      'kiln_yard.sprout': KILN_YARD['kiln_yard.sprout']!.replace(
        'object shed is sprout.Place {',
        'object shed is Yard {',
      ),
    });
    const told = (seed: number) =>
      transcriptOf(
        playScript(
          twoYards,
          scriptOf(`@arrive Marta\n@arrive Ines\nInes> go in\n@seed ${seed}\n@tick\n`),
          'yards.json',
        ),
      )
        .split('@tick\n')[1]!
        .trim()
        .split('\n')
        .map((line) => line.replace(/^\s*\w+ \(told\): /, ''));
    const differ = [0, 1, 2, 3, 4, 5, 6, 7].filter((seed) => {
      const [first, second] = told(seed);
      return first !== second;
    });
    expect(differ.length).toBeGreaterThan(0);
  });

  it('gives each wake an advance delivers a turn of its own, seeded by its own path', () => {
    // Two kilns fired together wake together, and each draws one of two lines as it cools.
    const twoKilns = bundleOf('kiln_yard', {
      ...KILN_YARD,
      'kiln_yard.sprout': KILN_YARD['kiln_yard.sprout']!.replace(
        'object kiln is Kiln',
        'object kiln is Kiln\n    object oven is Kiln',
      ),
      'kiln.sprout': KILN_YARD['kiln.sprout']!.replace(
        'tell "The kiln ticks as it cools."',
        'tell "{one of}It ticks as it cools.{or}It sighs as it cools.{/one of}"',
      ),
    });
    const told = (seed: number) =>
      transcriptOf(
        playScript(
          twoKilns,
          scriptOf(
            `@arrive Marta\nMarta> fire kiln\nMarta> fire oven\n@seed ${seed}\n@advance 2 hours\n`,
          ),
          'kilns.json',
        ),
      )
        .split('\n')
        .filter((line) => line.includes('as it cools.'));
    const differ = [0, 1, 2, 3, 4, 5, 6, 7].filter((seed) => {
      const [first, second] = told(seed);
      expect(second, `seed ${seed}: both kilns wake`).toBeDefined();
      return first !== second;
    });
    expect(differ.length).toBeGreaterThan(0);
  });

  it('leaves an object’s draws as they were when an unrelated clock is added and wakes first', () => {
    const cooling: Record<string, string> = {
      ...KILN_YARD,
      'kiln.sprout': KILN_YARD['kiln.sprout']!.replace(
        'tell "The kiln ticks as it cools."',
        'tell "{one of}It ticks as it cools.{or}It sighs as it cools.{or}It creaks as it cools.{/one of}"',
      ),
    };
    const alone = bundleOf('kiln_yard', cooling);
    // An oven of its own kind, fired first, so its wake comes before the kiln's.
    const withOven = bundleOf('kiln_yard', {
      ...cooling,
      'kiln_yard.sprout': cooling['kiln_yard.sprout']!.replace(
        'object kiln is Kiln',
        'object kiln is Kiln\n    object oven is Oven',
      ),
      'oven.sprout': `kind Oven is sprout.Fixture {
  as target for fire { do { wake in 1 hours  say "The oven roars." } }
  on :woke (elapsed) { tell "The oven goes quiet." }
}
`,
    });
    const cools = (world: typeof alone, fire: string, seed: number) =>
      transcriptOf(
        playScript(
          world,
          scriptOf(`@arrive Marta\n${fire}Marta> fire kiln\n@seed ${seed}\n@advance 2 hours\n`),
          'kiln.json',
        ),
      )
        .split('\n')
        .filter((line) => line.includes('as it cools.') || line.includes('goes quiet'));
    for (const seed of [0, 1, 2, 3, 4, 5, 6, 7]) {
      const [kiln] = cools(alone, '', seed);
      const [oven, kilnBeside] = cools(withOven, 'Marta> fire oven\n', seed);
      expect(oven, `seed ${seed}: the oven wakes first`).toContain('The oven goes quiet.');
      expect(kilnBeside, `seed ${seed}`).toBe(kiln);
    }
  });

  it('refuses a nickname the world’s words collide with, admitting nobody', () => {
    const page = play('@arrive kiln\n');
    expect(page).toMatch(/^@arrive kiln\n {2}nickname refused: /);
  });

  it('refuses a nickname the language reserves or one shaped like source, in the host’s words', () => {
    expect(play('@arrive When\n')).toBe(
      '@arrive When\n  nickname refused: "when" is a word every world here reads, so "When" would not always mean you: choose another nickname.\n',
    );
    expect(play('@arrive :marta\n')).toBe(
      '@arrive :marta\n  nickname refused: A nickname\'s word may not begin with a colon, and ":marta" does: choose another nickname.\n',
    );
  });

  it('throws, naming the step and what to write, for a step it cannot play', () => {
    expect(() => play('@arrive Marta\nInes> look\n')).toThrow(
      'yard.json, step 2: Ines is not in the world: write `@arrive Ines` first.',
    );
    expect(() => play('@arrive Marta\n@leave Marta\nMarta> look\n')).toThrow(
      'yard.json, step 3: Marta is not in the world',
    );
  });
});
