// The statement goldens' readings cases. Spec support: the package build leaves it out.

import { at, type Case } from '../exec-cases.js';

export const READINGS: readonly Case[] = [
  {
    name: 'an act names its roles by what they are bound to',
    area: 'act',
    kind: 'Dog',
    self: at('dog'),
    body: 'act sniff (target: lamp)',
  },
  {
    name: 'an act the consent pass refuses is said to whoever hears the actor and ends the body',
    area: 'act',
    kind: 'Dog',
    self: at('dog'),
    body: 'act bark (target: lamp)\nself.adjust(:sniffed, 5)',
  },
  {
    name: 'an act at what is out of the actor’s range faults the turn',
    area: 'act',
    kind: 'Dog',
    self: at('dog'),
    bind: { who: at('chest', 'coin') },
    body: 'act sniff (target: who)',
  },
  {
    name: 'an act is one level deeper against the cascade depth',
    area: 'act',
    kind: 'Dog',
    self: at('dog'),
    body: 'act sniff (target: lamp)',
    budgets: { cascadeDepth: 0 },
  },
];
