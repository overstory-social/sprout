import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  catalogueOf,
  compileBundle,
  DEFAULT_BLESSED,
  DEFAULT_LIMITS,
  initialState,
  loadWorld,
  readStoredWorld,
  saveWorld,
  type Bundle,
  type StoredInstance,
  type StoredWorld,
} from '@overstory/sprout/lang';
import { describe, expect, it } from 'vitest';

import {
  actedBy,
  arrive,
  defaultVisitor,
  freshStage,
  heard,
  leave,
  playInteractive,
  playStep,
  filledIn,
  playSteps,
  playScript,
} from './play.js';
import { scriptOf, transcriptOf } from './fixtures/scripts.js';
import { readScript } from './script.js';
import { readWorld } from './world.js';
import { bundleOf, KILN_YARD, LANE } from './fixtures/worlds.js';

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

  it('gives each place a tick reaches a turn of its own, seeded after the one before it', () => {
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

  it('gives each wake an advance delivers a turn of its own, seeded after the one before it', () => {
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
        level: 'prose',
        text: 'Marta (described): A kiln yard.',
        words: 'A kiln yard.',
        kind: 'described',
        shown: 'A kiln yard.',
        reader: 'Marta',
      },
    ]);
    expect(aside!.made).toBeNull();
    expect(kicked!.made!.map((made) => [made.words === null, made.level])).toEqual([
      [false, 'prose'],
      [true, 'error'],
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
      {
        level: 'info',
        text: '(nothing)',
        words: null,
        kind: null,
        shown: '(nothing)',
        reader: null,
      },
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
        level: 'prose',
        text: 'Marta (described): A dark shed.',
        words: 'A dark shed.',
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
        level: 'prose',
        text: 'Marta (said): The chamber takes the flame.',
        words: 'The chamber takes the flame.',
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
        level: 'prose',
        text: 'Marta (said): The chamber takes the flame.',
        words: 'The chamber takes the flame.',
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
    // Prose, as play shows it, since the one at the door reads nothing else.
    expect(refused!.level).toBe('prose');
  });
});

describe('a reader cut short', () => {
  it('is a warning, after what the turn said, naming who and the host’s figure', () => {
    const fresh = freshStage(bundle);
    const stage = {
      ...fresh,
      host: { ...fresh.host, budgets: { ...fresh.host.budgets, output: 12 } },
    };
    arrive(stage, 'Marta');
    // Ines reads her 12 characters; Marta's 13 of `Ines arrives.` do not fit.
    expect(arrive(stage, 'Ines').map((made) => [made.level, made.text])).toEqual([
      ['prose', 'Ines (described): A kiln yard.'],
      ['warning', 'Marta was cut short: one turn may say 12 characters to any one person'],
    ]);
  });
});

describe('a line read one of several ways that tied', () => {
  it('is told which was meant before what it says, and the draw is a warning', () => {
    const lane = bundleOf('lane', LANE);
    const stage = freshStage(lane);
    arrive(stage, 'Marta');
    const made = playInteractive(stage, 'Marta> take key', 'stdin:2').made!;
    const taken = /^You take an? (brass|iron) key\.$/.exec(made[1]!.words ?? '')?.[1];
    expect(made.map((one) => [one.level, one.kind])).toEqual([
      ['prose', 'notice'],
      ['prose', 'said'],
      ['warning', null],
    ]);
    expect(made[0]!.words).toBe(`(a ${taken} key)`);
    expect(made[2]!.text).toBe('drawn: the line read 2 ways that tied, and one was drawn');
  });
});

describe('a line read as an intent', () => {
  const vault = bundleOf('vault', {
    'vault.sprout': `world vault is sprout.World {
  visitors are Walker
  visitors arrive at hall
  object hall is sprout.Place {
    object chest is Chest { :open false }
    object key is Key
  }
}
`,
    'walker.sprout': 'kind Walker is sprout.Visitor { }\n',
    'chest.sprout': 'kind Chest is sprout.Container, sprout.Lockable { }\n',
    'key.sprout': 'kind Key { }\n',
  });

  it('plays each step it planned as a turn, each told at info as it runs', () => {
    const stage = freshStage(vault);
    arrive(stage, 'Marta');
    playInteractive(stage, 'Marta> take key', 'stdin:2');
    const made = playInteractive(stage, 'Marta> open chest with key', 'stdin:3').made!;
    expect(made.map((one) => [one.level, one.words ?? one.text])).toEqual([
      ['info', 'step: sprout.unlock'],
      ['prose', 'The lock turns over.'],
      ['info', 'step: sprout.open'],
      ['prose', 'You open a chest. It is empty.'],
    ]);
  });
});

