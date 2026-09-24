import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS, type RuntimeBudgets } from '../bundle/limits.js';
import {
  actorOf,
  BELL,
  CATALOGUE,
  belfry,
  COIN,
  belfryHost,
  DOG,
  DRUM,
  FAULT,
  GONG,
  HALL,
  heldIn,
  INES,
  MARTA,
  parseBelfry,
  STONE,
  toldBy,
  typed,
} from '../fixtures/turns.js';
import { NOTHING, words } from '../fixtures/reading.js';
import {
  INES as INES_WAYS,
  LADDER,
  LAMP,
  LOFT,
  MARTA as MARTA_WAYS,
  MEADOW,
  MOUTH,
  SHOP,
  ways,
  waysHost,
  YARD,
} from '../fixtures/exits.js';
import { commandTurn, type CommandTurn, type Parser } from './command.js';
import { Draws } from './draws.js';
import type { InstanceId } from './ids.js';
import { loadWorld, saveWorld } from './load.js';
import type { WorldState } from './state.js';

const run = (state: WorldState, text: string, budgets?: RuntimeBudgets, parse?: Parser) =>
  commandTurn(state, belfryHost(budgets, parse), typed(MARTA, text));

function committed(turn: CommandTurn) {
  if (!turn.committed) throw new Error(`faulted: ${turn.fault.name}: ${turn.fault.detail}`);
  return turn;
}

function faulted(turn: CommandTurn) {
  if (turn.committed) throw new Error('the turn committed');
  return turn;
}

describe('a command turn runs in a fixed order', () => {
  it('parses, then the actor’s part, then each role’s, then the queue', () => {
    const state = belfry();
    const marta = actorOf(state, MARTA);
    const turn = committed(run(state, 'ring bell'));
    expect(toldBy(turn, marta).map((line) => line.words)).toEqual([
      'You pull the rope.',
      'The bell sounds.',
      // Heard from the dog, stirred by the bell's handler once the queue drained.
      'The dog sniffs at the bell.',
    ]);
    expect(heldIn(turn.state, marta, 'done')).toBe(1);
    expect(heldIn(turn.state, DOG, 'sniffs')).toBe(1);
  });

  it('delivers nothing until the whole effect pass has run', () => {
    // The actor sends `:rung` before the bell's own part strikes it, and
    // the bell's handler still reads it struck.
    const turn = committed(run(belfry(), 'ring bell'));
    expect(heldIn(turn.state, BELL, 'struck')).toBe(true);
    expect(heldIn(turn.state, BELL, 'heard_struck')).toBe(true);
  });

  it('marks the view of everyone present stale once it commits, and nobody away', () => {
    const turn = committed(
      commandTurn(belfry([MARTA], true), belfryHost(), typed(MARTA, 'tap stone')),
    );
    expect(turn.stale).toEqual([MARTA]);
    expect(turn.state.visitors.has(INES)).toBe(true);
  });

  it('is the refusal alone where the consent pass refuses, and writes nothing', () => {
    const state = belfry();
    const turn = committed(run(state, 'ring muffled'));
    expect(toldBy(turn, actorOf(state, MARTA))).toEqual([
      { to: [actorOf(state, MARTA)], words: 'The bell is wrapped in felt.' },
    ]);
    expect(turn.changes).toEqual({
      serial: state.serial,
      upsert: [],
      remove: [],
      tombstones: [],
      visitors: [],
    });
  });

  it('is the parser’s answer alone where the words make no reading', () => {
    const state = belfry();
    const turn = committed(run(state, 'juggle the bell'));
    expect(toldBy(turn, actorOf(state, MARTA))).toEqual([
      {
        to: [actorOf(state, MARTA)],
        words: 'sprout.World unknown: That is not something you can do here.',
      },
    ]);
    expect(turn.changes.upsert).toEqual([]);
  });

  it('answers a command that said nothing with `nothing_happens`, and keeps what it did', () => {
    const turn = committed(run(belfry(), 'tap stone'));
    expect(toldBy(turn, actorOf(turn.state, MARTA)).map((line) => line.words)).toEqual([NOTHING]);
    expect(heldIn(turn.state, STONE, 'taps')).toBe(1);
  });
});

