import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { shop } from '../fixtures/bundle.js';
import { catalogueOf } from './catalogue.js';
import { Draft } from './draft.js';
import { declaredId, mintedId, type InstanceId } from './ids.js';
import { initialState } from './load.js';
import { DestroyedReference, namedObject } from './named.js';
import { readerOf } from './state.js';

const catalogue = catalogueOf(shop(), DEFAULT_LIMITS.caps);
const id = (...path: string[]): InstanceId => declaredId('printers_shop', path);
const JAR = id('hall', 'shelf', 'jar');

/** What `read` threw, or null where it threw nothing. */
function thrown(read: () => unknown): unknown {
  try {
    read();
    return null;
  } catch (fault) {
    return fault;
  }
}

describe('a name read at run time', () => {
  it('reaches the declared object it names', () => {
    const state = initialState(catalogue);
    expect(namedObject(readerOf(state), JAR)).toBe(state.instances.get(JAR));
  });

  it('faults on a declared object destroyed, from the moment the destroy takes effect', () => {
    const draft = new Draft(initialState(catalogue));
    draft.remove(id('hall', 'shelf'));
    const fault = thrown(() => namedObject(draft, JAR));
    expect(fault).toBeInstanceOf(DestroyedReference);
    expect((fault as DestroyedReference).object).toBe(JAR);
    expect((fault as DestroyedReference).message).toBe(
      '`printers_shop.hall.shelf.jar` was destroyed, and a declared object destroyed is gone for good.',
    );
    // A binding to it is not a name, and reads it as it was.
    expect(draft.destroyed(JAR)).toBeDefined();
  });

  it('faults on one destroyed in an earlier turn, and not on its neighbour', () => {
    const draft = new Draft(initialState(catalogue));
    draft.remove(JAR);
    const reader = readerOf(draft.commit().state);
    expect(thrown(() => namedObject(reader, JAR))).toBeInstanceOf(DestroyedReference);
    expect(namedObject(reader, id('hall', 'shelf', 'cup'))).not.toBeNull();
  });

  it('gives null for a declared id nothing is decoded under, which is absent and not destroyed', () => {
    const reader = readerOf(initialState(catalogue));
    expect(namedObject(reader, id('hall', 'nowhere'))).toBeNull();
  });

  it('never reaches a minted id, since a name reaches only what is declared', () => {
    const reader = readerOf(initialState(catalogue));
    expect(() => namedObject(reader, mintedId('printers_shop', 1))).toThrow(/minted/);
  });
});
