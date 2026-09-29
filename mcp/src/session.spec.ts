import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { playScript, readScript } from '@overstory/sprout-player';
import { bundleOf, KILN_YARD } from '@overstory/sprout-player/fixtures';

import { arrive, isPresent, leave, openSession, say } from './session.js';

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
