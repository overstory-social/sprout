import { describe, expect, it } from 'vitest';

import { BUS, CASE, CHEST, eventTurn, HALL, LANTERN, setOn, WORLD } from '../fixtures/events.js';
import type { DeclaredMessage } from '../declare/messages.js';
import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { BudgetExhausted } from './budget.js';
import { passRules } from './passes.js';

const message = (name: string): DeclaredMessage => BUS.messages.qualified('bus', name)!;

describe('a container answers with the rule its kind writes', () => {
  it('`pass :m` for its own message, and `pass any` for the rest', () => {
    const one = eventTurn();
    expect(one.passes(CASE, message('lit'))).toBe(true);
    expect(one.passes(CASE, message('rang'))).toBe(false);
    expect(one.passes(CASE, 'any')).toBe(false);
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
