import { describe, expect, it } from 'vitest';

import {
  gatehouse,
  gateHost,
  GUARD,
  KEYPAD,
  MARTA,
  PEBBLE,
  SENTRY,
  TOWER,
} from '../fixtures/view.js';
import { SproutList } from '../runtime/lists.js';
import { chipTree, type ChipNode, type ChipTree } from './chips.js';
import { pollView, type SeenReading } from './view.js';

const treeOf = (): ChipTree => {
  const knows = gatehouse().instances.get(GUARD)!.properties.get('knows');
  if (!(knows instanceof SproutList)) throw new Error('the guard knows no list');
  const state = gatehouse(undefined, [], [[GUARD, 'knows', knows.add('weather')]]);
  return chipTree(pollView(state, gateHost(), MARTA).view);
};

const verb = (tree: ChipTree, name: string): ChipNode => {
  const found = tree.find((one) => one.verb === name);
  if (found === undefined) throw new Error(`the tree has no ${name}`);
  return found.next;
};

const under = (node: ChipNode, id: string): ChipNode => {
  const found = node.choices.find(({ filler }) => 'id' in filler && filler.id === id);
  if (found === undefined) throw new Error(`no choice for ${id}`);
  return found.next;
};

describe('the chip tree', () => {
  it('walks ask, then the guard, then the options of the topic', () => {
    const guard = under(verb(treeOf(), 'sprout.ask'), GUARD);
    expect(guard.choices).toEqual([]);
    expect(guard.leaf).toEqual({
      typed: 'ask guard about …',
      refused: null,
      options: [
        {
          role: 'topic',
          takes: 'symbol',
          options: [
            { value: 'bridge', words: 'bridge' },
            { value: 'toll', words: 'toll' },
            { value: 'weather', words: 'weather' },
          ],
        },
      ],
    });
  });

  it('offers a choice for every thing the first role can take, in the order the view offers them', () => {
    const asked = verb(treeOf(), 'sprout.ask').choices.map(({ filler }) => filler);
    const names = asked.flatMap((one) => ('name' in one ? [one.name] : []));
    expect(names.indexOf('a guard')).toBeGreaterThanOrEqual(0);
    expect(names.indexOf('a guard')).toBeLessThan(names.indexOf('a sentry'));
    expect(new Set(asked.map((one) => JSON.stringify(one))).size).toBe(asked.length);
  });

  it('groups by the first role, then the next, and keeps a refused leaf’s reason', () => {
    const vouch = under(under(verb(treeOf(), 'gatehouse.vouch'), GUARD), SENTRY);
    expect(vouch.choices).toEqual([]);
    expect(vouch.leaf?.refused).toEqual(['Not before me.']);
    expect(vouch.leaf?.typed).toBe('vouch to guard before sentry for …');
    // The second role is the witness, under each target.
    const witnesses = under(verb(treeOf(), 'gatehouse.vouch'), GUARD).choices;
    expect(new Set(witnesses.map(({ filler }) => filler.role))).toEqual(new Set(['witness']));
  });

  it('puts a value role’s options in the leaf and leaves its unbound filler out of the path', () => {
    const punch = under(verb(treeOf(), 'gatehouse.punch'), KEYPAD);
    expect(punch.leaf?.options).toEqual([
      { role: 'code', takes: 'integer', ranges: [{ min: 1, max: 12 }] },
    ]);
  });

  it('ends a set role and a tool left out at the leaf, and an exit under the way', () => {
    const tree = treeOf();
    const juggled = verb(tree, 'gatehouse.juggle').choices.find(
      ({ filler }) => filler.binds === 'set' && filler.ids.includes(PEBBLE),
    );
    expect(juggled?.next.leaf?.typed).toBe('juggle pebble');
    expect(under(verb(tree, 'gatehouse.daub'), PEBBLE).leaf?.typed).toBe('daub pebble');
    const up = verb(tree, 'sprout.go').choices.find(
      ({ filler }) => filler.binds === 'exit' && filler.direction === 'up',
    );
    expect(up?.next.leaf?.typed).toBe('go up');
    expect(up?.filler).toMatchObject({ to: TOWER });
  });

  it('holds every reading exactly once, at one leaf', () => {
    const { view } = pollView(gatehouse(), gateHost(), MARTA);
    const leaves = (node: ChipNode): string[] => [
      ...(node.leaf === null ? [] : [node.leaf.typed]),
      ...node.choices.flatMap(({ next }) => leaves(next)),
    ];
    const held = chipTree(view).flatMap(({ next }) => leaves(next));
    const offered: readonly SeenReading[] = view.readings;
    expect([...held].sort()).toEqual(offered.map((one) => one.typed).sort());
  });

  it('is empty for a view with no readings', () => {
    expect(chipTree({ readings: [] })).toEqual([]);
  });
});