describe('a command turn that faults', () => {
  it('abandons every write, the actor’s and a spawn included, and tells the actor', () => {
    const state = belfry();
    const before = saveWorld(state);
    const marta = actorOf(state, MARTA);
    const turn = faulted(run(state, 'strike gong'));
    expect(turn.fault).toMatchObject({ name: 'IntegerOverflow', object: null, engine: false });
    expect(toldBy(turn, marta)).toEqual([{ to: [marta], words: FAULT }]);
    expect(turn.told).toMatchObject({ effect: 'notice', by: state.world, speaker: null });
    expect(saveWorld(state)).toEqual(before);
    // The next turn starts from the world as it was: the serial the spawn
    // drew is drawn again, and the count starts again from nothing.
    const next = committed(run(state, 'ring bell'));
    expect(next.state.serial).toBe(state.serial);
    expect(heldIn(next.state, marta, 'done')).toBe(1);
    expect(heldIn(next.state, GONG, 'dents')).toBe(0);
  });

  it('abandons the effect pass’s writes when the queue faults after it', () => {
    const state = belfry();
    const turn = faulted(run(state, 'beat drum'));
    expect(turn.fault).toMatchObject({ name: 'BudgetExhausted', engine: false });
    expect(turn.fault.detail).toContain('cascade');
    expect(heldIn(state, DRUM, 'beats')).toBe(0);
  });

  it('charges parsing to the turn’s steps, so a command too costly to read faults', () => {
    const turn = faulted(run(belfry(), 'ring bell', { ...DEFAULT_LIMITS.budgets, steps: 1 }));
    expect(turn.fault).toMatchObject({ name: 'BudgetExhausted', engine: false });
    expect(turn.fault.detail).toContain('steps');
  });

  it('tells the actor of the engine’s own defect the same way, marked for the host', () => {
    const state = belfry([MARTA, INES]);
    const ines = actorOf(state, INES);
    // A parser that reads Marta's words as Ines's.
    const asInes: Parser = (text, _actor, context) => parseBelfry(text, ines, context);
    const turn = faulted(run(state, 'ring bell', undefined, asInes));
    expect(turn.fault.engine).toBe(true);
    expect(toldBy(turn, actorOf(state, MARTA))).toEqual([
      { to: [actorOf(state, MARTA)], words: FAULT },
    ]);
  });
});

describe('a command from someone not in the world', () => {
  it('is the host’s defect, thrown before any turn opens', () => {
    expect(() => commandTurn(belfry([]), belfryHost(), typed(MARTA, 'ring bell'))).toThrow(
      'has never visited',
    );
    expect(() => commandTurn(belfry([], true), belfryHost(), typed(INES, 'ring bell'))).toThrow(
      'is not in this world',
    );
  });
});

describe('a command from someone whose place is gone', () => {
  /** The belfry with Marta stored standing in an attic nothing declares now. */
  const stranded = (): WorldState => {
    const saved = saveWorld(belfry());
    const marta = actorOf(belfry(), MARTA);
    const instances = saved.instances.map((one) =>
      one.id === marta ? { ...one, container: 'belfry.attic' } : one,
    );
    return loadWorld({ ...saved, instances }, CATALOGUE).state;
  };

  it('displaces them to the arrival place, told through `displaced`, and reads nothing they typed', () => {
    const state = stranded();
    const turn = committed(run(state, 'ring bell'));
    expect('displaced' in turn.value).toBe(true);
    expect(toldBy(turn, actorOf(state, MARTA))).toEqual([
      {
        to: [actorOf(state, MARTA)],
        words: 'sprout.World displaced: The place you were standing is gone.',
      },
    ]);
    expect(turn.state.instances.get(actorOf(state, MARTA))!.container).toBe(HALL);
    expect(heldIn(turn.state, BELL, 'struck')).toBe(false);
  });
});

describe('no command turn ends with nothing said to the one who typed it', () => {
  const verbs = ['ring', 'strike', 'beat', 'tap', 'sniff'];
  const nouns = ['bell', 'gong', 'drum', 'muffled', 'stone', 'dog', 'loft'];
  const texts = [
    ...verbs.flatMap((verb) => nouns.map((noun) => `${verb} ${noun}`)),
    '',
    'ring',
    'ring the bell',
    'xyzzy',
  ];
  const budgets: RuntimeBudgets[] = [
    DEFAULT_LIMITS.budgets,
    { ...DEFAULT_LIMITS.budgets, steps: 12 },
    { ...DEFAULT_LIMITS.budgets, events: 1 },
    { ...DEFAULT_LIMITS.budgets, cascadeDepth: 1 },
    { ...DEFAULT_LIMITS.budgets, spawnsPerTurn: 0 },
  ];
  it(`holds for ${texts.length * budgets.length} commands under ${budgets.length} budgets`, () => {
    const state = belfry([MARTA, INES]);
    const marta: InstanceId = actorOf(state, MARTA);
    for (const limits of budgets) {
      for (const text of texts) {
        const turn = run(state, text, limits);
        const lines = toldBy(turn, marta);
        expect(
          lines.some((line) => line.to.includes(marta)),
          `\`${text}\` said nothing to its actor`,
        ).toBe(true);
      }
    }
  });
});

