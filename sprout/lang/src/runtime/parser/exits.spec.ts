import { describe, expect, it } from 'vitest';

import { typedWords } from '../../declare/addressing.js';
import { declaredId } from '../ids.js';
import { exitNamed, type CommandExit } from './exits.js';

const TO = declaredId('maze', ['hall']);

const EXITS: readonly CommandExit[] = [
  { direction: 'north', label: 'deeper into the dark', to: TO },
  { direction: 'north', label: 'toward a grey light', to: TO },
  { direction: 'down', label: 'Down the Coal Stair', to: TO },
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

  it('is none where nothing applies in that direction or answers to the words', () => {
    for (const line of ['south', 's', 'up', 'into the dark', 'north north']) {
      expect(named(line), line).toBeNull();
    }
    expect(exitNamed(['north'], [])).toBeNull();
  });
});
