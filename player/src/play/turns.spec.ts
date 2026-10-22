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
    const stage = freshStage(bundle, { output: 12 });
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

describe('what a body did that nobody was told of', () => {
  const glade = bundleOf('glade', {
    'glade.sprout': `world glade is sprout.World {
  visitors are Person
  visitors arrive at lawn
  object lawn is sprout.Place {
    object pedestal is Pedestal { object gem is Gem }
    object horn is Horn
    object owl is Owl
    object crate is Crate
  }
  object loft is sprout.Place { }
}
verb touch { role target  "touch [target]" }
verb blow  { role target  "blow [target]" }
verb shoo  { role target  "shoo [target]" }
message :granted
message :called
`,
    'person.sprout': `kind Taker is sprout.Actor {
  on :granted { move lawn.pedestal.gem to self  tell "Yours." }
}
kind Person is Taker, sprout.Visitor { }
`,
    'pedestal.sprout': `kind Pedestal {
  contains
  release (item, to) { if (mover != self) { refuse "The pedestal keeps its gem." } }
  as target for touch { do { say "You touch it." send actor :granted } }
}
kind Gem { }
kind Horn { as target for blow { do { say "You blow it." send lawn.owl :called } } }
kind Owl is sprout.Actor {
  roams
  as target for shoo { do { say "The owl flies." move self to loft } }
  on :called { tell "The owl hoots." }
}
kind Crate {
  contains
  accept (item, from) { refuse "The crate is nailed shut." }
  as target for touch { do { say "You touch the crate." move lawn.horn to self } }
}
`,
  });

  it('is a warning after what the turn said: a handler’s refused move, by its guard and its words as written', () => {
    const stage = freshStage(glade);
    arrive(stage, 'Marta');
    const made = playStep(stage, { as: 'Marta', type: 'touch pedestal' }, 'stdin:2')!;
    expect(made.map((one) => [one.level, one.words ?? one.text])).toEqual([
      ['prose', 'You touch it.'],
      [
        'warning',
        'a refusal nobody read: Marta could not move lawn.pedestal.gem to Marta, ' +
          'lawn.pedestal\'s `release` refused with "The pedestal keeps its gem."',
      ],
    ]);
  });

  it('is a warning where a send reached nothing, by the name as written, and nothing where it reached', () => {
    const stage = freshStage(glade);
    arrive(stage, 'Marta');
    const heard = playStep(stage, { as: 'Marta', type: 'blow horn' }, 'stdin:2')!;
    expect(heard.map((one) => one.level)).toEqual(['prose', 'prose']);
    playStep(stage, { as: 'Marta', type: 'shoo owl' }, 'stdin:3');
    const lost = playStep(stage, { as: 'Marta', type: 'blow horn' }, 'stdin:4')!;
    expect(lost.map((one) => [one.level, one.words ?? one.text])).toEqual([
      ['prose', 'You blow it.'],
      [
        'warning',
        'a send reached nothing: lawn.horn sent :called to lawn.owl, which reaches nothing in its range now',
      ],
    ]);
  });

  it('is no warning where the one acting reads the refusal', () => {
    const stage = freshStage(glade);
    arrive(stage, 'Marta');
    const made = playStep(stage, { as: 'Marta', type: 'touch crate' }, 'stdin:2')!;
    expect(made.map((one) => [one.level, one.words ?? one.text])).toEqual([
      ['prose', 'You touch the crate.'],
      ['prose', 'The crate is nailed shut.'],
    ]);
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
    expect(fired![0]!.reading).toEqual({
      verb: 'kiln_yard.fire',
      actor: 'kiln_yard#1',
      bindings: [{ role: 'target', binds: 'object', id: 'kiln_yard.yard.kiln' }],
    });
    expect(fired![0]!.effects.map((effect) => effect.written)).toEqual([
      [{ line: 'kiln.sprout:5:54' }],
    ]);
    expect(refused![0]!.reading?.verb).toBe('kiln_yard.fire');
    expect(unread![0]!.reading).toBeNull();
    expect(comment).toEqual([]);
    // What a turn ran, was answered with or refused, as the engine accounts for it.
    const accounts = [fired, refused, unread, woken].map((turns) => turns![0]!.account);
    expect(accounts.map((account) => [account?.answered, account?.refused])).toEqual([
      [null, false],
      [null, true],
      ['unknown', false],
      [null, false],
    ]);
    expect(accounts[3]!.ran.map((ran) => ran.on)).toEqual(['woke']);
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

describe('a command that asks for time to pass', () => {
  const WELL = {
    'well.sprout': `world well is sprout.World {
  visitors are Person
  visitors arrive at bottom
  object bottom is sprout.Place {
    describe { text "A dry well." }
    object bucket is Bucket
  }
}
verb hoist { role target  "hoist [target]" }
verb await { role target  "wait for [target]" }
`,
    'person.sprout': 'kind Person is sprout.Visitor { }\n',
    'bucket.sprout': `kind Bucket {
  as target for hoist { do { wake in 20 minutes  say "Up it goes." } }
  as target for await { do { pass 2 hours  say "You wait." } }
  on :woke (elapsed) { tell "Down it comes." }
}
`,
  };

  it('is followed by that much time, lowered to the longest pass, its wakes told before the line’s next turn', () => {
    const stage = freshStage(bundleOf('well', WELL), { longestPassSeconds: 1800 });
    arrive(stage, 'Marta');
    const made = playStep(
      stage,
      { as: 'Marta', type: 'hoist bucket. wait for bucket. look' },
      's',
    )!;
    expect(made.map((one) => [one.level, one.text])).toEqual([
      ['prose', 'Marta (said): Up it goes.'],
      ['prose', 'Marta (said): You wait.'],
      ['info', 'passes: 1800 seconds'],
      ['info', 'bottom.bucket woke, 1200 seconds after it asked'],
      ['prose', 'Marta (told): Down it comes.'],
      ['prose', 'Marta (described): A dry well.'],
    ]);
    expect(stage.now).toBe(1800);
  });

  it('runs the line’s next turn at the instant the time passed to', () => {
    const stage = freshStage(bundleOf('well', WELL), { longestPassSeconds: 1800 });
    arrive(stage, 'Marta');
    playStep(stage, { as: 'Marta', type: 'wait for bucket. hoist bucket' }, 's');
    expect(stage.now).toBe(1800);
    const made = playStep(stage, { advance: '20 minutes' }, 's')!;
    expect(made.map((one) => one.text)).toEqual([
      'bottom.bucket woke, 1200 seconds after it asked',
      'Marta (told): Down it comes.',
    ]);
  });
});
