import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LIMITS,
  NOT_ADMITTING,
  dueWakes,
  visitKey,
  type CommandHost,
  type CommandTurn,
  type NicknameRefusalReason,
} from '@overstory/sprout/lang';

import { reentrant } from './conformance.js';
import { readLog } from './log/entry.js';
import {
  COUNTER,
  GAUGE,
  HALL,
  MARTA,
  command,
  seeded as seededTally,
  tally,
} from './fixtures/tally.js';
import type { SproutStore } from './store.js';
import {
  committedState,
  runArrival,
  runCommand,
  runDeparture,
  runMaintenance,
  runPoll,
  runTick,
  runWake,
  type NicknameHost,
} from './turns.js';

const { host } = tally();
const { catalogue } = host;
const seeded = (store?: SproutStore) => seededTally(host, store);

/** The counter, or what `id` names, as the store holds it now. */
async function count(store: SproutStore, id = COUNTER): Promise<unknown> {
  const polled = await runPoll(store, 'w', host, (turn) =>
    turn.state.instance(id)?.properties.get('n'),
  );
  if (polled.faulted) throw new Error(polled.fault.detail);
  return polled.view;
}

const stored = (store: SproutStore) => store.read('w', (tx) => tx.state());

function committedCount(turn: CommandTurn): unknown {
  if (!turn.committed) throw new Error(turn.fault.detail);
  return turn.state.instances.get(COUNTER)?.properties.get('n');
}

describe('a command turn against a store', () => {
  it('writes what it committed, and the next turn reads it', async () => {
    const store = await seeded();
    expect(committedCount(await runCommand(store, 'w', host, command('bump counter')))).toBe(1);
    expect(await count(store)).toBe(1);
    expect(committedCount(await runCommand(store, 'w', host, command('bump counter')))).toBe(2);
  });

  it('gives the host what it said, rendered, as its effects', async () => {
    const store = await seeded();
    const turn = await runCommand(store, 'w', host, command('bump counter'));
    expect(turn.effects.map((one) => [one.kind, one.from, one.visit, one.paragraphs])).toEqual([
      ['said', COUNTER, MARTA, ['Click.']],
    ]);
  });

  it('writes nothing of the world when it faults, and tells the actor', async () => {
    const store = await seeded();
    await runCommand(store, 'w', host, command('bump counter'));
    const before = await stored(store);
    const turn = await runCommand(store, 'w', host, command('smash counter'));
    expect(turn.committed).toBe(false);
    if (turn.committed) return;
    expect(turn.fault.name).toBe('IntegerOverflow');
    expect(turn.told.effect).toBe('notice');
    expect(turn.effects.map((one) => [one.kind, one.visit])).toEqual([['notice', MARTA]]);
    expect(await stored(store)).toEqual(before);
    expect(await count(store)).toBe(1);
  });

  it('is serialized with every other write turn on the world, so none loses another’s write', async () => {
    const store = await seeded();
    const turns = await Promise.all(
      Array.from({ length: 5 }, () => runCommand(store, 'w', host, command('bump counter'))),
    );
    // Each turn read what the one before it committed.
    expect(turns.map(committedCount)).toEqual([1, 2, 3, 4, 5]);
    expect(await count(store)).toBe(5);
  });

  it('waits on a write turn that holds the lock, while a poll does not and sees the state before', async () => {
    const store = await seeded();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let entered!: () => void;
    const inside = new Promise<void>((resolve) => (entered = resolve));
    const held = store.transaction('w', async () => {
      entered();
      await gate;
    });
    await inside;
    let done = false;
    const bumped = runCommand(store, 'w', host, command('bump counter')).then((turn) => {
      done = true;
      return turn;
    });
    // The poll returns while the lock is held, and the command still waits.
    expect(await count(store)).toBe(0);
    expect(done).toBe(false);
    release();
    await held;
    expect(committedCount(await bumped)).toBe(1);
    expect(await count(store)).toBe(1);
  });

  it('commits once when the store runs its body twice', async () => {
    const store = reentrant(await seeded());
    const turn = await runCommand(store, 'w', host, command('bump counter'));
    expect(committedCount(turn)).toBe(1);
    expect(await count(store)).toBe(1);
  });
});

