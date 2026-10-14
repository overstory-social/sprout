import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { shop } from '../fixtures/bundle.js';
import { catalogueOf } from './catalogue.js';
import { closedByBundle, oldestFirst } from './turns.js';

describe('a world whose bundle admits no one', () => {
  const catalogue = catalogueOf(shop(), DEFAULT_LIMITS.caps);

  it('is one with no world, no visitor kind or no arrival place in source', () => {
    expect(closedByBundle(catalogue)).toBeNull();
    expect(closedByBundle({ ...catalogue, worldKind: null })).toBe('no-world');
    expect(closedByBundle({ ...catalogue, visitorKind: null })).toBe('no-visitor-kind');
    expect(closedByBundle({ ...catalogue, arrival: null })).toBe('no-arrival-place');
  });
});

describe('the order wakes are delivered in', () => {
  it('is the one due first, then the one asked first', () => {
    const wakes = [
      { serial: 3, askedAt: 0, dueAt: 90 },
      { serial: 9, askedAt: 5, dueAt: 60 },
      { serial: 4, askedAt: 1, dueAt: 60 },
    ];
    expect([...wakes].sort(oldestFirst).map((one) => one.serial)).toEqual([4, 9, 3]);
  });
});
