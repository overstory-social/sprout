import type { GivenCommand } from '../engine.js';
import { reentrant } from '../conformance.js';
import { readLog } from '../log/entry.js';
import type { SproutStore } from '../store.js';
import { runCommand, runCommandLine, runMaintenance, runTick, runWake } from '../turns.js';
import { equal, match, ok, rejects } from './check.js';
import {
  BARN,
  BELFRY,
  BELFRY_FOLLOWS,
  BELFRY_GONE,
  BELFRY_OWN_FOLLOWS,
  CANDLE,
  CHAPEL,
  COUNTER,
  COURT,
  FOLLOWED,
  FOLLOWED_BELL,
  FOLLOWED_HALL,
  countOf,
  GAUGE,
  HALL,
  HIDEOUT,
  HIDEOUT_HALL,
  HIDEOUT_VAULT,
  INES,
  LOFT,
  MARTA,
  NAVE,
  OWN_FOLLOWED,
  OWN_FOLLOWED_BELL,
  OWN_FOLLOWED_HALL,
  PEBBLE,
  played,
  PORCH,
  propertyOf,
  seeded,
  STEPS,
  STONE,
  storedIn,
  TALLY,
  THIEF,
  TOWER,
  YARD,
  type EngineCase,
  type MakeEngine,
} from './worlds.js';

// The suite's write turns against a store (the spec's The runtime ›
// Turns; Parsing › Intents, Sequences; Time): a command, the commands of
// a line, a tick, a wake and catch-up, each run under the world's lock
// through the engine the host names, and judged by what the store holds
// after it and what the turn gave.

/** Marta's `text`, typed at `now` with seed 1. */
const command = (text: string, now = 0) => ({ visit: MARTA, text, seed: 1, mayHold: null, now });

/** The tally with Marta standing in the hall. */
const tally = (store?: SproutStore) => seeded(TALLY, [[MARTA, HALL, 'Marta']], store);

/** Seeds 11, 12, … for the turns of a line after its first. */
const seeds = () => {
  let next = 10;
  return () => (next += 1);
};

const committed = (turns: readonly GivenCommand[]) => turns.map((turn) => turn.committed);

/** Rest the counter at `asked` under `host`, and hand back the wake it asks for, as at `now`. */
async function rested(make: MakeEngine, store: SproutStore, asked: number, now: number) {
  const host = played(make, TALLY);
  await runCommand(store, 'w', host, command('rest counter', asked));
  const [due] = host.engine!.dueWakes(await storedIn(store), now);
  ok(due !== undefined, 'the rested counter asks for a wake');
  return { object: due.object, serial: due.serial, now, seed: 5, mayHold: null };
}