describe('a tick turn against a store', () => {
  const tick = (now: number) => ({ place: HALL, now, seed: 2, mayHold: null });

  it('writes the place’s last tick where it commits, and the next tick reads it', async () => {
    const store = await seeded();
    expect((await committedState(store, 'w', host)).instances.get(HALL)?.lastTick).toBeNull();
    expect(await runTick(store, 'w', host, tick(50))).toMatchObject({
      committed: true,
      value: { elapsed: 0 },
    });
    expect((await committedState(store, 'w', host)).instances.get(HALL)?.lastTick).toBe(50);
    expect(await runTick(store, 'w', host, tick(80))).toMatchObject({ value: { elapsed: 30 } });
  });

  it('writes nothing for a tick the host asks for at a time before the last', async () => {
    const store = await seeded();
    await runTick(store, 'w', host, tick(50));
    const before = await stored(store);
    await expect(runTick(store, 'w', host, tick(40))).rejects.toThrow('does not run backwards');
    expect(await stored(store)).toEqual(before);
  });
});

describe('a wake turn against a store', () => {
  /** Rest the counter at `asked`, and hand back the wake that asks for, as at `now`. */
  async function rested(store: SproutStore, asked: number, now: number) {
    await runCommand(store, 'w', host, command('rest counter', asked));
    const [due] = dueWakes(await committedState(store, 'w', host), now);
    if (due === undefined) throw new Error('nothing is due');
    return { object: due.object, serial: due.serial, now, seed: 5, mayHold: null };
  }

  it('asks at the command’s instant, and writes what the wake did where it commits', async () => {
    const store = await seeded();
    const wake = await rested(store, 100, 190);
    expect(dueWakes(await committedState(store, 'w', host), 159)).toEqual([]);
    expect(await runWake(store, 'w', host, wake)).toMatchObject({
      committed: true,
      value: { elapsed: 90 },
    });
    expect(await count(store)).toBe(90);
    expect((await stored(store)).instances.find((r) => r.id === COUNTER)?.wakes).toEqual([]);
    expect(await runWake(store, 'w', host, wake)).toEqual({ committed: false, unwoken: true });
  });

  it('writes only the wake’s consumption where it faults, so it is not retried', async () => {
    const store = await seeded();
    const wake = await rested(store, 0, 500);
    const turn = await runWake(store, 'w', host, wake);
    expect(turn).toMatchObject({ committed: false, fault: { name: 'ValueOutOfRange' } });
    expect(await count(store)).toBe(0);
    expect((await stored(store)).instances.find((r) => r.id === COUNTER)?.wakes).toEqual([]);
  });
});

