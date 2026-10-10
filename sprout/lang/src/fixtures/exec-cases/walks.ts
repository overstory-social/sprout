// The statement goldens' walks cases. Spec support: the package build leaves it out.

import type { Case } from '../exec-cases.js';

export const WALKS: readonly Case[] = [
  // Walking contents.
  {
    name: 'each visits what a container holds that composes the kind',
    area: 'each',
    body: 'each pot: Jar in shelf { self.adjust(:count, 1) }',
  },
  {
    name: 'each visits every thing without a filter',
    area: 'each',
    body: 'each thing in shelf { self.adjust(:count, 1) }',
  },
  {
    name: 'each walks a shut chest as empty',
    area: 'each',
    body: 'each thing in chest { self.adjust(:count, 2) }',
  },
  {
    name: 'each walks an open chest',
    area: 'each',
    body: 'each thing in chest { self.adjust(:count, 2) }',
    state: 'worn',
  },
  {
    name: 'an each inside an each is charged by the step',
    area: 'each',
    body: 'each a in shelf { each b in shelf { self.adjust(:count, 1) } }',
  },
  {
    name: 'an each past the step budget faults',
    area: 'each',
    body: 'each a in shelf { each b in shelf { self.adjust(:count, 3) } }',
    budgets: { steps: 40 },
  },
  {
    name: 'what an each walks is fixed before its first visit',
    area: 'each',
    body: 'each thing in shelf { move thing to basket }',
  },
  {
    name: 'a refused move in an each ends the body',
    area: 'each',
    body: 'each thing in shelf { move thing to gate\n self.adjust(:count, 1) }',
    heard: ['visitor'],
  },
];
