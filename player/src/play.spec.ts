import { describe, expect, it } from 'vitest';

import {
  actedBy,
  arrive,
  defaultVisitor,
  freshStage,
  heard,
  leave,
  playInteractive,
  playSteps,
  playScript,
} from './play.js';
import { scriptOf, transcriptOf } from './fixtures/scripts.js';
import { bundleOf, KILN_YARD } from './fixtures/worlds.js';

const bundle = bundleOf('kiln_yard', KILN_YARD);
const play = (lines: string): string =>
  transcriptOf(playScript(bundle, scriptOf(lines), 'yard.json'));

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

describe('playSteps', () => {
  it('gives each step what it made, marking what a reader read and what faulted', () => {
    const played = playSteps(
      bundle,
      scriptOf('@arrive Marta\n# aside\nMarta> kick kiln\n'),
      'yard.json',
    );
    const [arrived, aside, kicked] = played;
    expect(arrived!.made).toEqual([
      {
        text: 'Marta (described): A kiln yard.',
        words: 'A kiln yard.',
        fault: false,
        kind: 'described',
        shown: 'A kiln yard.',
        reader: 'Marta',
      },
    ]);
    expect(aside!.made).toBeNull();
    expect(kicked!.made!.map((made) => [made.words === null, made.fault])).toEqual([
      [false, false],
      [true, true],
    ]);
    expect(kicked!.made!.map((made) => [made.shown, made.reader])).toEqual([
      [kicked!.made![0]!.words, 'Marta'],
      ['[error] IntegerOverflow', null],
    ]);
    expect(kicked!.made![1]!.text).toMatch(/^the command faulted, IntegerOverflow: /);
  });

  it('gives `@seed` nothing made, and a step that made nothing an empty list the transcript writes as (nothing)', () => {
    const played = playSteps(
      bundle,
      scriptOf('@seed 3\n@arrive Marta\nMarta> go in\n@tick\n'),
      'yard.json',
    );
    expect(played.map((one) => one.made?.length ?? null)).toEqual([null, 1, 1, 0]);
    expect(heard([])).toEqual([
      { text: '(nothing)', words: null, fault: false, kind: null, shown: null, reader: null },
    ]);
  });
});

describe('freshStage', () => {
  it('is a world as it loads, at time 0, seed 0, nobody yet arrived', () => {
    const stage = freshStage(bundle);
    expect(stage.now).toBe(0);
    expect(stage.seed).toBe(0);
    expect(stage.visits.size).toBe(0);
    expect(defaultVisitor(stage)).toBeNull();
  });
});

describe('arrive', () => {
  it('seats a returning visitor at the place `at` names, its `accept` asked as a returning visitor’s is', () => {
    const stage = freshStage(bundle);
    expect(arrive(stage, 'Marta', 'shed')).toEqual([
      {
        text: 'Marta (described): A dark shed.',
        words: 'A dark shed.',
        fault: false,
        kind: 'described',
        shown: 'A dark shed.',
        reader: 'Marta',
      },
    ]);
  });

  it('throws where `at` names no place, or does not seat them there, since both are a bad --at', () => {
    expect(() => arrive(freshStage(bundle), 'Marta', 'nowhere')).toThrow(
      '`nowhere` is not a place in kiln_yard',
    );
  });
});

describe('defaultVisitor', () => {
  it('names whoever most recently arrived and still stands, falling back once they leave', () => {
    const stage = freshStage(bundle);
    expect(defaultVisitor(stage)).toBeNull();
    arrive(stage, 'Marta');
    expect(defaultVisitor(stage)).toBe('Marta');
    arrive(stage, 'Ines');
    expect(defaultVisitor(stage)).toBe('Ines');
  });

  it('moves a returning nickname to the front again, ahead of who stood while they were away', () => {
    const stage = freshStage(bundle);
    arrive(stage, 'Marta');
    leave(stage, 'Marta', 'test');
    arrive(stage, 'Ines');
    expect(defaultVisitor(stage)).toBe('Ines');
    arrive(stage, 'Marta');
    expect(defaultVisitor(stage)).toBe('Marta');
  });
});