describe('a maintenance turn against a store', () => {
  it('writes what catch-up kept, and a fault is consumed in the same write', async () => {
    const store = await seeded();
    await runCommand(store, 'w', host, command('rest counter', 0));
    const kept = await runMaintenance(store, 'w', host, { now: 75, seed: 6, mayHold: null });
    expect(kept.value).toMatchObject({ faulted: [], abandoned: [] });
    expect(await count(store)).toBe(75);

    await runCommand(store, 'w', host, command('rest counter', 100));
    const faulted = await runMaintenance(store, 'w', host, { now: 900, seed: 7, mayHold: null });
    expect(faulted.value.faulted).toMatchObject([{ fault: { name: 'ValueOutOfRange' } }]);
    expect(await count(store)).toBe(75);
    expect(dueWakes(await committedState(store, 'w', host), 10_000)).toEqual([]);
  });

  it('writes the other objects’ wakes past one that faults, and gives back which did what', async () => {
    const store = await seeded();
    await runCommand(store, 'w', host, command('rest counter', 0));
    await runCommand(store, 'w', host, command('rest gauge', 50));
    // The counter has waited 120 seconds, past what it holds; the gauge 70.
    const turn = await runMaintenance(store, 'w', host, { now: 120, seed: 8, mayHold: null });
    expect(turn.value.faulted).toMatchObject([
      { wake: { object: COUNTER }, fault: { name: 'ValueOutOfRange' } },
    ]);
    expect(turn.value.delivered.map((w) => w.object)).toEqual([GAUGE]);
    expect(turn.value.abandoned).toEqual([]);
    expect(await count(store)).toBe(0);
    expect(await count(store, GAUGE)).toBe(70);
    expect(dueWakes(await committedState(store, 'w', host), 10_000)).toEqual([]);
  });

  it('leaves the faulted object’s later due wake pending for live time', async () => {
    const store = await seeded();
    const twice: CommandHost = {
      ...host,
      budgets: { ...DEFAULT_LIMITS.budgets, pendingWakesPerObject: 2 },
    };
    await runCommand(store, 'w', twice, command('rest counter', 0));
    await runCommand(store, 'w', twice, command('rest counter', 10));
    await runCommand(store, 'w', twice, command('rest gauge', 50));
    const turn = await runMaintenance(store, 'w', twice, { now: 120, seed: 9, mayHold: null });
    expect(turn.value.faulted.map((f) => f.wake.object)).toEqual([COUNTER]);
    expect(turn.value.delivered.map((w) => w.object)).toEqual([GAUGE]);
    const later = dueWakes(await committedState(store, 'w', twice), 120);
    expect(later.map((w) => [w.object, w.askedAt])).toEqual([[COUNTER, 10]]);
  });
});

/** A host whose moderation declines no nickname. */
const OPEN: NicknameHost = { moderate: () => true };

describe('admitting and letting go of a visitor against a store', () => {
  const at = (now: number) => ({ now, seed: 4, mayHold: null });

  it('goes away, writing the visitor out of the tree with where they stood kept', async () => {
    const store = await seeded();
    const turn = await runDeparture(store, 'w', host, { visit: MARTA, ...at(0) });
    expect(turn.committed).toBe(true);
    const state = await committedState(store, 'w', host);
    const record = state.visitors.get(MARTA)!;
    expect(state.instances.get(record.instance)!.container).toBeNull();
    expect(record.lastPlace).toBe(HALL);
  });

  it('runs catch-up, committed first, then admits the visitor where they last stood', async () => {
    const store = await seeded();
    await runCommand(store, 'w', host, command('rest counter', 0));
    await runDeparture(store, 'w', host, { visit: MARTA, ...at(10) });
    const admitted = await runArrival(
      store,
      'w',
      host,
      at(75),
      {
        visit: MARTA,
        nickname: 'Marta',
        ...at(75),
      },
      OPEN,
    );
    expect(admitted.caughtUp!.value.delivered.map((w) => w.object)).toEqual([COUNTER]);
    expect(admitted.arrived.committed).toBe(true);
    // The counter reads the whole absence, delivered before anyone walked in.
    expect(await count(store)).toBe(75);
    const state = await committedState(store, 'w', host);
    expect(state.instances.get(state.visitors.get(MARTA)!.instance)!.container).toBe(HALL);
  });

  it('runs no catch-up for a world that admits no one, and writes nothing', async () => {
    const store = await seeded();
    await runCommand(store, 'w', host, command('rest counter', 0));
    const closed: CommandHost = { ...host, catalogue: { ...catalogue, arrival: null } };
    const before = await stored(store);
    const admitted = await runArrival(
      store,
      'w',
      closed,
      at(75),
      {
        visit: visitKey('v-ines'),
        nickname: 'Ines',
        ...at(75),
      },
      OPEN,
    );
    expect(admitted.caughtUp).toBeNull();
    expect(admitted.arrived).toEqual({
      committed: false,
      closed: { reason: 'no-arrival-place', words: NOT_ADMITTING },
    });
    expect(await stored(store)).toEqual(before);
  });
});

