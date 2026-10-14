import { describe, expect, it } from 'vitest';

import { visitKey, type CommandTurn, type TurnHost } from '@overstory/sprout/lang';

import { ConversationPace, runConversation } from './conversation.js';
import { engineOf, tsEngine, type Engine } from './engine.js';
import { questionCases } from './engine-conformance/questions.js';
import { command, MARTA, seeded, tally } from './fixtures/tally.js';
import { emptyState } from './records.js';
import { applyChanges } from './state.js';
import { loaded } from './steps.js';
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
    engineOf(named).parse(await stored(store), MARTA, 'bump counter');
    await runDeparture(store, 'w', named, { ...at(1), visit: ines });
    expect([...asked].sort()).toEqual(Object.keys(own).sort());
  });
});

describe('the engine conformance suite’s engine, under the TypeScript runtime', () => {
  for (const one of questionCases) {
    it(`${one.name} — ${one.proves}`, async () => {
      await one.run(({ host: made }) => tsEngine(made));
    });
  }
});

describe('the TypeScript runtime as an engine', () => {
  it('runs no command for a host without a parser', () => {
    const { parse: _parse, ...unparsed } = host;
    expect(() =>
      tsEngine(unparsed as TurnHost).command(emptyState(), command('bump counter')),
    ).toThrow(/no parser/);
  });

  it('runs the next turn on the world the last one left, once core hands back what it landed as', async () => {
    const engine = tsEngine(host);
    const before = await stored(await seeded(host));
    const step = engine.command(before, command('bump counter'));
    // The TypeScript engine's turn is the language's own.
    const turn = step.turn as CommandTurn;
    if (!turn.committed) throw new Error('the bump faulted');
    const landed = applyChanges(before, step.changes!);
    engine.landed!(landed);
    expect(loaded(landed, host)).toBe(turn.state);
    // Once it has, a stored state no turn landed as is read afresh.
    const other = applyChanges(before, step.changes!);
    engine.landed!(other);
    expect(loaded(other, host)).not.toBe(turn.state);
    expect(loaded(other, host).serial).toBe(turn.state.serial);
  });
});
