// Every statement golden case, in the order the bench is written. Spec support: the package build
// leaves it out.

import type { Case } from '../exec-cases.js';
import { WRITES } from './writes.js';
import { WALKS } from './walks.js';
import { MOVES } from './moves.js';
import { LIVES } from './lives.js';
import { MESSAGES } from './messages.js';
import { TIME } from './time.js';
import { SPEECH } from './speech.js';
import { READINGS } from './readings.js';
import { EXTENSIONS } from './extensions.js';

export const CASES: readonly Case[] = [
  ...WRITES,
  ...WALKS,
  ...MOVES,
  ...LIVES,
  ...MESSAGES,
  ...TIME,
  ...SPEECH,
  ...READINGS,
  ...EXTENSIONS,
];
