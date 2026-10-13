import { describe, expect, it } from 'vitest';

import { visitKey, type TurnHost } from '@overstory/sprout/lang';

import { ConversationPace, runConversation } from './conversation.js';
import { engineOf, tsEngine, type Engine, type GivenCommand } from './engine.js';
import { command, COUNTER, GAUGE, HALL, MARTA, seeded, tally } from './fixtures/tally.js';
import { emptyState } from './records.js';
import type { SproutStore } from './store.js';
import { Ticker } from './ticks.js';
import {
  committedStored,
  runArrival,
  runCommand,
  runCommandLine,
  runDeparture,
  runWake,
} from './turns.js';
import { runReadings, runScene, runView } from './views.js';

const { host } = tally();
const stored = (store: SproutStore) => committedStored(store, 'w');

describe('the engine a host runs', () => {
  it('is the TypeScript runtime’s where the host names none, made once for the host', () => {
    expect(engineOf(host)).toBe(engineOf(host));
    expect(engineOf({ ...host })).not.toBe(engineOf(host));
  });

  it('is the one the host names, and every turn, poll and question runs through it', async () => {
    const store = await seeded(host);
    const own = tsEngine(host);
    const asked = new Set<string>();
    const recording = Object.fromEntries(
      Object.entries(own).map(([name, run]) => [
        name,
        (...args: unknown[]) => {
          asked.add(name);
          return (run as (...args: unknown[]) => unknown)(...args);
        },
      ]),
    ) as unknown as Engine;
    const named = { ...host, engine: recording };
    const at = (now: number) => ({ seed: 1, mayHold: null, now });
    const ines = visitKey('v-ines');
    await runArrival(
      store,
      'w',
      named,
      at(0),
      { ...at(0), visit: ines, nickname: 'Ines' },
      {
        moderate: () => true,
      },
    );
    await runCommandLine(store, 'w', named, command('twice counter'), () => 11);
    await runCommand(store, 'w', named, command('rest counter'));
    await new Ticker().round(store, 'w', named, 1, () => ({ seed: 1, mayHold: null }));
    const [due] = engineOf(named).dueWakes(await stored(store), 10_000);
    if (due !== undefined) {
      await runWake(store, 'w', named, { ...at(10_000), object: due.object, serial: due.serial });
    }
    await runConversation(
      store,
      'w',
      named,
      { rules: { characters: null, pace: null }, moderate: () => true },
      new ConversationPace(),
      { visit: MARTA, text: 'hello', at: 1 },
    );
    await runView(store, 'w', named, MARTA, 0);
    await runScene(store, 'w', named, MARTA, 0);
    await runReadings(store, 'w', named, MARTA, 'tally.bump', 0);
    await runDeparture(store, 'w', named, { ...at(1), visit: ines });
    expect([...asked].sort()).toEqual(Object.keys(own).sort());
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

  it('runs no command for a host without a parser', () => {
    const { parse: _parse, ...unparsed } = host;
    expect(() =>
      tsEngine(unparsed as TurnHost).command(emptyState(), command('bump counter')),
    ).toThrow(/no parser/);
  });
});
