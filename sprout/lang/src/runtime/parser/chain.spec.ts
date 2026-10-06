import { describe, expect, it } from 'vitest';

import { typedWords } from '../../declare/addressing.js';
import { chooser } from '../../fixtures/parse.js';
import { GONG, LAMP, study, typed } from '../../fixtures/parser.js';
import type { Bound, Reading } from '../reading.js';
import { beginsCommand, chainPoints, commandAfter, commandBefore, stretchAfter } from './chain.js';

const { catalogue } = study();
const points = (line: string) => chainPoints(typedWords(line), catalogue);

/** A reading as `verb role=what …`, what each role binds written short. */
function shown(reading: Reading): string {
  const what = (bound: Bound): string =>
    'object' in bound
      ? bound.object
      : 'set' in bound
        ? bound.set.join('+')
        : 'exit' in bound
          ? (bound.exit.direction ?? bound.exit.label)
          : 'value';
  const roles = [...reading.bindings].map(([role, bound]) => `${role}=${what(bound)}`);
  return [reading.verb.name, ...roles].join(' ');
}

/**
 * Every turn `line` runs in the study, in order, each shown as its
 * reading or as the answer that stops the line; a command `and` or a
 * comma joined is read in turn from its own words.
 */
function turnsOf(line: string): string[] {
  const outcome = typed(study(), line);
  if ('answer' in outcome) return [`answer ${outcome.answer}`];
  if (!('verb' in outcome.understood)) return [`intent ${outcome.understood.intent.name}`];
  const turns = [shown(outcome.understood)];
  for (const next of outcome.rest) {
    if ('text' in next) turns.push(...turnsOf(next.text));
    else if (next.reread === undefined) turns.push(shown(next.planned));
    else turns.push(`afresh ${next.reread.words}`);
  }
  return turns;
}

describe('a word that begins a command', () => {
  it('is the first word of a phrase a visitor may type, a verb’s or an intent’s', () => {
    expect(beginsCommand('take', catalogue)).toBe(true);
    expect(beginsCommand('pick', catalogue)).toBe(true);
    expect(beginsCommand('look', catalogue)).toBe(true);
    expect(beginsCommand('lamp', catalogue)).toBe(false);
    expect(beginsCommand('up', catalogue)).toBe(true);
  });

  it('is a direction, written out or abbreviated, where a phrase begins with a way out', () => {
    expect(beginsCommand('north', catalogue)).toBe(true);
    expect(beginsCommand('n', catalogue)).toBe(true);
    expect(beginsCommand('sw', catalogue)).toBe(true);
  });
});

describe('where `and` or a comma may join two commands', () => {
  it('is each comma with a command before it and a word beginning one after it', () => {
    expect(points('take lamp, take gong')).toEqual([2]);
    expect(points('take lamp, look, n')).toEqual([2, 4]);
    expect(points('take lamp, gong and brass key')).toEqual([]);
  });

  it('is the `and` alone where a comma stands before it', () => {
    expect(points('take lamp, and take gong')).toEqual([3]);
  });

  it('splits the line about the comma, every comma just before it going with it', () => {
    const words = typedWords('take lamp, , take gong');
    expect(points('take lamp, , take gong')).toEqual([3]);
    expect(commandBefore(words, 3)).toEqual(['take', 'lamp']);
    expect(commandAfter(words, 3)).toBe('take gong');
    expect(points(', take lamp')).toEqual([]);
  });

  it('reads a name that would begin after a comma up to the next `and` or comma', () => {
    const words = typedWords('take lamp, turn dial, look');
    expect(stretchAfter(words, 2)).toEqual(['turn', 'dial']);
  });

  it('is each `and` with a command before it and a word beginning one after it', () => {
    expect(points('take lamp and take gong')).toEqual([2]);
    expect(points('take lamp and look and take gong')).toEqual([2, 4]);
    expect(points('take lamp and n')).toEqual([2]);
  });

  it('is nowhere a run of things stands, nor at either end of the line', () => {
    expect(points('take lamp and gong')).toEqual([]);
    expect(points('and take lamp')).toEqual([]);
    expect(points(', and take lamp')).toEqual([]);
    expect(points('take lamp and')).toEqual([]);
  });

  it('splits the line about the `and`, a comma before it going with it', () => {
    const words = typedWords('take lamp, and take gong');
    expect(points('take lamp, and take gong')).toEqual([3]);
    expect(commandBefore(words, 3)).toEqual(['take', 'lamp']);
    expect(commandAfter(words, 3)).toBe('take gong');
    expect(commandBefore(typedWords('take lamp and look'), 2)).toEqual(['take', 'lamp']);
  });

  it('reads a name that would begin after it up to the next `and` or comma', () => {
    const words = typedWords('take lamp and light bulb, and take gong');
    expect(stretchAfter(words, 2)).toEqual(['light', 'bulb']);
    expect(stretchAfter(typedWords('take lamp and look'), 2)).toEqual(['look']);
  });
});

describe('a line of commands joined by commas', () => {
  it('runs each command as a turn of its own, in the order written', () => {
    expect(turnsOf('take lamp, examine gong, n')).toEqual([
      `take target=${LAMP}`,
      `examine target=${GONG}`,
      'go way=north',
    ]);
  });

  it('keeps a run of things whole, a comma before a name and not a verb', () => {
    expect(turnsOf('take lamp, gong and brass key')).toEqual(
      turnsOf('take lamp and gong and brass key'),
    );
    expect(turnsOf('take lamp, gong and brass key')).toHaveLength(3);
    expect(turnsOf('take lamp, gong, look')).toEqual([...turnsOf('take lamp and gong'), 'look']);
  });

  it('is read whole where a reading takes it whole, as `and` before a verb is', () => {
    expect(turnsOf('juggle lamp, gong')).toEqual(turnsOf('juggle lamp and gong'));
  });

  it('stops at a command no phrase reads', () => {
    expect(turnsOf('dance, take lamp')).toEqual(['answer unknown']);
  });

  it('has no addressee: a line opening with a person and a comma is `unknown`', () => {
    expect(turnsOf('oskar, take lamp')).toEqual(['answer unknown']);
    expect(turnsOf('oskar, look')).toEqual(['answer unknown']);
  });
});

describe('commands joined by commas and `and` (generated)', () => {
  const COMMANDS: readonly string[] = [
    'take lamp',
    'examine the brass disc',
    'look',
    'n',
    'take iron key and gong',
    'take brass key, lamp and gong',
    'juggle lamp and gong',
    'unlock door with iron key',
  ];

  it('runs exactly the turns each command runs alone, in the order written', () => {
    const c = chooser(459);
    for (let run = 0; run < 150; run++) {
      const picked = Array.from({ length: 2 + c.below(3) }, () => c.one(COMMANDS));
      let line = picked[0]!;
      for (const command of picked.slice(1)) line += c.one([', ', ' and ', ', and ']) + command;
      expect(turnsOf(line), line).toEqual(picked.flatMap(turnsOf));
    }
  });
});
