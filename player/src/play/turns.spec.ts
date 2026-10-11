import { describe, expect, it } from 'vitest';

import { arrive, freshStage, playStep, filledIn, playSteps, playScript } from '../play.js';
import { scriptOf } from '../fixtures/scripts.js';
import { bundleOf, LANE, RIVER } from '../fixtures/worlds.js';
import { bundle } from '../fixtures/play.js';

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
    const made = playStep(stage, { as: 'Marta', type: 'take key' }, 'stdin:2')!;
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
    playStep(stage, { as: 'Marta', type: 'take key' }, 'stdin:2');
    const made = playStep(stage, { as: 'Marta', type: 'open chest with key' }, 'stdin:3')!;
    expect(made.map((one) => [one.level, one.words ?? one.text])).toEqual([
      ['info', 'step: sprout.unlock'],
      ['prose', 'The lock turns over.'],
      ['info', 'step: sprout.open'],
      ['prose', 'You open a chest. It is empty.'],
    ]);
  });
});

describe('the turns a step ran', () => {
  it('trace every place that holds a visitor, from their own place out', () => {
    const river = bundleOf('river', RIVER);
    const played = playSteps(river, scriptOf('@arrive Marta\nMarta> go in'), 'river.json');
    expect(played[1]!.turns[0]!.standing).toEqual(['river.reach.boat', 'river.reach']);
  });

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
