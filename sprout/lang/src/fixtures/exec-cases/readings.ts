// The statement goldens' readings cases. Spec support: the package build leaves it out.

import { at, type Case } from '../exec-cases.js';

export const READINGS: readonly Case[] = [
  // An `act` runs a reading on the spot, and the reading pass is C07's: these bodies are
  // located for the C specs of the statement, and C07 adds the cases that run them.
  {
    name: 'an act names its roles by what they are bound to',
    area: 'act',
    kind: 'Dog',
    self: at('dog'),
    body: 'act sniff (target: lamp)',
    unrun: true,
  },
];
