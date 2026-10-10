// The statement goldens' time cases. Spec support: the package build leaves it out.

import type { Case } from '../exec-cases.js';

export const TIME: readonly Case[] = [
  // Time.
  { name: 'a wake is raised to the host’s shortest', area: 'wake', body: 'wake in 5 seconds' },
  { name: 'a wake asked for longer is kept', area: 'wake', body: 'wake in 3 hours' },
  {
    name: 'a wake past the pending cap faults',
    area: 'wake',
    body: 'wake in 2 minutes\n wake in 3 minutes',
  },
  {
    name: 'wakes are kept oldest first',
    area: 'wake',
    body: 'wake in 3 hours\n wake in 2 minutes',
    budgets: { pendingWakesPerObject: 2 },
  },
  {
    name: 'a host’s longer floor raises a wake further',
    area: 'wake',
    body: 'wake in 90 seconds',
    budgets: { shortestWakeSeconds: 120 },
  },
  {
    name: 'cancel wakes takes back every pending wake',
    area: 'wake',
    body: 'cancel wakes',
    state: 'worn',
  },
  {
    name: 'cancel wakes then wake puts off what was coming',
    area: 'wake',
    body: 'cancel wakes\n wake in 3 minutes',
    state: 'worn',
  },
  {
    name: 'cancel wakes with none pending does nothing',
    area: 'wake',
    body: 'cancel wakes\n cancel wakes',
  },
];
