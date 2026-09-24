import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS, type RuntimeBudgets } from '../bundle/limits.js';
import {
  actorOf,
  BELL,
  belfry,
  belfryHost,
  DOG,
  DRUM,
  FAULT,
  GONG,
  heldIn,
  INES,
  MARTA,
  parseBelfry,
  STONE,
  toldBy,
  typed,
} from '../fixtures/turns.js';
import { NOTHING } from '../fixtures/reading.js';
import { commandTurn, type CommandTurn, type Parser } from './command.js';
import type { InstanceId } from './ids.js';
import { saveWorld } from './load.js';
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
