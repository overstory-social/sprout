import { describe, expect, it } from 'vitest';

import { visitKey, type TurnHost } from '@overstory/sprout/lang';

import { engineOf, tsEngine, type Engine, type GivenCommand } from './engine.js';
import { command, COUNTER, GAUGE, HALL, MARTA, seeded, tally } from './fixtures/tally.js';
import type { SproutStore } from './store.js';
import { committedStored, runCommand, runCommandLine } from './turns.js';
import { runScene } from './views.js';

const { host } = tally();
const stored = (store: SproutStore) => committedStored(store, 'w');

describe('the engine a host runs', () => {
  it('is the TypeScript runtime’s where the host names none, made once for the host', () => {
    expect(engineOf(host)).toBe(engineOf(host));
    expect(engineOf({ ...host })).not.toBe(engineOf(host));
  });

  it('is the one the host names, and every turn and poll runs through it', async () => {
    const store = await seeded(host);
    const own = tsEngine(host);
    const asked: string[] = [];
    const counted = Object.fromEntries(
      Object.entries(own).map(([name, run]) => [
        name,
        (...args: unknown[]) => {
          asked.push(name);
          return (run as (...args: unknown[]) => unknown)(...args);
        },
      ]),
    ) as unknown as Engine;
    const named = { ...host, engine: counted };
    await runCommand(store, 'w', named, command('bump counter'));
    await runScene(store, 'w', named, MARTA, 0);
    expect(asked).toEqual(['command', 'scene']);
  });
});

describe('the TypeScript runtime as an engine', () => {
  it('gives each turn its effects and whose views it made stale', async () => {
    const store = await seeded(host);
    const turn = tsEngine(host).command(await stored(store), command('bump counter')).turn;
    expect(turn.committed && turn.stale).toEqual([MARTA]);
    expect(turn.effects.map((one) => one.paragraphs)).toEqual([['Click.']]);
  });

  it('runs a line’s commands one at a time, each told the turn before it, and then says it is done', async () => {
    const store = await seeded(host);
    const turns = await runCommandLine(store, 'w', host, command('twice counter'), () => 11);
    expect(turns.map((one) => one.committed)).toEqual([true, true]);
    const line = tsEngine(host).line(command('bump counter'), () => 11);
    const first = line.next(null);
    expect(first?.text).toBe('bump counter');
    const turn: GivenCommand = await runCommand(store, 'w', host, first!);
    expect(line.next(turn)).toBeNull();
  });

  it('names where a visitor stands and what else is there, as they read it', async () => {
    const store = await seeded(host);
    const standing = tsEngine(host).standing(await stored(store), MARTA);
    expect(standing).toEqual({
      place: { id: HALL, name: 'a hall' },
      here: [
        { id: COUNTER, name: 'a counter' },
        { id: GAUGE, name: 'a gauge' },
      ],
    });
    expect(tsEngine(host).standing(await stored(store), visitKey('v-nobody'))).toBeNull();
  });

  it('answers the host’s questions of the committed world between turns', async () => {
    const store = await seeded(host);
    const engine = tsEngine(host);
    expect(engine.occupiedPlaces(await stored(store))).toEqual([HALL]);
    expect(engine.dueWakes(await stored(store), 0)).toEqual([]);
    expect(engine.hearers(await stored(store), MARTA)).toEqual({ place: HALL, to: [MARTA] });
    expect(engine.nicknameRefusal(await stored(store), visitKey('v-ines'), 'Marta')).toMatchObject({
      reason: 'held',
    });
  });

  it('runs no command for a host without a parser', async () => {
    const store = await seeded(host);
    const { parse: _parse, ...unparsed } = host;
    expect(() =>
      tsEngine(unparsed as TurnHost).command(
        // The stored state is read before the parser is asked for, so hand one over.
        { serial: 0, instances: [], visitors: [], tombstones: [] },
        command('bump counter'),
      ),
    ).toThrow(/no parser/);
    expect(await stored(store)).toBeDefined();
  });
});
