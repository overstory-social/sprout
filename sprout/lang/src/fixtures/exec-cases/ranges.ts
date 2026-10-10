// The statement goldens' range walks. Spec support: the package build leaves it out.

import { at, type RangeCase } from '../exec-cases.js';

export const RANGES: readonly RangeCase[] = [
  {
    name: 'a runner reaches its place and what the place holds',
    asker: at('runner'),
    asking: null,
    state: 'fresh',
  },
  {
    name: 'a shut chest is reached as a thing, and holds its own',
    asker: at('runner'),
    asking: null,
    state: 'fresh',
  },
  { name: 'an open chest passes what it holds', asker: at('runner'), asking: null, state: 'worn' },
  {
    name: 'a glass case passes only the message it names',
    asker: at('runner'),
    asking: 'ping',
    state: 'fresh',
  },
  {
    name: 'a container asked about itself reaches its own contents',
    asker: at('chest'),
    asking: null,
    state: 'fresh',
  },
  {
    name: 'what is inside a shut chest reaches the chest as a surface',
    asker: at('chest', 'coin'),
    asking: null,
    state: 'fresh',
  },
  {
    name: 'what is inside an open chest reaches the place outside',
    asker: at('chest', 'coin'),
    asking: null,
    state: 'worn',
  },
  { name: 'a person reaches what is in the place', asker: 'visitor', asking: null, state: 'worn' },
];
