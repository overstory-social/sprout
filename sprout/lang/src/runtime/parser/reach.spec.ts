import { describe, expect, it } from 'vitest';

import { CHEST, COIN, commandContext, HALL, LAMP, study } from '../../fixtures/parser.js';
import { reachOf } from './reach.js';

describe('what a visitor may name', () => {
  const one = study();
  const actor = one.people[0]!;
  const reach = () => reachOf(actor, commandContext(one));

  it('is every live thing the range walk reaches but the world, the visitor first', () => {
    const ids = reach().map((candidate) => candidate.instance.id);
    expect(ids[0]).toBe(actor);
    expect(ids).toContain(LAMP);
    expect(ids).toContain(HALL);
    expect(ids).not.toContain(one.draft.world);
    // The chest is shut, so the coin in it is out of reach.
    expect(ids).not.toContain(COIN);
  });

  it('ranks the visitor’s own place below everything it holds', () => {
    const near = new Map(reach().map((candidate) => [candidate.instance.id, candidate.near]));
    expect(near.get(actor)).toBe(0);
    expect(near.get(LAMP)!).toBeLessThan(near.get(HALL)!);
    expect(near.get(CHEST)!).toBeLessThan(near.get(HALL)!);
  });

  it('says what the visitor carries', () => {
    expect(reach().every((candidate) => !candidate.carried)).toBe(true);
    one.draft.place(LAMP, actor);
    expect(reach().find((candidate) => candidate.instance.id === LAMP)?.carried).toBe(true);
  });
});
