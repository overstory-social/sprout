import { describe, expect, it } from 'vitest';

import {
  catalogueOf,
  compileBundle,
  declaredId,
  DEFAULT_LIMITS,
  Draft,
  initialState,
  libraryHash,
  newInstance,
  NOT_ADMITTING,
  SourceFile,
  STANDARD_LIBRARY,
  dueWakes,
  storedChanges,
  visitKey,
  type CommandHost,
  type CommandTurn,
  type Manifest,
  type Parser,
} from '@overstory/sprout/lang';

import { reentrant } from './conformance.js';
import { memoryStore } from './memory-store.js';
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
  runWriteTurn,
} from './turns.js';

// A counter and a gauge in a hall, both of one kind, one kind per file:
// bumping one counts, and smashing it counts and then overflows, so the
// turn faults after it wrote; resting it asks for a wake a minute on,
// and a wake sets it to the seconds it waited, which it holds only up to
// 99.
const FILES: Record<string, string> = {
  'world.sprout': `world tally is sprout.World {
  visitors are Person
  visitors arrive at hall
  object hall is sprout.Place {
    object counter is Counter
    object gauge is Counter
  }
}
verb bump  { role target  "bump [target]" }
verb smash { role target  "smash [target]" }
verb rest  { role target  "rest [target]" }
`,
  'person.sprout': 'kind Person is sprout.Visitor { }\n',
  'counter.sprout': `kind Counter {
  :n 0 min 0 max 99
  as target for bump  { do { self.adjust(:n, 1)  say "Click." } }
  as target for smash { do { self.adjust(:n, 1)  if (2147483647 + 1 > 0) { say "Crunch." } } }
  as target for rest  { do { wake in 1 minutes  say "Resting." } }
  on :woke (elapsed) { self.set(:n, elapsed) }
}
`,
};

const MANIFEST: Manifest = {
  name: 'tally',
  namespace: 'tally',
  version: '0.1.0',
  author: 'Eric Eslinger',
  license: 'MIT',
  level: 1,
  extensions: [],
  libraries: [
    {
      name: STANDARD_LIBRARY.name,
      version: STANDARD_LIBRARY.version,
      sha: libraryHash(STANDARD_LIBRARY),
    },
  ],
  files: Object.keys(FILES),
};

const { bundle } = compileBundle(
  {
    manifestFile: new SourceFile('sprout.json', JSON.stringify(MANIFEST)),
    manifest: MANIFEST,
    files: Object.entries(FILES).map(([name, text]) => new SourceFile(name, text)),
    libraries: [STANDARD_LIBRARY],
  },
  { mode: 'publish', limits: DEFAULT_LIMITS },
);
if (bundle === null) throw new Error('the tally does not compile');
const catalogue = catalogueOf(bundle, DEFAULT_LIMITS.caps);
const HALL = declaredId('tally', ['hall']);
const COUNTER = declaredId('tally', ['hall', 'counter']);
const GAUGE = declaredId('tally', ['hall', 'gauge']);
const MARTA = visitKey('v-marta');

/** Reads `verb counter` and `verb gauge`; anything else is not reached by these cases. */
const parse: Parser = (text, actor) => {
  const [word, noun] = text.split(' ');
  const verb = bundle.verbs.qualified('tally', word!);
  if (verb === null) throw new Error(`no verb in \`${text}\``);
  const object = noun === 'gauge' ? GAUGE : COUNTER;
  return { reading: { verb, actor, bindings: new Map([['target', { object }]]) } };
};
const host: CommandHost = { catalogue, budgets: DEFAULT_LIMITS.budgets, parse };
const command = (text: string, now = 0) => ({ visit: MARTA, text, seed: 1, mayHold: null, now });

/** A store holding the tally with Marta standing in the hall. */
async function seeded(store: SproutStore = memoryStore()): Promise<SproutStore> {
  const draft = new Draft(initialState(catalogue));
  const marta = draft.mint();
  draft.add(
    newInstance(
      marta,
      { from: 'visitor' },
      catalogue.visitorKind!,
      HALL,
      draft.nextSerial(),
      catalogue.caps,
    ),
  );
  draft.putVisitor({ visit: MARTA, nickname: 'Marta', instance: marta, lastPlace: HALL });
  const { state, changes } = draft.commit();
  await store.transaction('w', (tx) => tx.putState(storedChanges(state, changes)));
  return store;
}

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

  it('writes nothing of the world when it faults, and tells the actor', async () => {
    const store = await seeded();
    await runCommand(store, 'w', host, command('bump counter'));
    const before = await stored(store);
    const turn = await runCommand(store, 'w', host, command('smash counter'));
    expect(turn.committed).toBe(false);
    if (turn.committed) return;
    expect(turn.fault.name).toBe('IntegerOverflow');
    expect(turn.told.effect).toBe('notice');
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

describe('a write turn of any kind against a store', () => {
  it('writes what its body wrote where it commits, and nothing where it throws', async () => {
    const store = await seeded();
    const before = await stored(store);
    const faulted = await runWriteTurn(
      store,
      'w',
      'wake',
      host,
      { seed: 3, mayHold: null, now: 0 },
      (turn) => {
        turn.draft.mint();
        throw new Error('the body gave up');
      },
    );
    expect(faulted).toMatchObject({ committed: false, fault: { engine: true } });
    expect(await stored(store)).toEqual(before);
    const minted = await runWriteTurn(
      store,
      'w',
      'maintenance',
      host,
      { seed: 4, mayHold: null, now: 0 },
      (turn) => turn.draft.nextSerial(),
    );
    expect(minted).toMatchObject({ committed: true, value: before.serial + 1 });
    expect((await stored(store)).serial).toBe(before.serial + 1);
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
    const admitted = await runArrival(store, 'w', host, at(75), {
      visit: MARTA,
      nickname: 'Marta',
      ...at(75),
    });
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
    const admitted = await runArrival(store, 'w', closed, at(75), {
      visit: visitKey('v-ines'),
      nickname: 'Ines',
      ...at(75),
    });
    expect(admitted.caughtUp).toBeNull();
    expect(admitted.arrived).toEqual({
      committed: false,
      closed: { reason: 'no-arrival-place', words: NOT_ADMITTING },
    });
    expect(await stored(store)).toEqual(before);
  });
});
