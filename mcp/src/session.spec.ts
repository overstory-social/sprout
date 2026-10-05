import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { playScript, readScript } from '@overstory/sprout-player';
import { bundleOf, KILN_YARD } from '@overstory/sprout-player/fixtures';

import { arrive, isPresent, leave, openSession, resumeSession, say } from './session.js';

const kilnYard = bundleOf('kiln_yard', KILN_YARD);

describe('a visitor in a session', () => {
  it('reads what a person playing reads: the prose written to them, one paragraph to a line', () => {
    const session = openSession(kilnYard);
    expect(arrive(session, 'Marta')).toEqual({ text: 'A kiln yard.', refused: false });
    expect(say(session, 'Marta', 'fire kiln')).toEqual({
      text: 'The chamber takes the flame.',
      refused: false,
    });
    expect(say(session, 'Marta', 'fire kiln').text).toBe('It is firing already.');
    expect(say(session, 'Marta', 'xyzzy').text).toBe('That is not something you can do here.');
  });

  it('reads a fault as the world’s words for it and its name, never its detail', () => {
    const session = openSession(kilnYard);
    arrive(session, 'Marta');
    const kicked = say(session, 'Marta', 'kick kiln').text;
    expect(kicked).toBe(
      'Something in this world has gone wrong, and nothing has changed.\n[error] IntegerOverflow',
    );
    expect(kicked).not.toContain('2147483648');
  });

  it('reads what another visitor’s turn wrote to them on their next call, and never what was written to someone else', () => {
    const session = openSession(kilnYard);
    arrive(session, 'Marta');
    arrive(session, 'Ines');
    expect(say(session, 'Marta', 'look').text).toBe('Ines arrives.\nA kiln yard.');
    say(session, 'Ines', 'go in');
    // Marta reads Ines going, and not the shed Ines reads.
    expect(say(session, 'Marta', 'look').text).toBe('Ines leaves for a shed.\nA kiln yard.');
  });

  it('is refused, playing nothing, where it is not here, types nothing, or types more than one line', () => {
    const session = openSession(kilnYard);
    expect(say(session, 'Marta', 'look')).toEqual({
      text: 'Marta is not here: arrive first.',
      refused: true,
    });
    expect(leave(session, 'Marta').refused).toBe(true);
    arrive(session, 'Marta');
    expect(arrive(session, 'Marta')).toEqual({ text: 'Marta is already here.', refused: true });
    expect(say(session, 'Marta', '  ').refused).toBe(true);
    expect(say(session, 'Marta', 'look\n@advance 1 hours')).toEqual({
      text: 'Say one line at a time.',
      refused: true,
    });
    expect(session.recorded).toHaveLength(1);
  });

  it('is turned away at the door in the host’s words, where its name will not do', () => {
    const session = openSession(kilnYard);
    expect(arrive(session, 'kiln')).toEqual({
      text: '"kiln" is a word this world already reads, so "kiln" would not always mean you: choose another nickname.',
      refused: true,
    });
    expect(isPresent(session, 'kiln')).toBe(false);
  });

  it('leaves, reading what it reads as it goes, and may come back', () => {
    const session = openSession(kilnYard);
    arrive(session, 'Marta');
    expect(leave(session, 'Marta')).toEqual({
      text: 'You leave, and take what you carry with you.',
      refused: false,
    });
    expect(isPresent(session, 'Marta')).toBe(false);
    expect(arrive(session, 'Marta').text).toBe('A kiln yard.');
  });
});

describe('what the host sets', () => {
  it('caps each visitor’s commands, and refuses one past the cap without playing it', () => {
    const session = openSession(kilnYard, { turnCap: 2 });
    arrive(session, 'Marta');
    arrive(session, 'Ines');
    say(session, 'Marta', 'look');
    say(session, 'Marta', 'look');
    expect(say(session, 'Marta', 'look')).toEqual({
      text: 'You have taken all 2 turns this session allows.',
      refused: true,
    });
    // Another visitor's count is their own.
    expect(say(session, 'Ines', 'look').refused).toBe(false);
  });

  it('moves time after each command, a tick of every occupied place and then the wakes due', () => {
    const session = openSession(kilnYard, { advancePerTurn: 1800 });
    arrive(session, 'Marta');
    say(session, 'Marta', 'fire kiln');
    // The kiln asked to be woken in an hour; the second half-hour delivers it.
    expect(say(session, 'Marta', 'look').text).toContain('The kiln ticks as it cools.');
    expect(session.recorded.map((step) => Object.keys(step)[0])).toEqual([
      'arrive',
      'as',
      'tick',
      'advance',
      'as',
      'tick',
      'advance',
    ]);
  });

  it('starts from the seed it sets, and records the session as a script that plays back as written', () => {
    const record = join(mkdtempSync(join(tmpdir(), 'sprout-mcp-')), 'run.json');
    const session = openSession(kilnYard, { seed: 9, record, advancePerTurn: 60 });
    arrive(session, 'Marta');
    say(session, 'Marta', 'fire kiln');
    say(session, 'Marta', 'kick kiln');
    leave(session, 'Marta');
    const script = readScript(readFileSync(record, 'utf8'), 'run.json');
    expect(script.steps[0]).toEqual({ seed: 9 });
    expect(playScript(kilnYard, script, 'run.json')).toEqual(script);
    // The recording holds the fault in full, as a visitor never reads it.
    expect(readFileSync(record, 'utf8')).toContain('2147483648');
  });
});

