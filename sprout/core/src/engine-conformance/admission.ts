import { NOT_ADMITTING, type NicknameRefusalReason } from '@overstory/sprout/lang';

import { digestOf } from '../log/depth.js';
import { readLog } from '../log/entry.js';
import type { SproutStore } from '../store.js';
import {
  runArrival,
  runCommand,
  runDeparture,
  runMaintenance,
  runTick,
  runWake,
  type NicknameHost,
} from '../turns.js';
import { equal, match, ok } from './check.js';
import {
  COUNTER,
  countOf,
  GLADE,
  HALL,
  INES,
  LAWN,
  MARTA,
  PAT,
  played,
  seeded,
  STAIR,
  STAIR_CELLAR,
  storedIn,
  TALLY,
  type EngineCase,
} from './worlds.js';

// The suite's admission and going away against a store (the spec's The
// host contract › Admission and identity, Time), and what each write
// turn logs (The runtime › The log).

/** A host whose moderation declines no nickname. */
const OPEN: NicknameHost = { moderate: () => true };

const at = (now: number) => ({ now, seed: 4, mayHold: null });
const command = (text: string, now = 0) => ({ visit: MARTA, text, seed: 1, mayHold: null, now });
const tally = (store?: SproutStore) => seeded(TALLY, [[MARTA, HALL, 'Marta']], store);
const kinds = async (store: SproutStore) =>
  (await readLog(store, 'w', { limit: 100 })).map(({ entry }) => entry.kind);

/** Where `visit` stands now, as the store holds them: their instance's container, and their record. */
async function whereIs(store: SproutStore, visit: string) {
  const stored = await storedIn(store);
  const record = stored.visitors.find((one) => one.visit === visit);
  const instance = stored.instances.find((one) => one.id === record?.instance);
  return { record, container: instance?.container ?? null };
}

