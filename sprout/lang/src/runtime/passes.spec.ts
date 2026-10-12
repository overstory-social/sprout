import { describe, expect, it } from 'vitest';

import { BUS, CASE, CHEST, eventTurn, HALL, LANTERN, setOn, WORLD } from '../fixtures/events.js';
import type { DeclaredMessage } from '../declare/messages.js';
import { ARRIVED, DEPARTED, engineMessage } from '../declare/engine-messages.js';
import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { compiledWorld } from '../fixtures/bundle.js';
import { Budget, BudgetExhausted } from './budget.js';
import { catalogueOf } from './catalogue.js';
import { initialState } from './load.js';
import { readerOf } from './state.js';
import { passRules } from './passes.js';

const message = (name: string): DeclaredMessage => BUS.messages.qualified('bus', name)!;

describe('a container answers with the rule its kind writes', () => {
  it('`pass :m` for its own message, and `pass any` for the rest', () => {
    const one = eventTurn();
    expect(one.passes(CASE, message('lit'))).toBe(true);
    expect(one.passes(CASE, message('rang'))).toBe(false);
    expect(one.passes(CASE, 'any')).toBe(false);
  });

  it('`pass :m` for an engine message too, asked by its name alone, and `pass any` where none is written', () => {
    const one = eventTurn();
    expect(one.passes(CASE, engineMessage('arrived')!)).toBe(true);
    expect(one.passes(CASE, engineMessage('departed')!)).toBe(false);
    expect(one.passes(CHEST, engineMessage('arrived')!)).toBe(false);
    setOn(one, CHEST, { open: true });
    expect(one.passes(CHEST, engineMessage('arrived')!)).toBe(true);
  });

  it('reads the container’s own state, as the rule is written', () => {
    const one = eventTurn();
    expect(one.passes(CHEST, message('rang'))).toBe(false);
    setOn(one, CHEST, { open: true });
    expect(one.passes(CHEST, message('rang'))).toBe(true);
    expect(one.passes(CHEST, 'any')).toBe(true);
  });

  it('relays where it writes none, and the world refuses where it writes none', () => {
    const one = eventTurn();
    expect(one.passes(HALL, message('rang'))).toBe(true);
    expect(one.passes(LANTERN, 'any')).toBe(true);
    expect(one.passes(WORLD, message('rang'))).toBe(false);
    expect(one.passes(WORLD, 'any')).toBe(false);
  });

  it('a person’s pocket is private, as `sprout.Actor` writes it', () => {
    const one = eventTurn();
    expect(one.passes(one.visitor, 'any')).toBe(false);
  });

  it('charges each rule it reads to the turn’s steps', () => {
    const one = eventTurn({ ...DEFAULT_LIMITS.budgets, steps: 3 });
    const rules = passRules({
      state: one.draft,
      kinds: one.catalogue.lookup,
      caps: one.catalogue.caps,
      budget: one.budget,
      names: one.catalogue.names,
    });
    expect(() => {
      for (let i = 0; i < 3; i++) rules(CHEST, 'any');
    }).toThrow(BudgetExhausted);
  });
});

describe('the world and a move’s notices', () => {
  /** The rules a world that writes `extra` answers with, the world's id beside them. */
  const worldWriting = (extra: string) => {
    const bundle = compiledWorld('gate', {
      'gate.sprout': `world gate is sprout.World {\n  visitors are Person\n  visitors arrive at hall\n  pass any (true)\n${extra}\n  object hall is sprout.Place { }\n}\nkind Person is sprout.Visitor { }\n`,
    });
    const catalogue = catalogueOf(bundle, DEFAULT_LIMITS.caps);
    const state = initialState(catalogue);
    const rules = passRules({
      state: readerOf(state),
      kinds: catalogue.lookup,
      caps: catalogue.caps,
      budget: new Budget(DEFAULT_LIMITS.budgets),
      names: catalogue.names,
    });
    return { rules, world: state.world };
  };

  it('refuses `:arrived` and `:departed` though it passes everything else, where it writes no rule of theirs', () => {
    const { rules, world } = worldWriting('');
    expect(rules(world, 'any')).toBe(true);
    expect(rules(world, ARRIVED)).toBe(false);
    expect(rules(world, DEPARTED)).toBe(false);
  });

  it('lets them through where it writes their own rule, each answering for itself', () => {
    const { rules, world } = worldWriting('  pass :arrived (true)');
    expect(rules(world, ARRIVED)).toBe(true);
    expect(rules(world, DEPARTED)).toBe(false);
  });
});
