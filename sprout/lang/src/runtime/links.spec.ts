import { describe, expect, it } from 'vitest';

import { DEAD_END, LAMP, MEADOW, MOUTH, SHED, ways } from '../fixtures/exits.js';
import { Draft } from './draft.js';
import { faultOf } from './faults.js';
import { encodeInstance } from './load.js';
import { ConnectFault, connectLink } from './links.js';

describe('connecting a link', () => {
  it('writes where `self`’s link leads, replacing where it led before', () => {
    const draft = new Draft(ways());
    connectLink(draft, MOUTH, 'onward', MEADOW);
    expect([...draft.instance(MOUTH)!.links]).toEqual([['onward', MEADOW]]);
    connectLink(draft, MOUTH, 'onward', SHED);
    expect([...draft.instance(MOUTH)!.links]).toEqual([['onward', SHED]]);
    const { state, changes } = draft.commit();
    expect(changes.written).toEqual([MOUTH]);
    expect(encodeInstance(state.instances.get(MOUTH)!).links).toEqual({ onward: SHED });
  });

  it('faults, writing nothing, where the place is gone or holds no actors', () => {
    const draft = new Draft(ways());
    draft.remove(SHED);
    expect(() => connectLink(draft, MOUTH, 'onward', SHED)).toThrow(ConnectFault);
    expect(() => connectLink(draft, MOUTH, 'back', LAMP)).toThrow(
      expect.objectContaining({ reason: 'not-a-place', object: LAMP }),
    );
    expect(draft.instance(MOUTH)!.links.size).toBe(0);
    let thrown: unknown;
    try {
      connectLink(draft, MOUTH, 'onward', SHED);
    } catch (error) {
      thrown = error;
    }
    expect(faultOf(thrown)).toMatchObject({ name: 'ConnectFault', object: SHED, engine: false });
  });

  it('faults, writing nothing, on an instance without the link, as one of a kind composing the kind that wrote it is', () => {
    const draft = new Draft(ways());
    let thrown: unknown;
    try {
      connectLink(draft, DEAD_END, 'onward', MEADOW);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ConnectFault);
    expect(thrown).toMatchObject({ reason: 'no-link', object: DEAD_END });
    expect((thrown as Error).message).toBe(
      `\`${DEAD_END}\` has no link onward, so \`connect onward\` has nothing to connect.`,
    );
    expect(faultOf(thrown)).toMatchObject({ name: 'ConnectFault', object: DEAD_END });
    expect(draft.instance(DEAD_END)!.links.size).toBe(0);
  });
});
