import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS, visitKey, type InstanceId } from '@overstory/sprout/lang';
import { TALLY } from '@overstory/sprout/engine-conformance';

import { WasmInstance } from './instance.js';
import { engineBuilt, NOT_BUILT, shippedModule } from './wasm.js';

// One instance of the engine driven directly: its world and live state,
// the host's terms, the lines under way, and what it refuses in words.

/** An instance with the tally loaded, Marta and Ines admitted to its hall. */
function tally(): WasmInstance {
  const instance = new WasmInstance(shippedModule());
  instance.load(TALLY.cartridge);
  instance.budgets(DEFAULT_LIMITS.budgets, DEFAULT_LIMITS.caps.listElements);
  instance.openEmpty('tally');
  instance.arrive(visitKey('v-marta'), 'Marta', { seed: 1, now: 0 });
  instance.arrive(visitKey('v-ines'), 'Ines', { seed: 2, now: 0 });
  return instance;
}

describe.skipIf(!engineBuilt())('an instance of the engine', () => {
  it('saves its live state as the store keeps it, and opens it again', () => {
    const instance = tally();
    const saved = instance.save();
    instance.command({ visit: 'v-marta', text: 'bump counter' }, { seed: 3, now: 1 });
    expect(instance.save()).not.toBe(saved);
    instance.open(saved);
    expect(instance.save()).toBe(saved);
  });

  it('keeps two visitors’ lines apart, each handing out its own commands once each', () => {
    const instance = tally();
    const marta = instance.line(visitKey('v-marta'), 'bump counter then bump gauge')!;
    const ines = instance.line(visitKey('v-ines'), 'bump gauge then bump counter')!;
    expect(marta.line).not.toBe(ines.line);
    instance.command(ines, { seed: 4, now: 1 });
    expect(() => instance.lineNext(marta.line)).toThrow(/before asking for the next/);
    instance.command(marta, { seed: 5, now: 1 });
    expect(() => instance.command(marta, { seed: 6, now: 1 })).toThrow(/handed out once/);
    expect(instance.lineNext(marta.line)?.text).toBe('bump gauge');
    expect(instance.lineNext(ines.line)?.text).toBe('bump counter');
    instance.lineEnd(ines.line);
    expect(() => instance.lineNext(ines.line)).toThrow(/no line under way/);
  });

  it('takes the host’s budgets by the spec’s names, and refuses a row it has none of in words', () => {
    const instance = tally();
    instance.budgets({ ...DEFAULT_LIMITS.budgets, steps: 70_000 }, 16);
    const told = instance.command({ visit: 'v-marta', text: 'bump counter' }, { seed: 3, now: 1 });
    expect(told.entry).toMatchObject({ budgets: { steps: 70_000 } });
    expect(() =>
      instance.call('sw_budgets', ...instance.put([new TextEncoder().encode('{"juggles":3}')])),
    ).toThrow(/a row the runtime has none of/);
  });

  it('logs the bound the host sets on what it stores', () => {
    const instance = tally();
    instance.mayHold(400);
    expect(
      instance.command({ visit: 'v-marta', text: 'bump counter' }, { seed: 3, now: 1 }).entry,
    ).toMatchObject({
      mayHold: 400,
    });
    instance.mayHold(null);
    expect(
      instance.command({ visit: 'v-marta', text: 'bump counter' }, { seed: 3, now: 1 }).entry,
    ).toMatchObject({
      mayHold: null,
    });
  });

  it('answers what a host asks between turns', () => {
    const instance = tally();
    const hall = 'tally.hall' as InstanceId;
    expect(instance.occupied()).toEqual([hall]);
    expect(instance.hearers(visitKey('v-marta'))).toEqual({
      place: hall,
      to: ['v-marta', 'v-ines'],
    });
    expect(instance.standing(visitKey('v-marta'))?.here.map((one) => one.name)).toEqual([
      'a counter',
      'a gauge',
      'Ines',
    ]);
    expect(instance.nickname(visitKey('v-pat'), 'ines')).toMatchObject({ reason: 'held' });
    expect(instance.dueWakes(0)).toEqual([]);
  });

  it('reads a typed line over the live state, each command its own, and runs none of it', () => {
    const instance = tally();
    const saved = instance.save();
    const read = instance.parse(visitKey('v-marta'), 'bump counter then frobnicate');
    expect(read.map((one) => one.text)).toEqual(['bump counter', 'frobnicate']);
    expect(read[0]).toMatchObject({
      reading: {
        verb: 'tally.bump',
        roles: [{ name: 'target', filler: { object: { name: 'a counter' } } }],
      },
      refused: null,
    });
    expect(read[1]).toMatchObject({ answered: { passage: 'unknown' } });
    expect(instance.save()).toBe(saved);
    expect(() => instance.parse(visitKey('v-nobody'), 'look')).toThrow(/never visited/);
  });

  it('refuses what it cannot read, in words', () => {
    const instance = tally();
    expect(() => instance.command({ visit: 'v-marta' }, { seed: 0, now: 0 })).toThrow(
      /names its visit and the words typed/,
    );
    expect(() => instance.view(visitKey('v-nobody'))).toThrow(/never visited/);
    expect(instance.memory().held).toBeGreaterThan(0);
  });
});

describe.runIf(!engineBuilt())('an instance of the engine, without engine.wasm', () => {
  it.skip(NOT_BUILT, () => {});
});