describe('admitting a nickname against a store', () => {
  const at = (now: number) => ({ now, seed: 4, mayHold: null });
  const INES = visitKey('v-ines');
  const PAT = visitKey('v-pat');

  it('refuses one the world or the language reads, one shaped like source, or one someone present holds, running no catch-up, asking no moderation and writing nothing', async () => {
    const reasons: Record<string, NicknameRefusalReason> = {
      Counter: 'world-word',
      'Hall Ines': 'world-word',
      'Ines When': 'reserved',
      ':ines': 'source-shaped',
      MARTA: 'held',
    };
    for (const [nickname, reason] of Object.entries(reasons)) {
      const store = await seeded();
      await runCommand(store, 'w', host, command('rest counter', 0));
      const before = await stored(store);
      const asked: string[] = [];
      const moderating: NicknameHost = {
        ...OPEN,
        moderate: (name) => (asked.push(name), true),
      };
      const admitted = await runArrival(
        store,
        'w',
        host,
        at(75),
        { visit: INES, nickname, ...at(75) },
        moderating,
      );
      expect(admitted.caughtUp, nickname).toBeNull();
      expect(admitted.arrived.committed, nickname).toBe(false);
      const refused =
        'nicknameRefused' in admitted.arrived ? admitted.arrived.nicknameRefused : null;
      expect(refused?.reason, nickname).toBe(reason);
      expect(refused?.words, nickname).toMatch(/: choose another nickname\.$/);
      expect(asked, nickname).toEqual([]);
      expect(await stored(store), nickname).toEqual(before);
    }
  });

  it('refuses one past the host’s nickname budget before its moderation is asked', async () => {
    const store = await seeded();
    const capped: CommandHost = {
      ...host,
      budgets: { ...DEFAULT_LIMITS.budgets, nicknameCharacters: 4 },
    };
    const asked: string[] = [];
    const moderating: NicknameHost = { moderate: (name) => (asked.push(name), true) };
    const admitted = await runArrival(
      store,
      'w',
      capped,
      at(0),
      { visit: INES, nickname: 'Ines B', ...at(0) },
      moderating,
    );
    const refused = 'nicknameRefused' in admitted.arrived ? admitted.arrived.nicknameRefused : null;
    expect(refused?.reason).toBe('too-long');
    expect(refused?.words).toBe(
      '"Ines B" is 6 characters, and a nickname here may have at most 4: choose a shorter one.',
    );
    expect(asked).toEqual([]);
  });

  it('asks the host’s moderation of the nickname as it would be kept, and refuses one it declines, writing nothing', async () => {
    const store = await seeded();
    await runCommand(store, 'w', host, command('rest counter', 0));
    const before = await stored(store);
    const asked: string[] = [];
    const strict: NicknameHost = {
      ...OPEN,
      moderate: async (name) => (asked.push(name), name !== 'Rude Word'),
    };
    const admitted = await runArrival(
      store,
      'w',
      host,
      at(75),
      { visit: INES, nickname: '  Rude   Word ', ...at(75) },
      strict,
    );
    expect(asked).toEqual(['Rude Word']);
    expect(admitted.caughtUp).toBeNull();
    expect(admitted.arrived).toEqual({
      committed: false,
      nicknameRefused: {
        reason: 'moderated',
        nickname: '  Rude   Word ',
        collides: [],
        words: 'That nickname cannot be used here: choose another.',
      },
    });
    expect(await stored(store)).toEqual(before);
  });

  it('refuses one someone came in under while it was being moderated, after catch-up, writing no arrival', async () => {
    const store = await seeded();
    const racing: NicknameHost = {
      ...OPEN,
      moderate: async () => {
        const first = await runArrival(
          store,
          'w',
          host,
          at(5),
          { visit: PAT, nickname: 'Pat', ...at(5) },
          OPEN,
        );
        expect(first.arrived.committed).toBe(true);
        return true;
      },
    };
    const admitted = await runArrival(
      store,
      'w',
      host,
      at(5),
      { visit: INES, nickname: 'pat', ...at(5) },
      racing,
    );
    expect(admitted.caughtUp).not.toBeNull();
    expect('nicknameRefused' in admitted.arrived && admitted.arrived.nicknameRefused.words).toBe(
      'Someone here is already called "pat": choose another nickname.',
    );
    const state = await committedState(store, 'w', host);
    expect(state.visitors.has(INES)).toBe(false);
    expect(state.visitors.get(PAT)!.nickname).toBe('Pat');
  });

  it('admits one held only by someone away, kept as its words single-spaced', async () => {
    const store = await seeded();
    await runDeparture(store, 'w', host, { visit: MARTA, ...at(0) });
    const admitted = await runArrival(
      store,
      'w',
      host,
      at(5),
      { visit: INES, nickname: ' Marta ', ...at(5) },
      OPEN,
    );
    expect(admitted.arrived.committed).toBe(true);
    const state = await committedState(store, 'w', host);
    expect(state.visitors.get(INES)!.nickname).toBe('Marta');
  });
});