describe('the turns a step ran', () => {
  it('are traced in order, each with who typed what, what it did, and where everyone then stood', () => {
    const played = playSteps(
      bundle,
      scriptOf(
        '@arrive Marta\nMarta> fire kiln\nMarta> fire kiln\nMarta> xyzzy\n@advance 1 hours\n# done',
      ),
      'yard.json',
    );
    const [arrived, fired, refused, unread, woken, comment] = played.map((one) => one.turns);
    // A maintenance turn catches up before every arrival.
    expect(arrived!.map((turn) => turn.turn)).toEqual(['maintenance', 'arrival']);
    expect(arrived![1]!.standing).toEqual(['kiln_yard.yard']);
    expect(fired).toHaveLength(1);
    expect(fired![0]).toMatchObject({ turn: 'command', as: 'Marta', typed: 'fire kiln' });
    expect(fired![0]!.reading?.verb.name).toBe('fire');
    expect(fired![0]!.effects.map((effect) => effect.written)).toEqual([
      [{ line: 'kiln.sprout:5:54' }],
    ]);
    expect(refused![0]).toMatchObject({ refused: true, answered: null });
    expect(refused![0]!.reading?.verb.name).toBe('fire');
    expect(unread![0]).toMatchObject({ answered: 'unknown', reading: null, refused: false });
    expect(woken!.map((turn) => [turn.turn, turn.ran.map((ran) => ran.on)])).toEqual([
      ['wake', ['woke']],
    ]);
    expect(comment).toEqual([]);
  });

  it('trace a fault, and leave the reading of a turn that faulted untraced, since it was abandoned', () => {
    const [, kicked] = playSteps(bundle, scriptOf('@arrive Marta\nMarta> kick kiln'), 'yard.json');
    expect(
      kicked!.turns.map((turn) => [
        turn.turn,
        turn.faults.map((fault) => fault.name),
        turn.reading,
      ]),
    ).toEqual([['command', ['IntegerOverflow'], null]]);
  });
});

describe('filledIn', () => {
  it('is the script with each step that played expecting all it made, as playScript gives it', () => {
    const script = scriptOf('@arrive Marta\n@seed 3\nMarta> fire kiln');
    expect(filledIn(script, playSteps(bundle, script, 'yard.json'))).toEqual(
      playScript(bundle, script, 'yard.json'),
    );
  });
});

