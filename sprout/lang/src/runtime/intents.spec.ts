import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '../bundle/limits.js';
import {
  actorOf,
  CATALOGUE,
  CHEST,
  CRATE,
  KEY,
  MARTA,
  played,
  workshop,
} from '../fixtures/workshop.js';
import { Budget } from './budget.js';
import { Draws } from './draws.js';
import { planIntent, type IntentReading } from './intents.js';
import { parseCommand } from './parser.js';
import { passRules } from './passes.js';
import type { Reading } from './reading.js';
import { readerOf, type WorldState } from './state.js';

/** What reading and planning read in `state`. */
function contextIn(state: WorldState) {
  const reader = readerOf(state);
  const budget = new Budget(DEFAULT_LIMITS.budgets);
  const passes = passRules({
    state: reader,
    kinds: CATALOGUE.lookup,
    caps: CATALOGUE.caps,
    budget,
    names: CATALOGUE.names,
  });
  return { state: reader, catalogue: CATALOGUE, passes, budget };
}

/** `line`, typed by Marta in `state`: the intent it was read as. */
function intended(state: WorldState, line: string): IntentReading {
  const parsed = parseCommand(line, actorOf(state, MARTA), {
    ...contextIn(state),
    draws: new Draws(7),
    nicknames: new Map(),
  });
  if (!('intended' in parsed)) throw new Error(`\`${line}\` was not read as an intent`);
  return parsed.intended;
}

/** A planned step as a case compares it: its verb, and what fills each role. */
const shown = (reading: Reading) => ({
  verb: `${reading.verb.library}.${reading.verb.name}`,
  bindings: Object.fromEntries(reading.bindings),
});

/** The steps `line` plans in `state`. */
const planned = (state: WorldState, line: string) =>
  planIntent(intended(state, line), contextIn(state)).map(shown);

/** The workshop after Marta typed each of `lines`. */
function after(...lines: string[]): WorldState {
  let state = workshop();
  for (const line of lines) state = played(state, MARTA, line).state;
  return state;
}

describe('a line read as an intent', () => {
  it('binds each slot by its name to the thing its words name', () => {
    const state = after('take key');
    const read = intended(state, 'open chest with key');
    expect(`${read.intent.library}.${read.intent.name}`).toBe('sprout.open_with');
    expect(read.actor).toBe(actorOf(state, MARTA));
    expect(Object.fromEntries(read.bindings)).toEqual({ y: { object: CHEST }, x: { object: KEY } });
  });

  it('reads the slots of any of the intent’s phrases, in the phrase’s own order', () => {
    const read = intended(after('take key'), 'use key to open chest');
    expect(Object.fromEntries(read.bindings)).toEqual({ y: { object: CHEST }, x: { object: KEY } });
  });
});

describe('the steps an intent plans', () => {
  it('are each step in order, its roles filled from the slots it names', () => {
    expect(planned(after('take key'), 'open chest with key')).toEqual([
      { verb: 'sprout.unlock', bindings: { target: { object: CHEST }, tool: { object: KEY } } },
      { verb: 'sprout.open', bindings: { target: { object: CHEST } } },
    ]);
  });

  it('leave out a step whose `when` is false in the world the line was typed into', () => {
    expect(planned(after('take key', 'unlock chest with key'), 'open chest with key')).toEqual([
      { verb: 'sprout.open', bindings: { target: { object: CHEST } } },
    ]);
  });

  it('leave out a step whose role the slot’s thing does not fit, without reading its `when`', () => {
    expect(planned(after('take key'), 'open crate with key')).toEqual([
      { verb: 'sprout.open', bindings: { target: { object: CRATE } } },
    ]);
  });

  it('are none where every step is left out', () => {
    expect(planned(after('take key', 'unlock chest with key'), 'pick chest with key')).toEqual([]);
  });
});
