// The statement goldens' speech cases. Spec support: the package build leaves it out.

import { at, HALL, type Case } from '../exec-cases.js';

export const SPEECH: readonly Case[] = [
  // What is said.
  {
    name: 'a tell reaches the people in the teller’s place',
    area: 'speech',
    body: 'tell "Hello there."',
  },
  {
    name: 'a tell to one reaches a person in range',
    area: 'speech',
    body: 'tell who "For you."',
    bind: { who: 'visitor' },
  },
  {
    name: 'a tell to one out of range reaches nobody',
    area: 'speech',
    body: 'tell who "Not for you."',
    bind: { who: 'pat' },
    state: 'worn',
  },
  { name: 'a tell may name a passage', area: 'speech', body: 'tell named' },
  {
    name: 'a tell inside reaches only the teller’s own occupants',
    area: 'speech',
    kind: 'Wardrobe',
    self: at('wardrobe'),
    body: 'tell inside "Welcome in."',
    state: 'worn',
  },
  {
    name: 'a tell outside reaches only the place around the teller',
    area: 'speech',
    kind: 'Wardrobe',
    self: at('wardrobe'),
    body: 'tell outside "Muffled."',
    state: 'worn',
  },
  {
    name: 'a plain tell from a place that holds actors reaches both audiences',
    area: 'speech',
    kind: 'Wardrobe',
    self: at('wardrobe'),
    body: 'tell "A voice."',
    state: 'worn',
  },
  {
    name: 'a tell carries every name in scope',
    area: 'speech',
    body: 'let n = self.get(:count)\n tell "Count is {n}."',
  },
  {
    name: 'a say is heard by whoever the body speaks to',
    area: 'speech',
    play: true,
    body: 'say "You tap the runner."',
    bind: { actor: 'visitor', here: HALL },
    heard: ['visitor'],
  },
  {
    name: 'a say may name a passage',
    area: 'speech',
    play: true,
    body: 'say named',
    bind: { actor: 'visitor', here: HALL },
    heard: ['visitor'],
  },
  {
    name: 'a tell leaves out the people the reading addresses',
    area: 'speech',
    play: true,
    body: 'say "Aside."\n tell "Overheard."',
    bind: { actor: 'visitor', here: HALL },
    heard: ['visitor'],
    leftOut: ['visitor'],
  },
  {
    name: 'an NPC’s line is heard from it',
    area: 'speech',
    kind: 'Dog',
    self: at('dog'),
    play: true,
    body: 'say "Woof."',
    bind: { actor: 'visitor', here: HALL },
    heard: ['visitor'],
    speaker: at('dog'),
  },
];
