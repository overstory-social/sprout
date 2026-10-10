import { describe, expect, it } from 'vitest';

import {
  actedBy,
  arrive,
  defaultVisitor,
  freshStage,
  heard,
  leave,
  playInteractive,
  playSteps,
} from '../play.js';
import { scriptOf } from '../fixtures/scripts.js';
import { bundle } from '../fixtures/play.js';

describe('playSteps', () => {
  it('gives each step what it made, marking what a reader read and what faulted', () => {
    const played = playSteps(
      bundle,
      scriptOf('@arrive Marta\n# aside\nMarta> kick kiln\n'),
      'yard.json',
    );
    const [arrived, aside, kicked] = played;
    expect(arrived!.made).toEqual([
      {
        level: 'prose',
        text: 'Marta (described): A kiln yard.',
        words: 'A kiln yard.',
        kind: 'described',
        shown: 'A kiln yard.',
        reader: 'Marta',
      },
    ]);
    expect(aside!.made).toBeNull();
    expect(kicked!.made!.map((made) => [made.words === null, made.level])).toEqual([
      [false, 'prose'],
      [true, 'error'],
    ]);
    expect(kicked!.made!.map((made) => [made.shown, made.reader])).toEqual([
      [kicked!.made![0]!.words, 'Marta'],
      ['[error] IntegerOverflow', null],
    ]);
    expect(kicked!.made![1]!.text).toMatch(/^the command faulted, IntegerOverflow: /);
  });

  it('gives `@seed` nothing made, and a step that made nothing an empty list the transcript writes as (nothing)', () => {
    const played = playSteps(
      bundle,
      scriptOf('@seed 3\n@arrive Marta\nMarta> go in\n@tick\n'),
      'yard.json',
    );
    expect(played.map((one) => one.made?.length ?? null)).toEqual([null, 1, 1, 0]);
    expect(heard([])).toEqual([
      {
        level: 'info',
        text: '(nothing)',
        words: null,
        kind: null,
        shown: '(nothing)',
        reader: null,
      },
    ]);
  });
});

describe('freshStage', () => {
  it('is a world as it loads, at time 0, seed 0, nobody yet arrived', () => {
    const stage = freshStage(bundle);
    expect(stage.now).toBe(0);
    expect(stage.seed).toBe(0);
    expect(stage.visits.size).toBe(0);
    expect(defaultVisitor(stage)).toBeNull();
  });
});

describe('arrive', () => {
  it('seats a returning visitor at the place `at` names, its `accept` asked as a returning visitor’s is', () => {
    const stage = freshStage(bundle);
    expect(arrive(stage, 'Marta', 'shed')).toEqual([
      {
        level: 'prose',
        text: 'Marta (described): A dark shed.',
        words: 'A dark shed.',
        kind: 'described',
        shown: 'A dark shed.',
        reader: 'Marta',
      },
    ]);
  });

  it('throws where `at` names no place, or does not seat them there, since both are a bad --at', () => {
    expect(() => arrive(freshStage(bundle), 'Marta', 'nowhere')).toThrow(
      '`nowhere` is not a place in kiln_yard',
    );
  });
});

describe('defaultVisitor', () => {
  it('names whoever most recently arrived and still stands, falling back once they leave', () => {
    const stage = freshStage(bundle);
    expect(defaultVisitor(stage)).toBeNull();
    arrive(stage, 'Marta');
    expect(defaultVisitor(stage)).toBe('Marta');
    arrive(stage, 'Ines');
    expect(defaultVisitor(stage)).toBe('Ines');
  });

  it('moves a returning nickname to the front again, ahead of who stood while they were away', () => {
    const stage = freshStage(bundle);
    arrive(stage, 'Marta');
    leave(stage, 'Marta', 'test');
    arrive(stage, 'Ines');
    expect(defaultVisitor(stage)).toBe('Ines');
    arrive(stage, 'Marta');
    expect(defaultVisitor(stage)).toBe('Marta');
  });
});

describe('playInteractive', () => {
  it('reads a `Name> text` line exactly as the script grammar does', () => {
    const stage = freshStage(bundle);
    arrive(stage, 'Marta');
    const outcome = playInteractive(stage, 'Marta> fire kiln', 'stdin:2');
    expect(outcome.line).toBe('Marta> fire kiln');
    expect(outcome.step).toEqual({ as: 'Marta', type: 'fire kiln' });
    expect(outcome.made).toEqual([
      {
        level: 'prose',
        text: 'Marta (said): The chamber takes the flame.',
        words: 'The chamber takes the flame.',
        kind: 'said',
        shown: 'The chamber takes the flame.',
        reader: 'Marta',
      },
    ]);
  });

  it('reads a host line and a comment as steps, and a blank line as none, the comment and blank making nothing', () => {
    const stage = freshStage(bundle);
    arrive(stage, 'Marta');
    expect(playInteractive(stage, '# aside', 'stdin:2')).toEqual({
      line: '# aside',
      step: { comment: 'aside' },
      made: null,
    });
    expect(playInteractive(stage, '', 'stdin:3')).toEqual({ line: '', step: null, made: null });
    const ticked = playInteractive(stage, '@tick', 'stdin:4');
    expect(ticked.step).toEqual({ tick: true });
    expect(ticked.made).not.toBeNull();
  });

  it('throws, naming where and what to write, for a line none of the grammar reads', () => {
    const stage = freshStage(bundle);
    arrive(stage, 'Marta');
    expect(() => playInteractive(stage, '@dance', 'stdin:2')).toThrow(
      'stdin:2: `@dance` is not something the host does here.',
    );
    expect(() => playInteractive(stage, '@advance soon', 'stdin:3')).toThrow(
      'stdin:3: write how long passes, as in `@advance 40 minutes`.',
    );
  });

  it('fills in a bare line’s addressee, and throws naming where, where nobody stands to address it', () => {
    const stage = freshStage(bundle);
    arrive(stage, 'Marta');
    const outcome = playInteractive(stage, 'fire kiln', 'stdin:2');
    expect(outcome.line).toBe('Marta> fire kiln');
    expect(outcome.step).toEqual({ as: 'Marta', type: 'fire kiln' });
    expect(outcome.made).toEqual([
      {
        level: 'prose',
        text: 'Marta (said): The chamber takes the flame.',
        words: 'The chamber takes the flame.',
        kind: 'said',
        shown: 'The chamber takes the flame.',
        reader: 'Marta',
      },
    ]);
    expect(() => playInteractive(freshStage(bundle), 'look', 'stdin:1')).toThrow(
      'stdin:1: nobody is standing to hear it',
    );
  });
});

describe('actedBy', () => {
  it('is the world’s `acted` for someone else’s line, as the one watching reads it', () => {
    const stage = freshStage(bundle);
    arrive(stage, 'Marta');
    arrive(stage, 'Ines');
    playInteractive(stage, 'Marta> fire kiln', 'stdin:3');
    expect(actedBy(stage, 'Ines', 'Marta', 'fire kiln')).toEqual(['Marta tries to fire kiln.']);
  });

  it('is the typed line itself where the one watching has never visited', () => {
    const stage = freshStage(bundle);
    arrive(stage, 'Marta');
    expect(actedBy(stage, 'Ines', 'Marta', 'fire kiln')).toEqual(['Marta: fire kiln']);
  });
});
