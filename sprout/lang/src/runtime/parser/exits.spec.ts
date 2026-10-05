import { describe, expect, it } from 'vitest';

import { typedWords } from '../../declare/addressing.js';
import { declaredId } from '../ids.js';
import { exitNamed, labelWords, type CommandExit } from './exits.js';

const TO = declaredId('maze', ['hall']);

const EXITS: readonly CommandExit[] = [
  { direction: 'north', label: 'deeper into the dark', to: TO },
  { direction: 'north', label: 'toward a grey light', to: TO },
  { direction: 'down', label: 'Down the Coal Stair', to: TO },
  { direction: null, label: 'the way you came', to: TO },
];
const named = (line: string) => exitNamed(typedWords(line), EXITS);

describe('the exit a visitor names', () => {
  it('is the first that applies in the direction named, written out or abbreviated', () => {
    expect(named('north')).toBe(EXITS[0]);
    expect(named('n')).toBe(EXITS[0]);
    expect(named('d')).toBe(EXITS[2]);
  });

  it('is the one whose label was typed, as an alias for its direction, however cased', () => {
    expect(named('toward a grey light')).toBe(EXITS[1]);
    expect(named('down the coal stair')).toBe(EXITS[2]);
  });

  it('drops an article, `my`, `this` or `that` at a label’s start, as typed and as written', () => {
    const exits: readonly CommandExit[] = [
      { direction: 'up', label: 'tree', to: TO },
      { direction: 'down', label: 'The Trap Door', to: TO },
    ];
    const at = (line: string) => exitNamed(typedWords(line), exits);
    for (const line of ['tree', 'the tree', 'a tree', 'my tree', 'this tree', 'that tree']) {
      expect(at(line), line).toBe(exits[0]);
    }
    for (const line of ['trap door', 'the trap door', 'that trap door']) {
      expect(at(line), line).toBe(exits[1]);
    }
    // Only one, and only at the start: a word the label holds inside it is kept.
    expect(at('the the tree')).toBeNull();
    expect(at('trap the door')).toBeNull();
    expect(at('the')).toBeNull();
  });

  it('keeps a label of one word whole, though it is an article', () => {
    expect(labelWords(['the'])).toEqual(['the']);
    expect(labelWords(['the', 'tree'])).toEqual(['tree']);
    expect(labelWords(['tree', 'house'])).toEqual(['tree', 'house']);
  });

  it('is a link by its label alone, since a link has no direction', () => {
    expect(named('the way you came')).toBe(EXITS[3]);
    expect(named('way')).toBeNull();
  });

  it('is none where nothing applies in that direction or answers to the words', () => {
    for (const line of ['south', 's', 'up', 'into the dark', 'north north']) {
      expect(named(line), line).toBeNull();
    }
    expect(exitNamed(['north'], [])).toBeNull();
  });
});