describe('the stored worlds the C runtime reads and writes back', () => {
  const corpus = join(dirname(fileURLToPath(import.meta.url)), '../../corpus');
  const file = join(corpus, 'goldens/stored-worlds.json');
  /** Most states one transcript contributes: its first, its last, and evenly between. */
  const PER_TRANSCRIPT = 6;

  /** A corpus world, compiled as publishing compiles it. */
  const worldBundle = (name: string): Bundle => {
    const read = readWorld(join(corpus, 'good', name));
    return compileBundle(read.source!, { mode: 'publish', blessed: DEFAULT_BLESSED }).bundle!;
  };

  /** A stored world in the canonical bytes: keys in the schema's order. */
  const canonical = (state: Parameters<typeof saveWorld>[0]): string =>
    JSON.stringify(readStoredWorld(saveWorld(state)));

  const dumps = (): string => {
    const initial: string[] = [];
    const played: string[] = [];
    for (const name of readdirSync(join(corpus, 'good')).sort()) {
      const bundle = worldBundle(name);
      initial.push(
        `${JSON.stringify(name)}:${canonical(initialState(catalogueOf(bundle, DEFAULT_LIMITS.caps)))}`,
      );
      const folder = join(corpus, 'good', name, 'transcripts');
      if (!existsSync(folder)) continue;
      for (const transcript of readdirSync(folder).sort()) {
        const script = readScript(readFileSync(join(folder, transcript), 'utf8'), transcript);
        const stage = freshStage(bundle);
        const states = script.steps.map((step, i) => {
          playStep(stage, step, `${transcript}, step ${i + 1}`);
          return canonical(stage.state);
        });
        const distinct = states
          .map((text, step) => ({ text, step }))
          .filter(({ text }, i, all) => i === 0 || text !== all[i - 1]!.text);
        const chosen = new Set<number>();
        for (let k = 0; k < Math.min(PER_TRANSCRIPT, distinct.length); k++) {
          chosen.add(Math.round((k * (distinct.length - 1)) / Math.max(1, PER_TRANSCRIPT - 1)));
        }
        for (const at of [...chosen].sort((a, b) => a - b)) {
          const { text, step } = distinct[at]!;
          played.push(
            `{"world":${JSON.stringify(name)},"transcript":${JSON.stringify(transcript)},"step":${step + 1},"stored":${text}}`,
          );
        }
      }
    }
    return `{\n"initial":{\n${initial.join(',\n')}\n},\n"played":[\n${played.join(',\n')}\n]\n}\n`;
  };

  it('is the golden: regenerate with SPROUT_WRITE_GOLDENS=1 and read the diff', () => {
    const text = dumps();
    if (process.env['SPROUT_WRITE_GOLDENS'] === '1') writeFileSync(file, text);
    expect(text).toBe(readFileSync(file, 'utf8'));
  }, 120_000);
  it('is the reopened golden: stored worlds edited against the world, as load reconciles them', () => {
    type Mutable<T> = { -readonly [K in keyof T]: T[K] };
    type Edit = (stored: Mutable<StoredWorld>, instances: Mutable<StoredInstance>[]) => boolean;
    const live = (instances: Mutable<StoredInstance>[]) =>
      instances.filter(
        (one) => one.made.from !== 'visitor' && Object.keys(one.properties).length > 0,
      );
    const edits: [string, Edit][] = [
      [
        'a declared object with nothing stored',
        (stored, instances) => {
          const gone = instances.find(
            (one) => one.made.from === 'declared' && !instances.some((o) => o.container === one.id),
          );
          if (gone === undefined) return false;
          stored.instances = instances.filter((one) => one !== gone);
          return true;
        },
      ],
      [
        'a property stored under another type',
        (_stored, instances) => {
          const one = live(instances)[0];
          if (one === undefined) return false;
          const name = Object.keys(one.properties)[0]!;
          one.properties = {
            ...one.properties,
            [name]: { ...one.properties[name]!, type: 'bogus' },
          };
          return true;
        },
      ],
      [
        'a property the kind does not declare, and a memory of one',
        (_stored, instances) => {
          const one = instances[0]!;
          one.properties = { ...one.properties, ghost: { type: 'integer', value: 1 } };
          one.memory = { ...one.memory, [one.id]: { ghost: { type: 'integer', value: 2 } } };
          return true;
        },
      ],
      [
        'an integer past its range and a list with a repeat',
        (_stored, instances) => {
          const one = live(instances).find((o) =>
            Object.values(o.properties).some((p) => p.type === 'integer'),
          );
          if (one === undefined) return false;
          const name = Object.keys(one.properties).find(
            (n) => one.properties[n]!.type === 'integer',
          )!;
          one.properties = { ...one.properties, [name]: { type: 'integer', value: 4_000_000_000 } };
          return true;
        },
      ],
      [
        'a spawn of a kind the world does not declare',
        (stored, instances) => {
          stored.serial += 1;
          stored.instances = [
            ...instances,
            {
              id: `${stored.world}#${stored.serial}`,
              made: { from: 'spawned', kind: `${stored.world}.Nowhere` },
              container: stored.world,
              arrival: stored.serial,
              properties: { odd: { type: 'integer', value: 7 } },
              links: {},
              wakes: [],
              memory: {},
              lastTick: null,
            },
          ];
          return true;
        },
      ],
      [
        'a destroyed declared object',
        (stored, instances) => {
          const leaf = instances.find(
            (one) => one.made.from === 'declared' && !instances.some((o) => o.container === one.id),
          );
          if (leaf === undefined) return false;
          stored.instances = instances.filter((one) => one !== leaf);
          stored.tombstones = [...stored.tombstones, leaf.id].sort();
          return true;
        },
      ],
      [
        'a reading of a verb the world does not declare',
        (stored) => {
          if (stored.visitors.length === 0) return false;
          stored.visitors = stored.visitors.map((v, i) =>
            i === 0
              ? { ...v, lastReading: { verb: { library: 'gone', name: 'nothing' }, bindings: [] } }
              : v,
          );
          return true;
        },
      ],
    ];
    const cases: string[] = [];
    for (const name of readdirSync(join(corpus, 'good')).sort()) {
      const folder = join(corpus, 'good', name, 'transcripts');
      if (!existsSync(folder)) continue;
      const bundle = worldBundle(name);
      const catalogue = catalogueOf(bundle, DEFAULT_LIMITS.caps);
      const transcript = readdirSync(folder).sort()[0]!;
      const script = readScript(readFileSync(join(folder, transcript), 'utf8'), transcript);
      const stage = freshStage(bundle);
      script.steps.forEach((step, i) => playStep(stage, step, `${transcript}, step ${i + 1}`));
      const saved: StoredWorld = readStoredWorld(saveWorld(stage.state));
      for (const [what, edit] of edits) {
        const stored = JSON.parse(JSON.stringify(saved)) as Mutable<StoredWorld>;
        if (!edit(stored, [...stored.instances] as Mutable<StoredInstance>[])) continue;
        const input = readStoredWorld(stored);
        const loaded = loadWorld(input, catalogue);
        cases.push(
          JSON.stringify({
            world: name,
            edit: what,
            input,
            saved: readStoredWorld(saveWorld(loaded.state)),
            created: loaded.created,
            dormant: loaded.dormant,
            dropped: loaded.dropped.map((d) => [d.id, d.property, d.actor, d.why]),
            stranded: loaded.stranded,
          }),
        );
      }
    }
    const text = `[\n${cases.join(',\n')}\n]\n`;
    const reopened = join(corpus, 'goldens/stored-reopened.json');
    if (process.env['SPROUT_WRITE_GOLDENS'] === '1') writeFileSync(reopened, text);
    expect(text).toBe(readFileSync(reopened, 'utf8'));
  }, 120_000);
});