describe('the recording, where it cannot be written', () => {
  it('refuses to open a session at all, before anyone plays', () => {
    expect(() => openSession(kilnYard, { record: '/nowhere/at/all/run.json' })).toThrow(/ENOENT/);
  });

  it('tells the host, and never the visitor, when it falls behind mid-session', () => {
    const folder = join(mkdtempSync(join(tmpdir(), 'sprout-mcp-')), 'secret');
    mkdirSync(folder);
    const warned: string[] = [];
    const session = openSession(kilnYard, { record: join(folder, 'run.json') }, (words) =>
      warned.push(words),
    );
    arrive(session, 'Marta');
    rmSync(folder, { recursive: true });
    const looked = say(session, 'Marta', 'look');
    expect(looked).toEqual({ text: 'A kiln yard.', refused: false });
    expect(looked.text).not.toContain('secret');
    expect(warned).toHaveLength(1);
    expect(warned[0]).toMatch(/^could not record to .*secret\/run\.json: ENOENT/);
  });
});

describe('an inbox', () => {
  it('keeps nothing for a visitor who is not here, so one who returns reads only what is new', () => {
    const session = openSession(kilnYard);
    arrive(session, 'Marta');
    arrive(session, 'Ines');
    leave(session, 'Ines');
    say(session, 'Marta', 'fire kiln');
    expect(session.inboxes.has('Ines')).toBe(false);
    expect(arrive(session, 'Ines').text).toBe('A kiln yard.');
  });
});

describe('a session resumed from its recording', () => {
  const recordIn = () => join(mkdtempSync(join(tmpdir(), 'sprout-mcp-')), 'run.json');

  it('carries on where the session was, keeping what was recorded and each visitor’s count', () => {
    const record = recordIn();
    const first = openSession(kilnYard, { seed: 4, record, turnCap: 2, advancePerTurn: 60 });
    arrive(first, 'Marta');
    say(first, 'Marta', 'fire kiln');
    const was = readFileSync(record, 'utf8');
    const warned: string[] = [];
    const again = resumeSession(
      kilnYard,
      { seed: 4, record, turnCap: 2, advancePerTurn: 60 },
      (words) => warned.push(words),
    );
    expect(readFileSync(record, 'utf8')).toBe(was);
    expect(isPresent(again, 'Marta')).toBe(true);
    expect(arrive(again, 'Marta').refused).toBe(true);
    // The kiln is still firing, and Marta has one command of her two left.
    expect(say(again, 'Marta', 'fire kiln').text).toMatch(/^It is firing already\./);
    expect(say(again, 'Marta', 'look').refused).toBe(true);
    expect(warned).toEqual([]);
    const script = readScript(readFileSync(record, 'utf8'), 'run.json');
    expect(script.steps[0]).toEqual({ seed: 4 });
    expect(playScript(kilnYard, script, 'run.json')).toEqual(script);
  });

  it('gives a returning visitor nothing that was written to them before the restart', () => {
    const record = recordIn();
    const first = openSession(kilnYard, { record });
    arrive(first, 'Marta');
    arrive(first, 'Ines');
    const again = resumeSession(kilnYard, { record });
    expect(say(again, 'Marta', 'look').text).toBe('A kiln yard.');
  });

  it('tells the host, and plays on, where a step no longer makes what was recorded', () => {
    const record = recordIn();
    writeFileSync(
      record,
      JSON.stringify({ steps: [{ arrive: 'Marta', expect: [{ words: 'A different yard.' }] }] }),
    );
    const warned: string[] = [];
    const again = resumeSession(kilnYard, { record }, (words) => warned.push(words));
    expect(warned).toEqual([`${record}, step 1: played again, it does not make what was recorded`]);
    expect(isPresent(again, 'Marta')).toBe(true);
  });

  it('opens as a new session where nothing is recorded yet', () => {
    const record = recordIn();
    const session = resumeSession(kilnYard, { seed: 2, record });
    expect(readScript(readFileSync(record, 'utf8'), 'run.json').steps).toEqual([{ seed: 2 }]);
    expect(arrive(session, 'Marta').text).toBe('A kiln yard.');
  });
});