export const turnCases: EngineCase[] = [
  {
    name: 'a command asks for time to pass',
    proves:
      'a command whose `do` passes time says how long the host is to let pass, lowered to the host’s longest pass, and a command that passes none asks for none',
    async run(make) {
      const store = await seeded(PORCH, [[MARTA, STEPS, 'Marta']]);
      const dozed = await runCommand(store, 'w', played(make, PORCH), command('doze on bench'));
      match(dozed, { committed: true, value: { passes: 3600 } }, 'two hours, lowered to one');
      const longer = played(make, PORCH, { budgets: { longestPassSeconds: 3 * 3600 } });
      const whole = await runCommand(store, 'w', longer, command('doze on bench'));
      match(whole, { committed: true, value: { passes: 2 * 3600 } }, 'two hours, whole');
      const looked = await runCommand(store, 'w', longer, command('look'));
      match(looked, { committed: true, value: { passes: 0 } }, 'a look');
    },
  },
  {
    name: 'a command writes what it committed',
    proves:
      'a committed command writes its changes, the next turn reads them, and it gives what it said, rendered, as its effects',
    async run(make) {
      const store = await tally();
      const host = played(make, TALLY);
      const turn = await runCommand(store, 'w', host, command('bump counter'));
      ok(turn.committed, 'a bump commits');
      match(
        turn.effects,
        [{ kind: 'said', from: COUNTER, visit: MARTA, paragraphs: ['Click.'] }],
        'its effects',
      );
      equal(turn.stale, [MARTA], 'whose views it made stale');
      equal(await countOf(store), 1, 'the counter after one bump');
      await runCommand(store, 'w', host, command('bump counter'));
      equal(await countOf(store), 2, 'the counter after two bumps');
    },
  },
  {
    name: 'a command that faults writes nothing',
    proves:
      'a command that faults writes nothing of the world, gives its fault, and tells the one who typed',
    async run(make) {
      const store = await tally();
      const host = played(make, TALLY);
      await runCommand(store, 'w', host, command('bump counter'));
      const before = await storedIn(store);
      const turn = await runCommand(store, 'w', host, command('smash counter'));
      ok(!turn.committed, 'a smash faults');
      match(turn.fault, { name: 'IntegerOverflow', engine: false }, 'its fault');
      equal(
        turn.effects.map((one) => [one.kind, one.visit]),
        [['notice', MARTA]],
        'what the one who typed is told',
      );
      equal(await storedIn(store), before, 'the stored world');
    },
  },
  {
    name: 'a move past what its destination holds by measure is refused',
    proves:
      'a take that would carry the taker past its capacity by measure is refused in the engine’s `too_heavy` and moves nothing, and one within it is taken',
    async run(make) {
      const store = await seeded(YARD, [[MARTA, COURT, 'Marta']]);
      const host = played(make, YARD);
      const refused = await runCommand(store, 'w', host, command('take stone'));
      match(
        refused.effects,
        [{ kind: 'refused', visit: MARTA, paragraphs: ['You cannot hold a stone.'] }],
        'what taking the stone says',
      );
      const held = async (id: string) =>
        (await storedIn(store)).instances.find((one) => one.id === id)?.container;
      equal(await held(STONE), undefined, 'the stone, still where it was declared');
      const taken = await runCommand(store, 'w', host, command('take pebble'));
      match(
        taken.effects,
        [{ kind: 'said', visit: MARTA, paragraphs: ['You take a pebble.'] }],
        'what taking the pebble says',
      );
      ok((await held(PEBBLE)) !== undefined, 'the pebble, moved');
    },
  },
  {
    name: '`all` in a set role the actor takes things by leaves out what is carried',
    proves:
      '`all` in a set role only the actor plays, whose own part moves its things to itself, leaves out what the visitor carries before it counts to the host’s bound, and a set role whose actor takes nothing keeps it',
    async run(make) {
      const store = await seeded(BARN, [[MARTA, LOFT, 'Marta']]);
      const host = played(make, BARN, { budgets: { setRoleObjects: 1 } });
      await runCommand(store, 'w', host, command('gather bale'));
      const gathered = await runCommand(store, 'w', host, command('gather all'));
      match(
        gathered.effects,
        [{ kind: 'said', visit: MARTA, paragraphs: ['A fork: gathered.'] }],
        'gathering all with the bale in hand',
      );
      const juggled = await runCommand(store, 'w', host, command('juggle all'));
      match(
        juggled.effects,
        [{ kind: 'said', visit: MARTA, paragraphs: ['You juggle 1.'] }],
        'juggling all, one thing bound',
      );
    },
  },
  {
    name: 'write turns are serialized',
    proves:
      'commands run at once on one world each read what the one before committed, so none loses a write',
    async run(make) {
      const store = await tally();
      const host = played(make, TALLY);
      const turns = await Promise.all(
        Array.from({ length: 5 }, () => runCommand(store, 'w', host, command('bump counter'))),
      );
      equal(committed(turns), [true, true, true, true, true], 'each committed');
      equal(await countOf(store), 5, 'the counter');
    },
  },
  {
    name: 'a command waits on the lock',
    proves:
      'a command waits on a write turn that holds the lock, while a read does not and sees the state before',
    async run(make) {
      const store = await tally();
      const host = played(make, TALLY);
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
      equal(await countOf(store), 0, 'the counter read while the lock is held');
      ok(!done, 'the command still waits');
      release();
      await held;
      ok((await bumped).committed, 'the command ran once the lock was let go');
      equal(await countOf(store), 1, 'the counter');
    },
  },
  {
    name: 'a command commits once when its body runs twice',
    proves:
      'a store that runs a transaction body twice has the command committed once, the second run reading the state the first rolled back',
    async run(make) {
      const store = reentrant(await tally());
      const turn = await runCommand(store, 'w', played(make, TALLY), command('bump counter'));
      ok(turn.committed, 'it commits');
      equal(await countOf(store), 1, 'the counter');
    },
  },
  {
    name: 'an intent runs its steps as turns',
    proves:
      'each step an intent planned runs as a command turn of its own, seeded from the line and logged with what was planned',
    async run(make) {
      const store = await tally();
      const turns = await runCommandLine(
        store,
        'w',
        played(make, TALLY),
        command('twice counter'),
        seeds(),
      );
      equal(committed(turns), [true, true], 'the turns');
      equal(await countOf(store), 2, 'the counter');
      const logged = (await readLog(store, 'w', { limit: 10 })).map(({ entry }) => entry);
      match(
        logged,
        [
          { kind: 'command', text: 'twice counter', seed: 1, planned: null },
          {
            kind: 'command',
            text: 'twice counter',
            seed: 11,
            planned: {
              verb: { library: 'tally', name: 'bump' },
              bindings: [['target', { object: COUNTER }]],
            },
          },
        ],
        'what the log keeps',
      );
    },
  },
  {
    name: 'an intent stops at a fault',
    proves: 'no step runs after one that faults, and what ran before it stays done',
    async run(make) {
      const store = await tally();
      const turns = await runCommandLine(
        store,
        'w',
        played(make, TALLY),
        command('wreck counter'),
        seeds(),
      );
      equal(committed(turns), [true, false], 'the turns');
      equal(await countOf(store), 1, 'the counter');
    },
  },
  {
    name: 'a line runs each command as a turn',
    proves:
      'each command a line holds runs as a turn of its own, logged with its own words and seed',
    async run(make) {
      const store = await tally();
      const turns = await runCommandLine(
        store,
        'w',
        played(make, TALLY),
        command('bump counter then bump gauge. bump counter'),
        seeds(),
      );
      equal(committed(turns), [true, true, true], 'the turns');
      equal(await countOf(store), 2, 'the counter');
      equal(await countOf(store, GAUGE), 1, 'the gauge');
      const logged = (await readLog(store, 'w', { limit: 10 })).map(({ entry }) => entry);
      equal(
        logged.map((entry) => [
          entry.kind === 'command' && entry.text,
          'seed' in entry && entry.seed,
        ]),
        [
          ['bump counter', 1],
          ['bump gauge', 11],
          ['bump counter', 12],
        ],
        'each turn’s words and seed',
      );
    },
  },
  {
    name: 'a line stops at a fault',
    proves: 'no command runs after one that faults, and a line read as one verb is the one turn',
    async run(make) {
      const host = played(make, TALLY);
      const faulting = await runCommandLine(
        await tally(),
        'w',
        host,
        command('smash counter then bump counter'),
        seeds(),
      );
      equal(committed(faulting), [false], 'a line whose first command faults');
      const one = await runCommandLine(await tally(), 'w', host, command('bump counter'), seeds());
      equal(committed(one), [true], 'a line of one verb');
    },
  },
  {
    name: 'lines of two visitors interleave',
    proves:
      'two visitors’ lines run at once, their turns interleaved by the lock, each line running its own commands',
    async run(make) {
      const store = await seeded(TALLY, [
        [MARTA, HALL, 'Marta'],
        [INES, HALL, 'Ines'],
      ]);
      const host = played(make, TALLY);
      const [marta, ines] = await Promise.all([
        runCommandLine(store, 'w', host, command('twice counter'), seeds()),
        runCommandLine(
          store,
          'w',
          host,
          { ...command('bump gauge then bump gauge'), visit: INES },
          seeds(),
        ),
      ]);
      equal(committed(marta), [true, true], 'Marta’s turns');
      equal(committed(ines), [true, true], 'Ines’s turns');
      equal(await countOf(store), 2, 'the counter');
      equal(await countOf(store, GAUGE), 2, 'the gauge');
    },
  },
  {
    name: 'a tick writes the place’s last tick',
    proves:
      'a tick writes the instant it ran as the place’s last tick where it commits, and one asked for before the last is refused, writing nothing',
    async run(make) {
      const store = await tally();
      const host = played(make, TALLY);
      const tick = (now: number) => ({ place: HALL, now, seed: 2, mayHold: null });
      const lastTick = async () =>
        (await storedIn(store)).instances.find((one) => one.id === HALL)?.lastTick;
      equal(await lastTick(), undefined, 'the hall before any tick');
      ok((await runTick(store, 'w', host, tick(50))).committed, 'the first tick commits');
      equal(await lastTick(), 50, 'the hall’s last tick');
      ok((await runTick(store, 'w', host, tick(80))).committed, 'the next tick commits');
      equal(await lastTick(), 80, 'the hall’s last tick after the next');
      const before = await storedIn(store);
      await rejects(
        () => runTick(store, 'w', host, tick(40)),
        /does not run backwards/,
        'a tick before the last',
      );
      equal(await storedIn(store), before, 'the stored world');
    },
  },
  {
    name: 'a wake writes what it did',
    proves:
      'a wake asked at a command’s instant is due a minute on, writes what it did where it commits, and is no longer pending',
    async run(make) {
      const store = await tally();
      const host = played(make, TALLY);
      const wake = await rested(make, store, 100, 190);
      equal(
        host.engine!.dueWakes(await storedIn(store), 159),
        [],
        'the wakes due before the minute',
      );
      ok((await runWake(store, 'w', host, wake)).committed, 'the wake commits');
      equal(await countOf(store), 90, 'the counter holds the seconds it waited');
      equal(
        (await storedIn(store)).instances.find((one) => one.id === COUNTER)?.wakes ?? [],
        [],
        'its wakes',
      );
      equal(
        await runWake(store, 'w', host, wake),
        { committed: false, unwoken: true },
        'the same wake again',
      );
    },
  },
  {
    name: 'a wake that faults is consumed',
    proves: 'a wake that faults writes only its consumption, so it is not retried',
    async run(make) {
      const store = await tally();
      const wake = await rested(make, store, 0, 500);
      const turn = await runWake(store, 'w', played(make, TALLY), wake);
      match(turn, { committed: false, fault: { name: 'ValueOutOfRange' } }, 'the wake');
      equal(await countOf(store), 0, 'the counter');
      equal(
        (await storedIn(store)).instances.find((one) => one.id === COUNTER)?.wakes ?? [],
        [],
        'its wakes',
      );
    },
  },
  {
    name: 'catch-up writes what it kept',
    proves:
      'catch-up delivers what fell due, and a wake that faults is consumed in the same write while the others are delivered',
    async run(make) {
      const store = await tally();
      const host = played(make, TALLY);
      await runCommand(store, 'w', host, command('rest counter', 0));
      ok(
        (await runMaintenance(store, 'w', host, { now: 75, seed: 6, mayHold: null })).committed,
        'catch-up',
      );
      equal(await countOf(store), 75, 'the counter');
      await runCommand(store, 'w', host, command('rest counter', 100));
      await runCommand(store, 'w', host, command('rest gauge', 150));
      // The counter has waited 120 seconds, past what it holds; the gauge 70.
      await runMaintenance(store, 'w', host, { now: 220, seed: 7, mayHold: null });
      equal(await countOf(store), 75, 'the counter, whose wake faulted');
      equal(await countOf(store, GAUGE), 70, 'the gauge');
      equal(host.engine!.dueWakes(await storedIn(store), 10_000), [], 'the wakes left');
    },
  },
  {
    name: 'a command accounts for what it ran',
    proves:
      'a command’s account names every handler and hook it ran, in order, by the kind that wrote it, what it answers and where',
    async run(make) {
      const store = await seeded(BELFRY, [[MARTA, TOWER, 'Marta']]);
      const host = played(make, BELFRY);
      const step = host.engine!.command(await storedIn(store), command('ring bell'));
      equal(
        step.account,
        {
          ran: [
            { origin: 'belfry.Clapper', on: 'belfry.struck', at: 'clapper.sprout:3:3' },
            { origin: 'belfry.Clapper', on: 'changed :swings', at: 'clapper.sprout:4:3' },
          ],
          answered: null,
          refused: false,
        },
        'the account of ringing the bell',
      );
    },
  },
  {
    name: 'a command accounts for the line it was answered with and a refusal',
    proves:
      'a line the parser answers is accounted for by the engine line it said, and a reading the consent pass refused is told apart from one that ran',
    async run(make) {
      const store = await seeded(BELFRY, [[MARTA, TOWER, 'Marta']]);
      const host = played(make, BELFRY);
      const stored = await storedIn(store);
      const answered = host.engine!.command(stored, command('xyzzy'));
      equal(answered.account, { ran: [], answered: 'unknown', refused: false }, 'an unread line');
      const refused = host.engine!.command(stored, command('open chest'));
      equal(refused.account, { ran: [], answered: null, refused: true }, 'a refused reading');
    },
  },
  {
    name: 'a known verb whose noun names nothing in the world is answered as not here',
    proves:
      'a line a verb’s phrase reads whose noun holds a word nothing in the world is named by is answered with `not_here`, and a line no phrase reads with `unknown`',
    async run(make) {
      const store = await seeded(BELFRY, [[MARTA, TOWER, 'Marta']]);
      const host = played(make, BELFRY);
      const stored = await storedIn(store);
      const named = host.engine!.command(stored, command('ring jewels'));
      equal(
        named.account,
        { ran: [], answered: 'not_here', refused: false },
        'a noun nothing is called',
      );
      const unread = host.engine!.command(stored, command('xyzzy jewels'));
      equal(
        unread.account,
        { ran: [], answered: 'unknown', refused: false },
        'a line no phrase reads',
      );
    },
  },
  {
    name: '`drop all` with empty hands is told so',
    proves:
      '`all` in a role whose things the visitor carries, leaving nothing while their hands are empty, is answered with `empty_handed` in the standard library’s words',
    async run(make) {
      const store = await seeded(BELFRY, [[MARTA, TOWER, 'Marta']]);
      const host = played(make, BELFRY);
      const dropped = await runCommand(store, 'w', host, command('drop all'));
      match(
        dropped.effects,
        [{ visit: MARTA, paragraphs: ["You aren't carrying anything."] }],
        'dropping all from empty hands',
      );
      const step = host.engine!.command(await storedIn(store), command('drop all'));
      equal(
        step.account,
        { ran: [], answered: 'empty_handed', refused: false },
        'the account of it',
      );
    },
  },
  {
    name: 'a displaced command accounts for coming in',
    proves:
      'a command whose visitor’s place is gone reads nothing they typed, and accounts for what their coming in at the arrival place ran',
    async run(make) {
      const store = await seeded(BELFRY, [[MARTA, BELFRY_GONE, 'Marta']]);
      const host = played(make, BELFRY);
      const step = host.engine!.command(await storedIn(store), command('ring bell'));
      match(step.turn, { committed: true, value: { displaced: {} } }, 'the command');
      equal(
        step.account,
        {
          ran: [{ origin: 'belfry.Tower', on: 'entered', at: 'tower.sprout:2:3' }],
          answered: null,
          refused: false,
        },
        'the account of coming in',
      );
    },
  },
  {
    name: 'catch-up leaves a later wake pending',
    proves:
      'catch-up delivers each object’s oldest due wake, and leaves the later one of an object whose wake faulted pending for live time',
    async run(make) {
      const store = await tally();
      const twice = played(make, TALLY, { budgets: { pendingWakesPerObject: 2 } });
      await runCommand(store, 'w', twice, command('rest counter', 0));
      await runCommand(store, 'w', twice, command('rest counter', 10));
      await runCommand(store, 'w', twice, command('rest gauge', 50));
      await runMaintenance(store, 'w', twice, { now: 120, seed: 9, mayHold: null });
      equal(await countOf(store, GAUGE), 70, 'the gauge');
      const later = twice.engine!.dueWakes(await storedIn(store), 120);
      equal(
        later.map((one) => [one.object, one.askedAt]),
        [[COUNTER, 10]],
        'the wakes due',
      );
    },
  },
  {
    name: 'an unseen thing is out of sight',
    proves:
      'a thing that holds `:unseen` true is not named by a visitor, and its move is told to nobody, while a message still reaches it',
    async run(make) {
      const store = await seeded(HIDEOUT, [
        [MARTA, HIDEOUT_HALL, 'Marta'],
        [INES, HIDEOUT_VAULT, 'Ines'],
      ]);
      const host = played(make, HIDEOUT);
      const named = await runCommand(store, 'w', host, command('examine thief'));
      match(
        named.effects,
        [{ visit: MARTA, paragraphs: ['You see nothing like that here.'] }],
        'naming the thief',
      );
      const rung = await runCommand(store, 'w', host, command('ring bell'));
      ok(rung.committed, 'ringing the bell commits');
      equal(
        rung.effects.map((one) => [one.kind, one.visit]),
        [['said', MARTA]],
        'who reads what the ringing did',
      );
      const thief = (await storedIn(store)).instances.find((one) => one.id === THIEF);
      equal(thief?.container, HIDEOUT_VAULT, 'where the thief went');
    },
  },
  {
    name: 'a carried thing tells its holder',
    proves:
      'a `tell` from a thing in a person’s hands reaches that person and nobody else in the place, and from inside a shut container they carry reaches nobody',
    async run(make) {
      const store = await seeded(CHAPEL, [
        [MARTA, NAVE, 'Marta'],
        [INES, NAVE, 'Ines'],
      ]);
      const host = played(make, CHAPEL);
      const typed = async (text: string, now: number) =>
        ok((await runCommand(store, 'w', host, command(text, now))).committed, `Marta's ${text}`);
      const woken = async (now: number) => {
        const [due] = host.engine!.dueWakes(await storedIn(store), now);
        ok(due !== undefined && due.object === CANDLE, 'the lit candle asks for a wake');
        const turn = await runWake(store, 'w', host, {
          object: due.object,
          serial: due.serial,
          now,
          seed: 5,
          mayHold: null,
        });
        ok(turn.committed, 'the wake commits');
        return turn.effects;
      };
      await typed('take candle', 0);
      await typed('light candle', 0);
      match(
        await woken(60),
        [
          {
            kind: 'told',
            from: CANDLE,
            visit: MARTA,
            paragraphs: ['The candle grows shorter.'],
          },
        ],
        'what the candle in Marta’s hands tells, and to whom',
      );
      await typed('take tin', 60);
      await typed('put candle in tin', 60);
      await typed('close tin', 60);
      equal(await woken(120), [], 'what the candle in the shut tin she carries tells');
    },
  },
  {
    name: 'what follows a command',
    proves:
      'after a person’s command, once the engine has answered it, what they carry, then their place, then the world run their `after command`, nearest first; a refused command is followed too, after its refusal, and an exit’s refusal with the way it tried bound',
    async run(make) {
      const store = await seeded(BELFRY_FOLLOWS, [[MARTA, FOLLOWED_HALL, 'Marta']]);
      const host = played(make, BELFRY_FOLLOWS);
      const taken = await runCommand(store, 'w', host, command('take bell'));
      ok(taken.committed, 'the take commits');
      match(
        taken.effects,
        [
          { kind: 'said', visit: MARTA, paragraphs: ['You take a bell.'] },
          { kind: 'said', from: FOLLOWED_BELL, visit: MARTA, paragraphs: ['The bell hums.'] },
          { kind: 'told', from: FOLLOWED_HALL, visit: MARTA, paragraphs: ['The hall echoes.'] },
        ],
        'what the take, the bell in her hands and the hall said, in that order',
      );
      equal(await propertyOf(store, FOLLOWED, 'commands', 0), 1, 'the commands the world counted');
      const waited = await runCommand(store, 'w', host, command('wait'));
      match(
        waited.effects,
        [
          { kind: 'said', visit: MARTA, paragraphs: ['Time passes.'] },
          { kind: 'said', from: FOLLOWED_BELL, visit: MARTA, paragraphs: ['The bell hums.'] },
          { kind: 'told', from: FOLLOWED_HALL, visit: MARTA, paragraphs: ['The hall echoes.'] },
        ],
        'the engine’s answer to `wait`, then what follows it',
      );
      equal(await propertyOf(store, FOLLOWED, 'commands', 0), 2, 'the commands the world counted');
      const again = await runCommand(store, 'w', host, command('take bell'));
      match(
        again.effects,
        [
          { kind: 'refused', visit: MARTA, paragraphs: ['You already have it.'] },
          { kind: 'said', from: FOLLOWED_BELL, visit: MARTA, paragraphs: ['The bell hums.'] },
          { kind: 'told', from: FOLLOWED_HALL, visit: MARTA, paragraphs: ['The hall echoes.'] },
        ],
        'a refused take, then what follows it',
      );
      equal(await propertyOf(store, FOLLOWED, 'commands', 0), 3, 'the count after the refusal');
      const barred = await runCommand(store, 'w', host, command('north'));
      match(
        barred.effects,
        [
          { kind: 'refused', visit: MARTA, paragraphs: ['The door is barred.'] },
          { kind: 'said', from: FOLLOWED_BELL, visit: MARTA, paragraphs: ['The bell hums.'] },
          { kind: 'told', from: FOLLOWED_HALL, visit: MARTA, paragraphs: ['The bar rattles.'] },
        ],
        'an exit’s refusal, then what follows it, the hall reading the way it tried',
      );
      equal(
        await propertyOf(store, FOLLOWED, 'commands', 0),
        4,
        'the count after the exit’s refusal',
      );
      const unread = await runCommand(store, 'w', host, command('xyzzy'));
      equal(
        unread.effects.length,
        1,
        'a line nobody understood is answered, and followed by nothing',
      );
      equal(
        await propertyOf(store, FOLLOWED, 'commands', 0),
        4,
        'the count after a line nobody understood',
      );
    },
  },
  {
    name: 'what an object or the world writes for itself follows a command',
    proves:
      'an `after command` written in an object’s own body or the world’s runs where no declared kind writes one, nearest first as a kind’s would',
    async run(make) {
      const store = await seeded(BELFRY_OWN_FOLLOWS, [[MARTA, OWN_FOLLOWED_HALL, 'Marta']]);
      const host = played(make, BELFRY_OWN_FOLLOWS);
      const taken = await runCommand(store, 'w', host, command('take bell'));
      ok(taken.committed, 'the take commits');
      match(
        taken.effects,
        [
          { kind: 'said', visit: MARTA, paragraphs: ['You take a bell.'] },
          { kind: 'said', from: OWN_FOLLOWED_BELL, visit: MARTA, paragraphs: ['The bell hums.'] },
          { kind: 'told', from: OWN_FOLLOWED_HALL, visit: MARTA, paragraphs: ['The hall echoes.'] },
        ],
        'what the take, the bell in her hands and the hall said, in that order',
      );
      equal(
        await propertyOf(store, OWN_FOLLOWED, 'commands', 0),
        1,
        'the commands the world counted',
      );
    },
  },
];