describe('a command turn draws from its seed', () => {
  /** What flipping the coin under `seed` left and said. */
  const flipped = (seed: number) => {
    const state = belfry();
    const turn = committed(commandTurn(state, belfryHost(), typed(MARTA, 'flip coin', seed)));
    return {
      face: heldIn(turn.state, COIN, 'face'),
      heads: heldIn(turn.state, COIN, 'heads'),
      said: toldBy(turn, actorOf(state, MARTA)).map((line) => line.words),
    };
  };

  it('does the same, to the last draw, for the same seed', () => {
    for (let seed = 0; seed < 25; seed++)
      expect(flipped(seed), String(seed)).toEqual(flipped(seed));
  });

  it('draws in the order the turn runs, from the seed alone', () => {
    const draws = new Draws(314);
    const face = draws.below(6);
    const heads = draws.below(2) === 0 ? 1 : 0;
    expect(flipped(314)).toMatchObject({ face, heads });
  });

  it('keeps every draw within its bound, and varies with the seed', () => {
    const seen = Array.from({ length: 60 }, (_, seed) => flipped(seed * 7919));
    for (const { face, heads } of seen) {
      expect(face).toBeGreaterThanOrEqual(0);
      expect(face).toBeLessThanOrEqual(5);
      expect([0, 1]).toContain(heads);
    }
    expect(new Set(seen.map(({ face }) => face)).size).toBeGreaterThan(1);
  });

  it('refuses a seed that is not one before the turn opens, as the host’s defect', () => {
    expect(() => commandTurn(belfry(), belfryHost(), typed(MARTA, 'flip coin', -1))).toThrow(
      /is not a seed/,
    );
  });
});

// --- `go` --------------------------------------------------------------------

