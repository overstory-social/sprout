// The statement goldens' writes cases. Spec support: the package build leaves it out.

import { throughBystander, intoText, at, type Case } from '../exec-cases.js';

export const WRITES: readonly Case[] = [
  // Writes to `self`.
  {
    name: 'a let is bound for the rest of the block',
    area: 'write',
    body: 'let n = self.get(:count) + 2\n self.set(:count, n)',
  },
  { name: 'set a string', area: 'write', body: 'self.set(:label, "sugar")' },
  { name: 'set an option', area: 'write', body: 'self.set(:glaze, :tenmoku)' },
  {
    name: 'adjust clamps at the top',
    area: 'write',
    body: 'self.adjust(:count, 5 + 5)',
    state: 'worn',
  },
  {
    name: 'adjust clamps at the bottom',
    area: 'write',
    body: 'self.adjust(:count, 0 - 9)',
    state: 'worn',
  },
  { name: 'add an element to a list', area: 'write', body: 'self.add(:wards, :tenmoku)' },
  { name: 'add an element the list holds', area: 'write', body: 'self.add(:wards, :shino)' },
  { name: 'remove an element from a list', area: 'write', body: 'self.remove(:wards, :shino)' },
  {
    name: 'remove an element the list lacks',
    area: 'write',
    body: 'self.remove(:wards, :tenmoku)',
  },
  {
    name: 'a new element in a full list faults',
    area: 'write',
    body: 'self.add(:wards, :none)',
    caps: { listElements: 1 },
  },
  {
    name: 'remember writes what self remembers about an actor',
    area: 'write',
    body: 'if (who.is(sprout.Actor)) { who.remember(:visits, 3) }',
    bind: { who: 'visitor' },
  },
  {
    name: 'adjust on memory steps from the default',
    area: 'write',
    body: 'if (who.is(sprout.Actor)) { who.adjust(:visits, 2) }',
    bind: { who: 'visitor' },
  },
  {
    name: 'adjust on memory steps from what was written',
    area: 'write',
    body: 'if (who.is(sprout.Actor)) { who.adjust(:visits, 3) }',
    bind: { who: 'visitor' },
    state: 'worn',
  },
  {
    name: 'a write that changes a watched property queues its hook',
    area: 'write',
    body: 'self.set(:count, 6)',
    state: 'worn',
  },
  {
    name: 'a write that changes nothing queues no hook',
    area: 'write',
    body: 'self.set(:count, 4)',
    state: 'worn',
  },
  {
    name: 'two changes queue two hooks, each with the value it replaced',
    area: 'write',
    body: 'self.set(:count, 1)\n self.set(:count, 2)',
  },
  {
    name: 'a value the property cannot hold faults',
    area: 'write',
    body: 'self.set(:count, self.get(:count) + 12)',
    state: 'worn',
  },
  {
    name: 'only self writes self',
    area: 'write',
    body: 'self.set(:count, 7)',
    bind: { bystander: at('shelf', 'jar') },
    patch: throughBystander,
  },
  {
    name: 'text reaches a body that acts',
    area: 'write',
    body: 'tell "Text stands in."',
    patch: intoText,
  },
  // Conditions.
  {
    name: 'an if takes its then',
    area: 'if',
    body: 'if (self.get(:count) == 0) { self.set(:label, "zero") } else { self.set(:label, "more") }',
  },
  {
    name: 'an if takes its else',
    area: 'if',
    body: 'if (self.get(:count) == 0) { self.set(:label, "none") } else { self.set(:label, "some") }',
    state: 'worn',
  },
  {
    name: 'an else if is a step of its own',
    area: 'if',
    body: 'if (self.get(:count) > 5) { self.set(:label, "big") } else if (self.get(:count) > 2) { self.set(:label, "mid") } else { self.set(:label, "low") }',
    state: 'worn',
  },
  {
    name: 'a let lives to the end of its block',
    area: 'if',
    body: 'let a = 1\n if (a == 1) { let b = a + 1\n self.set(:count, b) }',
  },
  {
    name: 'a condition that narrows a name binds it in its branch',
    area: 'if',
    body: 'if (shelf.is(Shelf)) { self.set(:count, shelf.count) }',
  },
];
