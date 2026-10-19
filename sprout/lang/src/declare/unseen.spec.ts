import { describe, expect, it } from 'vitest';

import { isUnseenOrigin, UNSEEN, UNSEEN_NAME } from './unseen.js';

describe('the standard library’s `:unseen`', () => {
  it('is a boolean, false by default, held by every object and remembered about nobody', () => {
    expect(UNSEEN.name).toBe(UNSEEN_NAME);
    expect(UNSEEN.type).toEqual({ type: 'boolean' });
    expect(UNSEEN.remembered).toBe(false);
    expect(UNSEEN.declaration.default).toMatchObject({ kind: 'boolean', value: false });
  });

  it('is known by its origin, and a restatement of it is not', () => {
    expect(isUnseenOrigin(UNSEEN)).toBe(true);
    expect(isUnseenOrigin({ ...UNSEEN, origin: 'shop.Thief' })).toBe(false);
  });
});
