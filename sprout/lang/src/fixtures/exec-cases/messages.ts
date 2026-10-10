// The statement goldens' messages cases. Spec support: the package build leaves it out.

import type { Case } from '../exec-cases.js';

export const MESSAGES: readonly Case[] = [
  // Messages.
  {
    name: 'a send is delivered once the body has ended, and answered',
    area: 'send',
    body: 'send bell :ping',
  },
  {
    name: 'sends are delivered in the order queued, breadth-first',
    area: 'send',
    body: 'send bell :ping\n send lamp :ping',
  },
  {
    name: 'a send to what is out of range goes nowhere',
    area: 'send',
    body: 'send chest.coin :ping',
  },
  {
    name: 'a send to what is in range of an open chest is delivered',
    area: 'send',
    body: 'send chest.coin :ping',
    state: 'worn',
  },
  {
    name: 'a broadcast walks the sender’s range, into a container that passes the message',
    area: 'send',
    body: 'broadcast :ping',
  },
  {
    name: 'a broadcast reaches into an open chest',
    area: 'send',
    body: 'broadcast :ping',
    state: 'worn',
  },
  {
    name: 'an each stops at a container that refuses the question',
    area: 'each',
    body: 'each thing in glass { self.adjust(:count, 2) }',
  },
  {
    name: 'a cascade past the depth budget faults',
    area: 'bus',
    body: 'send bell :chain with 1',
  },
  {
    name: 'a cascade within a smaller depth budget faults at it',
    area: 'bus',
    body: 'send bell :chain with 2',
    budgets: { cascadeDepth: 5 },
  },
  {
    name: 'events past the budget fault',
    area: 'bus',
    body: 'send bell :chain with 3',
    budgets: { events: 4 },
  },
  {
    name: 'a hook and a handler each run in the order queued',
    area: 'bus',
    body: 'self.set(:count, 3)\n send bell :ping',
    state: 'worn',
  },
];
