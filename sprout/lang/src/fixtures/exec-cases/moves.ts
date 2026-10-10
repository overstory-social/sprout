// The statement goldens' moves cases. Spec support: the package build leaves it out.

import { at, type Case } from '../exec-cases.js';

export const MOVES: readonly Case[] = [
  // Moving things.
  { name: 'a move that every party allows', area: 'move', body: 'move shelf.jar to basket' },
  {
    name: 'a move into a full place is refused by its accept, in its passage',
    area: 'move',
    body: 'move lamp to shelf',
    heard: ['visitor'],
  },
  {
    name: 'depart is asked before accept',
    area: 'move',
    body: 'move stubborn to shelf',
    heard: ['visitor'],
  },
  {
    name: 'release is asked before accept',
    area: 'move',
    body: 'move keeper.kept to shelf',
    heard: ['visitor'],
  },
  {
    name: 'release refuses alone',
    area: 'move',
    body: 'move keeper.kept to basket',
    heard: ['visitor'],
  },
  {
    name: 'an allow ends the guard that wrote it',
    area: 'move',
    body: 'move shelf.jar to gate',
    heard: ['visitor'],
  },
  {
    name: 'a guard that reaches its refuse refuses',
    area: 'move',
    body: 'move lamp to gate',
    heard: ['visitor'],
  },
  {
    name: 'a refused move ends the body',
    area: 'move',
    body: 'move lamp to shelf\n self.set(:label, "after")',
    heard: ['visitor'],
  },
  {
    name: 'nothing goes inside itself',
    area: 'move',
    body: 'move box to box.inner',
    heard: ['visitor'],
  },
  {
    name: 'a move into what holds nothing faults',
    area: 'move',
    body: 'move lamp to who',
    bind: { who: at('shelf', 'cup') },
  },
  {
    name: 'a move of what is out of range faults',
    area: 'move',
    body: 'move who to shelf',
    bind: { who: at('chest', 'bin') },
  },
  {
    name: 'a move into what is out of range faults',
    area: 'move',
    body: 'move lamp to who',
    bind: { who: at('chest', 'bin') },
  },
  {
    name: 'an actor moved between places is told, and the places tell their people',
    area: 'move',
    kind: 'Dog',
    self: at('dog'),
    body: 'move self to tent',
  },
  {
    name: 'a place speaks to the people in its range when someone arrives',
    area: 'move',
    kind: 'Dog',
    self: at('dog'),
    body: 'move self to lodge',
    state: 'worn',
  },
  {
    name: 'an actor is not put in what holds no actors',
    area: 'move',
    kind: 'Dog',
    self: at('dog'),
    body: 'move self to chest',
    heard: ['visitor'],
  },
  {
    name: 'a move into a full place meets crowded before any guard',
    area: 'move',
    kind: 'Dog',
    self: at('dog'),
    body: 'move who to lodge',
    bind: { who: 'visitor' },
    state: 'closed',
    budgets: { peoplePerPlace: 1 },
    heard: ['visitor'],
  },
  {
    name: 'without a crowd the same move meets the guards',
    area: 'move',
    kind: 'Dog',
    self: at('dog'),
    body: 'move who to lodge',
    bind: { who: 'visitor' },
    state: 'closed',
    heard: ['visitor'],
  },
];