describe('playInteractive', () => {
  it('reads a `Name> text` line exactly as the script grammar does', () => {
    const stage = freshStage(bundle);
    arrive(stage, 'Marta');
    const outcome = playInteractive(stage, 'Marta> fire kiln', 'stdin:2');
    expect(outcome.line).toBe('Marta> fire kiln');
    expect(outcome.step).toEqual({ as: 'Marta', type: 'fire kiln' });
    expect(outcome.made).toEqual([
      {
        text: 'Marta (said): The chamber takes the flame.',
        words: 'The chamber takes the flame.',
        fault: false,
        kind: 'said',
        shown: 'The chamber takes the flame.',
        reader: 'Marta',
      },
    ]);
  });

  it('reads a host line and a comment as steps, and a blank line as none, the comment and blank making nothing', () => {
    const stage = freshStage(bundle);
    arrive(stage, 'Marta');
    expect(playInteractive(stage, '# aside', 'stdin:2')).toEqual({
      line: '# aside',
      step: { comment: 'aside' },
      made: null,
    });
    expect(playInteractive(stage, '', 'stdin:3')).toEqual({ line: '', step: null, made: null });
    const ticked = playInteractive(stage, '@tick', 'stdin:4');
    expect(ticked.step).toEqual({ tick: true });
    expect(ticked.made).not.toBeNull();
  });

  it('throws, naming where and what to write, for a line none of the grammar reads', () => {
    const stage = freshStage(bundle);
    arrive(stage, 'Marta');
    expect(() => playInteractive(stage, '@dance', 'stdin:2')).toThrow(
      'stdin:2: `@dance` is not something the host does here.',
    );
    expect(() => playInteractive(stage, '@advance soon', 'stdin:3')).toThrow(
      'stdin:3: write how long passes, as in `@advance 40 minutes`.',
    );
  });

  it('fills in a bare line’s addressee, and throws naming where, where nobody stands to address it', () => {
    const stage = freshStage(bundle);
    arrive(stage, 'Marta');
    const outcome = playInteractive(stage, 'fire kiln', 'stdin:2');
    expect(outcome.line).toBe('Marta> fire kiln');
    expect(outcome.step).toEqual({ as: 'Marta', type: 'fire kiln' });
    expect(outcome.made).toEqual([
      {
        text: 'Marta (said): The chamber takes the flame.',
        words: 'The chamber takes the flame.',
        fault: false,
        kind: 'said',
        shown: 'The chamber takes the flame.',
        reader: 'Marta',
      },
    ]);
    expect(() => playInteractive(freshStage(bundle), 'look', 'stdin:1')).toThrow(
      'stdin:1: nobody is standing to hear it',
    );
  });
});

describe('actedBy', () => {
  it('is the world’s `acted` for someone else’s line, as the one watching reads it', () => {
    const stage = freshStage(bundle);
    arrive(stage, 'Marta');
    arrive(stage, 'Ines');
    playInteractive(stage, 'Marta> fire kiln', 'stdin:3');
    expect(actedBy(stage, 'Ines', 'Marta', 'fire kiln')).toEqual(['Marta tries to fire kiln.']);
  });

  it('is the typed line itself where the one watching has never visited', () => {
    const stage = freshStage(bundle);
    arrive(stage, 'Marta');
    expect(actedBy(stage, 'Ines', 'Marta', 'fire kiln')).toEqual(['Marta: fire kiln']);
  });
});

describe('a refusal at the door', () => {
  it('is shown at the console whoever it refused, in its own words', () => {
    const stage = freshStage(bundle);
    arrive(stage, 'Marta');
    const [refused] = arrive(stage, 'fire');
    expect(refused!.text).toMatch(/^nickname refused: /);
    expect(refused!.words).toBeNull();
    expect(refused!.reader).toBeNull();
    expect(refused!.text).toBe(`nickname refused: ${refused!.shown}`);
  });
});
