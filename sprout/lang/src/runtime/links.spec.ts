import { describe, expect, it } from 'vitest';

import { LAMP, MEADOW, MOUTH, SHED, ways } from '../fixtures/exits.js';
import { Draft } from './draft.js';
import { faultOf } from './faults.js';
import { encodeInstance } from './load.js';
import { ConnectFault, connectLink } from './links.js';

describe('connecting a link', () => {
  it('writes where `self`’s link leads, replacing where it led before', () => {
    const draft = new Draft(ways());
    connectLink(draft, MOUTH, 'north', MEADOW);
    expect([...draft.instance(MOUTH)!.links]).toEqual([['north', MEADOW]]);
    connectLink(draft, MOUTH, 'north', SHED);
    expect([...draft.instance(MOUTH)!.links]).toEqual([['north', SHED]]);
    const { state, changes } = draft.commit();
    expect(changes.written).toEqual([MOUTH]);
    expect(encodeInstance(state.instances.get(MOUTH)!).links).toEqual({ north: SHED });
  });

  it('faults, writing nothing, where the place is gone or holds no actors', () => {
    const draft = new Draft(ways());
    draft.remove(SHED);
    expect(() => connectLink(draft, MOUTH, 'north', SHED)).toThrow(ConnectFault);
    expect(() => connectLink(draft, MOUTH, 'south', LAMP)).toThrow(
      expect.objectContaining({ reason: 'not-a-place', object: LAMP }),
    );
    expect(draft.instance(MOUTH)!.links.size).toBe(0);
    let thrown: unknown;
    try {
      connectLink(draft, MOUTH, 'north', SHED);
    } catch (error) {
      thrown = error;
    }
    expect(faultOf(thrown)).toMatchObject({ name: 'ConnectFault', object: SHED, engine: false });
  });

  it('is the engine’s defect for a link `self` does not have', () => {
    const draft = new Draft(ways());
    expect(() => connectLink(draft, MOUTH, 'east', MEADOW)).toThrow(/has no link east/);
  });
});