describe('what each write turn logs', () => {
  const at = (now: number) => ({ now, seed: 4, mayHold: null });
  const kinds = async (store: SproutStore) =>
    (await readLog(store, 'w', { limit: 100 })).map(({ entry }) => entry.kind);

  it('appends one entry per turn that ran, in the order the lock ran them, a faulted one included', async () => {
    const store = await seeded();
    await runCommand(store, 'w', host, command('bump counter'));
    await runCommand(store, 'w', host, command('smash counter'));
    await runTick(store, 'w', host, { place: HALL, ...at(50) });
    await runCommand(store, 'w', host, command('rest counter', 60));
    await runMaintenance(store, 'w', host, at(200));
    await runDeparture(store, 'w', host, { visit: MARTA, ...at(210) });
    await runArrival(
      store,
      'w',
      host,
      at(220),
      { visit: MARTA, nickname: 'Marta', ...at(220) },
      OPEN,
    );
    expect(await kinds(store)).toEqual([
      'command',
      'command',
      'tick',
      'command',
      'maintenance',
      'departure',
      'maintenance',
      'arrival',
    ]);
    const [bumped, smashed] = await readLog(store, 'w', { limit: 2 });
    expect(bumped!.entry).toMatchObject({ kind: 'command', text: 'bump counter', fault: null });
    expect(smashed!.entry).toMatchObject({
      kind: 'command',
      fault: { name: 'IntegerOverflow', engine: false },
      effects: [{ kind: 'notice', visit: MARTA }],
    });
  });

  it('logs nothing for a turn that ran nothing, or an arrival that never opened', async () => {
    const store = await seeded();
    await runDeparture(store, 'w', host, { visit: MARTA, ...at(0) });
    const before = await kinds(store);
    expect(await runTick(store, 'w', host, { place: HALL, ...at(10) })).toMatchObject({
      unoccupied: true,
    });
    expect(await runWake(store, 'w', host, { object: COUNTER, serial: 99, ...at(10) })).toEqual({
      committed: false,
      unwoken: true,
    });
    const refused = await runArrival(
      store,
      'w',
      host,
      at(20),
      { visit: visitKey('v-ines'), nickname: 'Counter', ...at(20) },
      OPEN,
    );
    expect('nicknameRefused' in refused.arrived).toBe(true);
    const closed: CommandHost = { ...host, catalogue: { ...catalogue, arrival: null } };
    await runArrival(
      store,
      'w',
      closed,
      at(30),
      { visit: MARTA, nickname: 'Marta', ...at(30) },
      OPEN,
    );
    expect(await kinds(store)).toEqual(before);
  });

  it('logs a consumed wake with its fault and nothing it said, under the budgets it ran with', async () => {
    const store = await seeded();
    await runCommand(store, 'w', host, command('rest counter', 0));
    const [due] = dueWakes(await committedState(store, 'w', host), 500);
    const wide = { ...host, budgets: { ...host.budgets, steps: 70_000 } };
    await runWake(store, 'w', wide, { object: due!.object, serial: due!.serial, ...at(500) });
    const [, woke] = await readLog(store, 'w', { limit: 10 });
    expect(woke!.entry).toMatchObject({
      kind: 'wake',
      object: COUNTER,
      serial: due!.serial,
      now: 500,
      seed: 4,
      fault: { name: 'ValueOutOfRange' },
      effects: [],
      budgets: { steps: 70_000 },
    });
  });
});