describe('`go`, through a command turn', () => {
  const walk = (state: WorldState, text: string) =>
    committed(commandTurn(state, waysHost(), typed(MARTA_WAYS, text)));
  const marta = (state: WorldState) => actorOf(state, MARTA_WAYS);
  const standing = (state: WorldState, id: InstanceId) => state.instances.get(id)!.container;
  /** What a turn told its actor: each line's words, and each place described to them. */
  const told = (turn: ReturnType<typeof walk>, actor: InstanceId) => {
    const done = turn.value;
    if ('answered' in done) return [words(done.answered.said)];
    if ('refused' in done) return [words(done.refused.said)];
    if ('displaced' in done) return [words(done.displaced.told.said)];
    return [
      ...[...done.acted.said, ...done.drained.said]
        .filter((line) => line.to.includes(actor))
        .map((line) => words(line.said)),
      ...done.acted.notices
        .filter((notice) => notice.notice === 'described' && notice.audience.includes(actor))
        .map((notice) => `described ${notice.place}`),
    ];
  };

  it('moves the actor through the exit a direction, its abbreviation or its label names', () => {
    for (const text of [
      'north',
      'n',
      'go north',
      'walk n',
      'deeper into the dark',
      'go Deeper Into The Dark',
    ]) {
      const state = ways();
      const turn = walk(state, text);
      expect(standing(turn.state, marta(state)), text).toBe(MOUTH);
      // The one who went reads where they arrived, and nothing else is said.
      expect(told(turn, marta(state)), text).toEqual([`described ${MOUTH}`]);
    }
  });

  it('takes the exit that applies: the next in its direction once the first no longer holds', () => {
    const state = ways(undefined, [[LAMP, 'lit', true]]);
    expect(standing(walk(state, 'north').state, marta(state))).toBe(MEADOW);
  });

  it('crosses into a place inside another, which the actor’s range never reaches', () => {
    const state = ways();
    expect(standing(walk(state, 'up').state, marta(state))).toBe(LOFT);
  });

  it('answers a way that does not apply as it answers any word it does not know', () => {
    for (const [text, state] of [
      ['south', ways()],
      ['go west', ways()],
      ['up', ways([[MARTA_WAYS, SHOP]])],
    ] as const) {
      const turn = walk(state, text);
      expect(told(turn, marta(state)), text).toEqual([
        'sprout.World unknown: That is not something you can do here.',
      ]);
      expect(standing(turn.state, marta(state)), text).toBe(standing(state, marta(state)));
    }
    const down = ways([[MARTA_WAYS, SHOP]], [[LADDER, 'down', true]]);
    expect(standing(walk(down, 'up').state, marta(down))).toBe(LOFT);
  });

  it('says the destination’s refusal, as a refused `move` is said, and moves nobody', () => {
    const state = ways(undefined, [
      [LAMP, 'lit', true],
      [MEADOW, 'shut', true],
    ]);
    const turn = walk(state, 'north');
    expect(told(turn, marta(state))).toEqual(['The gate is shut.']);
    expect(standing(turn.state, marta(state))).toBe(YARD);
    // The refusal ends the pass: the walker's own part does not count the way.
    expect(turn.state.instances.get(marta(state))!.properties.get('walked')).toBe(0);
  });

  it('runs the actor’s own part of `go`: its `permit` may refuse, and its `do` runs once the move is made', () => {
    const tired = ways();
    const draft = tired.instances.get(marta(tired))!;
    const state: WorldState = {
      ...tired,
      instances: new Map(tired.instances).set(draft.id, {
        ...draft,
        properties: new Map(draft.properties).set('tired', true),
      }),
    };
    const turn = walk(state, 'north');
    expect(told(turn, marta(state))).toEqual(['You are too tired to walk.']);
    expect(standing(turn.state, marta(state))).toBe(YARD);
    const went = walk(ways(), 'north');
    expect(went.state.instances.get(marta(ways()))!.properties.get('walked')).toBe(1);
  });

  it('tells the places either side, as any move between two places does', () => {
    const state = ways([
      [MARTA_WAYS, YARD],
      [INES_WAYS, MOUTH],
    ]);
    const turn = walk(state, 'north');
    const done = turn.value;
    if (!('acted' in done)) throw new Error('the turn did not act');
    expect(
      done.acted.notices.map((notice) => [notice.notice, notice.place, notice.audience]),
    ).toEqual([
      ['leaves', YARD, []],
      ['arrives', MOUTH, [actorOf(state, INES_WAYS)]],
      ['described', MOUTH, [marta(state)]],
    ]);
  });

  it('follows a link once the world connects it, and the way back the new place connected', () => {
    let state = ways([[MARTA_WAYS, MOUTH]]);
    expect(told(walk(state, 'north'), marta(state))).toEqual([
      'sprout.World unknown: That is not something you can do here.',
    ]);
    const dug = walk(state, 'dig turning of the maze');
    expect(told(dug, marta(state))).toEqual(['The stones give, and a gap opens into more dark.']);
    state = dug.state;
    const on = walk(state, 'north');
    const cell = standing(on.state, marta(state))!;
    expect(on.state.instances.get(cell)!.made).toEqual({ from: 'spawned', kind: 'ways.MazeCell' });
    expect(standing(walk(on.state, 'the way you came').state, marta(state))).toBe(MOUTH);
    // Every turning leads up to the yard, as its kind writes it.
    expect(standing(walk(on.state, 'up').state, marta(state))).toBe(YARD);
  });

  it('tells its actor something for every line typed, directions and labels among them', () => {
    const texts = [
      'north',
      'south',
      'east',
      'west',
      'up',
      'down',
      'in',
      'out',
      'n',
      'u',
      'go',
      'go nowhere',
      'into the shop',
      'dig turning of the maze',
      'toward a grey light',
    ];
    for (const [where, set] of [
      [YARD, []],
      [
        YARD,
        [
          [LAMP, 'lit', true],
          [MEADOW, 'shut', true],
        ],
      ],
      [SHOP, []],
      [MOUTH, []],
    ] as const) {
      const state = ways([[MARTA_WAYS, where]], set);
      for (const text of texts) {
        expect(told(walk(state, text), marta(state)).length, `${text} in ${where}`).toBeGreaterThan(
          0,
        );
      }
    }
  });
});
