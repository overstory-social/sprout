import { describe, expect, it } from 'vitest';

import { typedWords } from '../../declare/addressing.js';
import { study } from '../../fixtures/parser.js';
import { beginsCommand, chainPoints, commandAfter, commandBefore } from './chain.js';

const { catalogue } = study();
const points = (line: string) => chainPoints(typedWords(line), catalogue);

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

describe('where `and` may join two commands', () => {
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
});