export const admissionCases: EngineCase[] = [
  {
    name: 'a departure keeps where they stood',
    proves: 'a visitor going away is written out of the tree with where they stood kept',
    async run(make) {
      const store = await tally();
      const turn = await runDeparture(store, 'w', played(make, TALLY), { visit: MARTA, ...at(0) });
      ok(turn.committed, 'the departure commits');
      const { record, container } = await whereIs(store, MARTA);
      equal(container, null, 'where they are in the tree');
      equal(record?.lastPlace, HALL, 'where they last stood');
    },
  },
  {
    name: 'a departure that faults goes quietly',
    proves:
      'a departure that faults is abandoned, and the visitor goes away quietly in a turn of its own, told what that said',
    async run(make) {
      const store = await seeded(STAIR, [[MARTA, STAIR_CELLAR, 'Marta']]);
      const turn = await runDeparture(store, 'w', played(make, STAIR), { visit: MARTA, ...at(0) });
      ok(!turn.committed, 'the departure faults');
      match(turn.fault, { name: 'IntegerOverflow' }, 'its fault');
      equal(
        turn.quietly.effects.map((effect) => [effect.visit, effect.kind, [...effect.paragraphs]]),
        [[MARTA, 'notice', ['You leave, and take what you carry with you.']]],
        'what going quietly told them',
      );
      equal(turn.quietly.cutShort, [], 'who it cut short');
      const { record, container } = await whereIs(store, MARTA);
      equal(container, null, 'where they are in the tree');
      equal(record?.lastPlace, STAIR_CELLAR, 'where they last stood');
    },
  },
  {
    name: 'an arrival runs catch-up first',
    proves:
      'admission runs catch-up, committed first, then admits a returning visitor where they last stood',
    async run(make) {
      const store = await tally();
      const host = played(make, TALLY);
      await runCommand(store, 'w', host, command('rest counter', 0));
      await runDeparture(store, 'w', host, { visit: MARTA, ...at(10) });
      const admitted = await runArrival(
        store,
        'w',
        host,
        at(75),
        { visit: MARTA, nickname: 'Marta', ...at(75) },
        OPEN,
      );
      ok(admitted.caughtUp?.committed === true, 'catch-up committed');
      match(admitted.arrived, { committed: true, value: { returning: true } }, 'the arrival');
      // The counter reads the whole absence, delivered before anyone walked in.
      equal(await countOf(store), 75, 'the counter');
      equal((await whereIs(store, MARTA)).container, HALL, 'where Marta stands');
    },
  },
  {
    name: 'a world that admits no one',
    proves: 'a world whose bundle admits no one runs no catch-up and writes nothing',
    async run(make) {
      const store = await tally();
      const host = played(make, TALLY);
      await runCommand(store, 'w', host, command('rest counter', 0));
      const closed = { ...host, catalogue: { ...host.catalogue, arrival: null } };
      const before = await storedIn(store);
      const admitted = await runArrival(
        store,
        'w',
        closed,
        at(75),
        { visit: INES, nickname: 'Ines', ...at(75) },
        OPEN,
      );
      equal(admitted.caughtUp, null, 'catch-up');
      equal(
        admitted.arrived,
        { committed: false, closed: { reason: 'no-arrival-place', words: NOT_ADMITTING } },
        'the arrival',
      );
      equal(await storedIn(store), before, 'the stored world');
    },
  },
  {
    name: 'a nickname the world refuses',
    proves:
      'a nickname the world or the language reads, one shaped like source, or one someone present holds, is refused in words, running no catch-up, asking no moderation and writing nothing',
    async run(make) {
      const reasons: Record<string, NicknameRefusalReason> = {
        Counter: 'world-word',
        'Hall Ines': 'world-word',
        'Ines When': 'reserved',
        ':ines': 'source-shaped',
        MARTA: 'held',
      };
      const host = played(make, TALLY);
      for (const [nickname, reason] of Object.entries(reasons)) {
        const store = await tally();
        await runCommand(store, 'w', host, command('rest counter', 0));
        const before = await storedIn(store);
        const asked: string[] = [];
        const moderating: NicknameHost = { moderate: (name) => (asked.push(name), true) };
        const admitted = await runArrival(
          store,
          'w',
          host,
          at(75),
          { visit: INES, nickname, ...at(75) },
          moderating,
        );
        equal(admitted.caughtUp, null, `catch-up for ${nickname}`);
        const refused =
          'nicknameRefused' in admitted.arrived ? admitted.arrived.nicknameRefused : null;
        equal(refused?.reason, reason, `why ${nickname} is refused`);
        ok(
          /: choose another nickname\.$/.test(refused?.words ?? ''),
          `the words for ${nickname}: ${refused?.words}`,
        );
        equal(asked, [], `what moderation was asked for ${nickname}`);
        equal(await storedIn(store), before, `the stored world after ${nickname}`);
      }
    },
  },
  {
    name: 'a nickname past the host’s budget',
    proves:
      'a nickname past the host’s nickname budget is refused in words naming the budget, before its moderation is asked',
    async run(make) {
      const store = await tally();
      const capped = played(make, TALLY, { budgets: { nicknameCharacters: 4 } });
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
      const refused =
        'nicknameRefused' in admitted.arrived ? admitted.arrived.nicknameRefused : null;
      equal(refused?.reason, 'too-long', 'why it is refused');
      equal(
        refused?.words,
        '"Ines B" is 6 characters, and a nickname here may have at most 4: choose a shorter one.',
        'its words',
      );
      equal(asked, [], 'what moderation was asked');
    },
  },
  {
    name: 'a nickname moderation declines',
    proves:
      'the host’s moderation is asked of the nickname as it would be kept, and one it declines is refused, writing nothing',
    async run(make) {
      const store = await tally();
      const host = played(make, TALLY);
      await runCommand(store, 'w', host, command('rest counter', 0));
      const before = await storedIn(store);
      const asked: string[] = [];
      const strict: NicknameHost = {
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
      equal(asked, ['Rude Word'], 'what moderation was asked');
      equal(admitted.caughtUp, null, 'catch-up');
      equal(
        admitted.arrived,
        {
          committed: false,
          nicknameRefused: {
            reason: 'moderated',
            nickname: '  Rude   Word ',
            collides: [],
            words: 'That nickname cannot be used here: choose another.',
          },
        },
        'the arrival',
      );
      equal(await storedIn(store), before, 'the stored world');
    },
  },
  {
    name: 'a nickname taken while it was moderated',
    proves:
      'a nickname someone came in under while it was being moderated is refused after catch-up, writing no arrival',
    async run(make) {
      const store = await tally();
      const host = played(make, TALLY);
      const racing: NicknameHost = {
        moderate: async () => {
          const first = await runArrival(
            store,
            'w',
            host,
            at(5),
            { visit: PAT, nickname: 'Pat', ...at(5) },
            OPEN,
          );
          ok(first.arrived.committed, 'Pat came in');
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
      ok(admitted.caughtUp !== null, 'catch-up ran');
      equal(
        'nicknameRefused' in admitted.arrived && admitted.arrived.nicknameRefused.words,
        'Someone here is already called "pat": choose another nickname.',
        'the refusal',
      );
      equal((await whereIs(store, INES)).record, undefined, 'Ines’s record');
      equal((await whereIs(store, PAT)).record?.nickname, 'Pat', 'Pat’s nickname');
    },
  },
  {
    name: 'a nickname held by someone away',
    proves: 'a nickname held only by someone away is admitted, kept as its words single-spaced',
    async run(make) {
      const store = await tally();
      const host = played(make, TALLY);
      await runDeparture(store, 'w', host, { visit: MARTA, ...at(0) });
      const admitted = await runArrival(
        store,
        'w',
        host,
        at(5),
        { visit: INES, nickname: ' Marta ', ...at(5) },
        OPEN,
      );
      match(admitted.arrived, { committed: true, value: { returning: false } }, 'the arrival');
      equal((await whereIs(store, INES)).record?.nickname, 'Marta', 'Ines’s nickname');
    },
  },
  {
    name: 'each write turn is logged',
    proves:
      'one entry is appended per turn that ran, in the order the lock ran them, a faulted one included, with its fault',
    async run(make) {
      const store = await tally();
      const host = played(make, TALLY);
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
      equal(
        await kinds(store),
        [
          'command',
          'command',
          'tick',
          'command',
          'maintenance',
          'departure',
          'maintenance',
          'arrival',
        ],
        'the kinds logged',
      );
      const [bumped, smashed] = await readLog(store, 'w', { limit: 2 });
      match(
        bumped?.entry,
        { kind: 'command', text: 'bump counter', fault: null },
        'the bump’s entry',
      );
      match(
        smashed?.entry,
        {
          kind: 'command',
          fault: { name: 'IntegerOverflow', engine: false },
          effects: [],
          digest: { count: 1 },
        },
        'the smash’s entry',
      );
    },
  },
  {
    name: 'what nobody was told of is a warning in the log',
    proves:
      'a handler’s refused move, by its guard and its words as written, and a send that reached nothing, by the name as written, are logged as warnings, and the visitor reads nothing of either',
    async run(make) {
      const store = await seeded(GLADE, [[MARTA, LAWN, 'Marta']]);
      const host = played(make, GLADE);
      const touched = await runCommand(store, 'w', host, command('touch pedestal'));
      ok(touched.committed, 'the touch commits');
      match(touched.effects, [{ kind: 'said', paragraphs: ['You touch it.'] }], 'what Marta reads');
      await runCommand(store, 'w', host, command('blow horn'));
      const [touchedEntry, blown] = (await readLog(store, 'w', { limit: 100 })).slice(-2);
      match(
        touchedEntry?.entry,
        {
          kind: 'command',
          warnings: [
            {
              level: 'warning',
              what: 'unread-refusal',
              item: 'glade.lawn.pedestal.gem',
              refuser: 'glade.lawn.pedestal',
              guard: 'release',
              words: '"The pedestal keeps its gem."',
            },
          ],
        },
        'the touch’s entry',
      );
      match(
        blown?.entry,
        {
          kind: 'command',
          warnings: [
            {
              level: 'warning',
              what: 'lost-send',
              by: 'glade.lawn.horn',
              target: 'shed.bell',
              message: 'glade.called',
            },
          ],
        },
        'the blow’s entry',
      );
    },
  },
  {
    name: 'the log’s depth',
    proves:
      'a turn’s effects are kept whole at debug depth, and as their count and digest at play depth, the default',
    async run(make) {
      const play = await tally();
      await runCommand(play, 'w', played(make, TALLY), command('smash counter'));
      const debug = await tally();
      await runCommand(
        debug,
        'w',
        played(make, TALLY, { logDepth: 'debug' }),
        command('smash counter'),
      );
      const kept = (await readLog(debug, 'w', { limit: 100 })).at(-1);
      const digested = (await readLog(play, 'w', { limit: 100 })).at(-1);
      ok(
        kept?.entry.kind === 'command' && digested?.entry.kind === 'command',
        'both logged a command',
      );
      match(kept.entry.effects, [{ kind: 'notice', visit: MARTA }], 'the effects kept');
      equal(kept.entry.digest, undefined, 'the digest at debug depth');
      equal(digested.entry.digest, digestOf(kept.entry.effects), 'the digest at play depth');
      equal(
        { ...digested.entry, digest: undefined },
        { ...kept.entry, effects: [] },
        'the rest of the entry',
      );
    },
  },
  {
    name: 'a turn that ran nothing is not logged',
    proves:
      'a tick of an empty place, a wake no longer pending, a refused nickname and a world that admits no one log nothing',
    async run(make) {
      const store = await tally();
      const host = played(make, TALLY);
      await runDeparture(store, 'w', host, { visit: MARTA, ...at(0) });
      const before = await kinds(store);
      match(
        await runTick(store, 'w', host, { place: HALL, ...at(10) }),
        { unoccupied: true },
        'the tick',
      );
      equal(
        await runWake(store, 'w', host, { object: COUNTER, serial: 99, ...at(10) }),
        { committed: false, unwoken: true },
        'the wake',
      );
      const refused = await runArrival(
        store,
        'w',
        host,
        at(20),
        { visit: INES, nickname: 'Counter', ...at(20) },
        OPEN,
      );
      ok('nicknameRefused' in refused.arrived, 'the nickname is refused');
      const closed = { ...host, catalogue: { ...host.catalogue, arrival: null } };
      await runArrival(
        store,
        'w',
        closed,
        at(30),
        { visit: MARTA, nickname: 'Marta', ...at(30) },
        OPEN,
      );
      equal(await kinds(store), before, 'the kinds logged');
    },
  },
  {
    name: 'a consumed wake is logged',
    proves:
      'a wake that faulted is logged with its fault and nothing it said, under the budgets it ran with',
    async run(make) {
      const store = await tally();
      const host = played(make, TALLY);
      await runCommand(store, 'w', host, command('rest counter', 0));
      const [due] = host.engine!.dueWakes(await storedIn(store), 500);
      ok(due !== undefined, 'the counter’s wake is due');
      const wide = played(make, TALLY, { budgets: { steps: 70_000 } });
      await runWake(store, 'w', wide, { object: due.object, serial: due.serial, ...at(500) });
      const [, woke] = await readLog(store, 'w', { limit: 10 });
      match(
        woke?.entry,
        {
          kind: 'wake',
          object: COUNTER,
          serial: due.serial,
          now: 500,
          seed: 4,
          fault: { name: 'ValueOutOfRange' },
          effects: [],
          budgets: { steps: 70_000 },
        },
        'the wake’s entry',
      );
    },
  },
];
