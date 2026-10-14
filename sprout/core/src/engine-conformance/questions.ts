import { visitKey } from '@overstory/sprout/lang';

import { memoryStore } from '../memory-store.js';
import { applyChanges } from '../state.js';
import { runCommand } from '../turns.js';
import { equal, match, ok } from './check.js';
import {
  COUNTER,
  DOCK,
  GAUGE,
  HALL,
  LAMPLIGHT,
  LAMPLIT_HALL,
  LABEL,
  MARTA,
  played,
  QUAY,
  seeded,
  storedIn,
  TALLY,
  type EngineCase,
} from './worlds.js';

// The suite's engine as a host reaches it directly (core's engine.ts):
// a turn as a step, a line's commands one at a time, what a host asks
// of the committed world between turns, and every answer for the stored
// state it is handed, whatever it was handed before.

const command = (text: string) => ({ visit: MARTA, text, seed: 1, mayHold: null, now: 0 });

export const questionCases: EngineCase[] = [
  {
    name: 'a turn as a step',
    proves:
      'a committed command gives its effects and whose views it made stale, what the store writes and the entry the log keeps',
    async run(make) {
      const store = await seeded(TALLY, [[MARTA, HALL, 'Marta']]);
      const engine = played(make, TALLY).engine!;
      const step = engine.command(await storedIn(store), command('bump counter'));
      ok(step.turn.committed, 'the bump commits');
      equal(step.turn.stale, [MARTA], 'whose views it made stale');
      equal(
        step.turn.effects.map((one) => one.paragraphs),
        [['Click.']],
        'what it said',
      );
      match(
        step.changes,
        { upsert: [{ id: COUNTER, properties: { n: { value: 1 } } }] },
        'what the store writes',
      );
      match(
        step.entry,
        { kind: 'command', text: 'bump counter', seed: 1, fault: null },
        'the entry',
      );
    },
  },
  {
    name: 'a line’s commands one at a time',
    proves:
      'a line hands out its commands one at a time, each once the one before it ran, and then says it is done',
    async run(make) {
      const store = await seeded(TALLY, [[MARTA, HALL, 'Marta']]);
      const host = played(make, TALLY);
      const line = host.engine!.line(command('bump counter then bump gauge'), () => 11);
      const first = line.next(null);
      match(first, { visit: MARTA, text: 'bump counter', seed: 1 }, 'the first command');
      const turn = await runCommand(store, 'w', host, first!);
      const second = line.next(turn);
      match(second, { visit: MARTA, text: 'bump gauge', seed: 11 }, 'the second command');
      ok((await runCommand(store, 'w', host, second!)).committed, 'the second command commits');
      equal(line.next(turn), null, 'the line once it is done');
    },
  },
  {
    name: 'where a visitor stands',
    proves:
      'where a visitor stands is the place and what else it holds, named for them; nothing for one who never came',
    async run(make) {
      const store = await seeded(TALLY, [[MARTA, HALL, 'Marta']]);
      const engine = played(make, TALLY).engine!;
      equal(
        engine.standing(await storedIn(store), MARTA),
        {
          place: { id: HALL, name: 'a hall' },
          here: [
            { id: COUNTER, name: 'a counter' },
            { id: GAUGE, name: 'a gauge' },
          ],
        },
        'where Marta stands',
      );
      equal(
        engine.standing(await storedIn(store), visitKey('v-nobody')),
        null,
        'where nobody stands',
      );
    },
  },
  {
    name: 'the host’s questions between turns',
    proves:
      'the places a visitor stands in, the wakes due, who hears a visitor and why a nickname is refused are answered of the committed world',
    async run(make) {
      const store = await seeded(TALLY, [[MARTA, HALL, 'Marta']]);
      const engine = played(make, TALLY).engine!;
      const stored = await storedIn(store);
      equal(engine.occupiedPlaces(stored), [HALL], 'the occupied places');
      equal(engine.dueWakes(stored, 0), [], 'the wakes due');
      equal(engine.hearers(stored, MARTA), { place: HALL, to: [MARTA] }, 'who hears Marta');
      equal(engine.hearers(stored, visitKey('v-nobody')), null, 'who hears nobody');
      match(
        engine.nicknameRefusal(stored, visitKey('v-ines'), 'Marta'),
        { reason: 'held' },
        'Marta’s nickname for Ines',
      );
      equal(engine.nicknameRefusal(stored, visitKey('v-ines'), 'Ines'), null, 'Ines’s own');
    },
  },
  {
    name: 'every answer is for the state handed in',
    proves:
      'a turn or a poll answers for the stored state it is handed, never for one a turn before it ran on, landed or not',
    async run(make) {
      const store = await seeded(LAMPLIGHT, [[MARTA, LAMPLIT_HALL, 'Marta']]);
      const engine = played(make, LAMPLIGHT).engine!;
      const dim = await storedIn(store);
      const step = engine.command(dim, { ...command('light lamp') });
      ok(step.turn.committed && step.changes !== null, 'lighting the lamp commits');
      equal(
        engine.view(dim, MARTA).view.description,
        ['The hall is dim.'],
        'the view of the state it ran on',
      );
      const bright = applyChanges(dim, step.changes);
      equal(
        engine.view(bright, MARTA).view.description,
        ['The hall is bright.'],
        'the view of the state it wrote',
      );
      equal(
        engine.view(dim, MARTA).view.description,
        ['The hall is dim.'],
        'the view of the first again',
      );
      // Another store's state, handed to the same engine, is its own.
      const other = await seeded(LAMPLIGHT, [[MARTA, LAMPLIT_HALL, 'Marta']], memoryStore());
      equal(
        engine.view(await storedIn(other), MARTA).view.description,
        ['The hall is dim.'],
        'another store’s',
      );
      ok(
        engine.command(bright, command('light lamp')).turn.committed,
        'a command on the state it wrote',
      );
    },
  },
  {
    name: 'a declared object moved out of one since destroyed, read afresh',
    proves:
      'read afresh, a stored state finds a declared object where its record put it, out of a destroyed container, with what is declared inside it and never written',
    async run(make) {
      const store = await seeded(DOCK, [[MARTA, QUAY, 'Marta']]);
      const host = played(make, DOCK);
      ok((await runCommand(store, 'w', host, command('inflate pile'))).committed, 'the inflate');
      const stored = await storedIn(store);
      equal(
        stored.instances.some((one) => one.id === LABEL),
        false,
        'whether the label, which never moved, is stored',
      );
      // A copy is a stored state no engine has read, as a host reading its store afresh holds.
      const step = played(make, DOCK).engine!.command(
        structuredClone(stored),
        command('read label'),
      );
      match(
        step.turn.effects,
        [{ kind: 'said', from: LABEL, visit: MARTA, paragraphs: ['Frobozz.'] }],
        'reading the label',
      );
    },
  },
];
