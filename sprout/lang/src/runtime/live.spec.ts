import { describe, expect, it } from 'vitest';

import type { Bundle } from '../bundle/bundle.js';
import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { shop, shopWithheld } from '../fixtures/bundle.js';
import { liveTreeOf, passRuleOf } from '../fixtures/live-tree.js';
import { Budget } from './budget.js';
import { catalogueOf } from './catalogue.js';
import { Draft } from './draft.js';
import { declaredId, mintedId, type InstanceId } from './ids.js';
import { isLive, liveTree } from './live.js';
import { initialState, loadWorld, saveWorld } from './load.js';
import { rangeOf } from './range.js';
import { newInstance, readerOf, type Instance, type StateReader } from './state.js';

const CAPS = DEFAULT_LIMITS.caps;
const id = (...path: string[]): InstanceId => declaredId('printers_shop', path);
const minted = (serial: number): InstanceId => mintedId('printers_shop', serial);

/** Every node the declared tree names, the world first. */
const nodesOf = (bundle: Bundle): InstanceId[] => [
  declaredId(bundle.manifest.name, []),
  ...[...bundle.tree.placed.values()].map((placement) =>
    declaredId(bundle.manifest.name, placement.path),
  ),
];

describe('a new world’s state tree is the tree as declared', () => {
  for (const [name, bundle] of [
    ['as published', shop()],
    ['with a kind absent', shopWithheld()],
  ] as const) {
    it(`agrees with the declared tree on every node’s contents and container, ${name}`, () => {
      const state = liveTree(readerOf(initialState(catalogueOf(bundle, CAPS))));
      const declared = liveTreeOf(bundle.tree);
      for (const node of nodesOf(bundle)) {
        expect(state.contents(node), node).toEqual(declared.contents(node));
        expect(state.containerOf(node), node).toBe(declared.containerOf(node));
      }
    });
  }

  it('leaves out an object of an absent kind and everything under it', () => {
    const reader = readerOf(initialState(catalogueOf(shopWithheld(), CAPS)));
    expect(liveTree(reader).contents(id('hall'))).toEqual([id('hall', 'shelf')]);
    expect(isLive(reader, id('hall', 'box'))).toBe(false);
    expect(reader.instance(id('hall', 'box', 'tin'))).toBeDefined();
    expect(isLive(reader, id('hall', 'box', 'tin'))).toBe(false);
    expect(liveTree(reader).containerOf(id('hall', 'box', 'tin'))).toBeNull();
  });
});

describe('what is live', () => {
  const catalogue = catalogueOf(shop(), CAPS);
  const PERSON = catalogue.kinds.get('printers_shop.Person')!;

  it('is always the world, which is the root whether or not it is decoded', () => {
    const decoded = readerOf(initialState(catalogue));
    expect(decoded.instance(decoded.world)).toBeDefined();
    expect(isLive(decoded, decoded.world)).toBe(true);
    const dormant = readerOf(initialState({ ...catalogue, worldKind: null }));
    expect(dormant.instance(dormant.world)).toBeUndefined();
    expect(isLive(dormant, dormant.world)).toBe(true);
  });

  it('is nothing that is not there', () => {
    expect(isLive(readerOf(initialState(catalogue)), minted(7))).toBe(false);
  });

  it('is not a visitor who is away, who is out of the tree', () => {
    const draft = new Draft(initialState(catalogue));
    const marta = newInstance(
      draft.mint(),
      { from: 'visitor' },
      PERSON,
      id('hall'),
      draft.nextSerial(),
      CAPS,
    );
    draft.add(marta);
    expect(isLive(draft, marta.id)).toBe(true);
    expect(liveTree(draft).containerOf(marta.id)).toBe(id('hall'));
    draft.place(marta.id, null);
    expect(isLive(draft, marta.id)).toBe(false);
    expect(liveTree(draft).containerOf(marta.id)).toBeNull();
    expect(liveTree(draft).contents(id('hall'))).not.toContain(marta.id);
  });

  it('ends a climb that closes a ring, rather than walking it for ever', () => {
    const a = minted(1);
    const b = minted(2);
    const jar = catalogue.kinds.get('printers_shop.Jar')!;
    const ring = new Map<InstanceId, Instance>([
      [a, newInstance(a, { from: 'spawned', kind: 'printers_shop.Jar' }, jar, b, 1, CAPS)],
      [b, newInstance(b, { from: 'spawned', kind: 'printers_shop.Jar' }, jar, a, 2, CAPS)],
    ]);
    const reader: StateReader = {
      world: catalogue.world,
      instance: (one) => ring.get(one),
      children: (one) => (one === a ? [b] : one === b ? [a] : []),
      visitor: () => undefined,
      tombstoned: () => false,
    };
    expect(isLive(reader, a)).toBe(false);
    expect(liveTree(reader).contents(a)).toEqual([]);
  });
});

describe('the state tree as range walks it', () => {
  const catalogue = catalogueOf(shop(), CAPS);

  it('orders what arrived after what was declared, whatever the order stored', () => {
    const draft = new Draft(initialState(catalogue));
    draft.place(id('hall', 'shelf', 'jar'), id('hall', 'shelf'));
    const spawned = draft.mint();
    draft.add(
      newInstance(
        spawned,
        { from: 'spawned', kind: 'printers_shop.Jar' },
        catalogue.kinds.get('printers_shop.Jar')!,
        id('hall', 'shelf'),
        draft.nextSerial(),
        CAPS,
      ),
    );
    const { state } = draft.commit();
    const expected = [id('hall', 'shelf', 'cup'), id('hall', 'shelf', 'jar'), spawned];
    expect(liveTree(readerOf(state)).contents(id('hall', 'shelf'))).toEqual(expected);
    const saved = saveWorld(state);
    const reloaded = loadWorld({ ...saved, instances: [...saved.instances].reverse() }, catalogue);
    expect(liveTree(readerOf(reloaded.state)).contents(id('hall', 'shelf'))).toEqual(expected);
  });

  it('is what one range walk reads, the same as over the declared tree', () => {
    const bundle = shop();
    const budget = () => new Budget(DEFAULT_LIMITS.budgets);
    const passes = passRuleOf(bundle.tree);
    const walk = (tree: ReturnType<typeof liveTreeOf>) =>
      rangeOf({ tree, passes, budget: budget() }, id('hall', 'shelf', 'jar'), 'any').reached;
    const overState = walk(liveTree(readerOf(initialState(catalogueOf(bundle, CAPS)))));
    expect(overState).toEqual(walk(liveTreeOf(bundle.tree)));
    expect(overState.map((one) => one.node)).toContain(id('hall', 'box', 'tin'));
  });
});
