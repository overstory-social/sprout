import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { compiledWorld } from '../fixtures/bundle.js';
import { expression } from '../fixtures/check.js';
import type { KindExpr } from '../syntax/ast.js';
import { Budget } from './budget.js';
import { catalogueOf } from './catalogue.js';
import { contentsSeen, contentsSeenOfKind, seenBy } from './contents.js';
import { Draft } from './draft.js';
import { declaredId, type InstanceId } from './ids.js';
import { initialState } from './load.js';
import { passRules } from './passes.js';
import { newInstance } from './state.js';

/** A hall with a shelf of a cup and a jar, a shut chest holding a coin, and a visitor holding a mug. */
const bundle = compiledWorld('pantry', {
  'pantry.sprout': [
    'world pantry is sprout.World {',
    '  visitors are Person visitors arrive at hall',
    '  object hall is sprout.Place {',
    '    object shelf is Shelf { object cup is Cup  object jar is Jar }',
    '    object chest is sprout.Container { :open false  object coin is Cup }',
    '    object mug is Cup',
    '  }',
    '}',
    'kind Person is sprout.Visitor { }',
    'kind Shelf { contains }',
    'kind Cup { }',
    'kind Jar { }',
    '',
  ].join('\n'),
});

const catalogue = catalogueOf(bundle, DEFAULT_LIMITS.caps);
const id = (...path: string[]): InstanceId => declaredId('pantry', path);
const [HALL, SHELF, CHEST, COIN, MUG] = [
  id('hall'),
  id('hall', 'shelf'),
  id('hall', 'chest'),
  id('hall', 'chest', 'coin'),
  id('hall', 'mug'),
];

/** The world as it loads, with a visitor in the hall who has picked up the mug. */
function world(): { draft: Draft; visitor: InstanceId } {
  const draft = new Draft(initialState(catalogue));
  const visitor = draft.mint();
  draft.add(
    newInstance(
      visitor,
      { from: 'visitor' },
      catalogue.visitorKind!,
      HALL,
      draft.nextSerial(),
      catalogue.caps,
    ),
  );
  draft.place(MUG, visitor);
  return { draft, visitor };
}

/** What a body of `self` asks with, over `draft`, under the world's own pass rules. */
function asker(draft: Draft, self: InstanceId) {
  const budget = new Budget(DEFAULT_LIMITS.budgets);
  const context = {
    state: draft,
    kinds: catalogue.lookup,
    caps: catalogue.caps,
    budget,
    names: catalogue.names,
  };
  return { ...context, self, library: 'pantry', passes: passRules(context) };
}

function kind(text: string): KindExpr {
  const written = expression(text);
  if (written.kind !== 'kind-expr') throw new Error(`${text} is not a kind`);
  return written;
}

describe('what a body sees a container hold', () => {
  it('sees a shut chest from outside as holding nothing, and the chest sees all it holds', () => {
    const { draft } = world();
    expect(contentsSeen(asker(draft, SHELF), CHEST)).toEqual([]);
    expect(seenBy(asker(draft, SHELF), COIN)).toBe(false);
    expect(contentsSeen(asker(draft, CHEST), CHEST)).toEqual([COIN]);
    expect(seenBy(asker(draft, CHEST), COIN)).toBe(true);
  });

  it('sees an open container as it is, in its order', () => {
    const { draft } = world();
    expect(contentsSeen(asker(draft, CHEST), SHELF)).toEqual([
      id('hall', 'shelf', 'cup'),
      id('hall', 'shelf', 'jar'),
    ]);
  });

  it('sees nothing in another actor’s hands, and an actor sees its own', () => {
    const { draft, visitor } = world();
    expect(contentsSeen(asker(draft, HALL), visitor)).toEqual([]);
    expect(contentsSeen(asker(draft, SHELF), visitor)).toEqual([]);
    expect(contentsSeen(asker(draft, visitor), visitor)).toEqual([MUG]);
  });

  it('sees into the hands it is given as open, and no one else’s', () => {
    const { draft, visitor } = world();
    expect(contentsSeen({ ...asker(draft, HALL), hands: visitor }, visitor)).toEqual([MUG]);
    expect(seenBy({ ...asker(draft, SHELF), hands: visitor }, MUG)).toBe(true);
    expect(contentsSeen({ ...asker(draft, HALL), hands: HALL }, visitor)).toEqual([]);
  });

  it('keeps only what composes the kind a filter names, from what is seen', () => {
    const { draft } = world();
    const at = asker(draft, CHEST);
    expect(contentsSeenOfKind(at, SHELF, kind('Cup'))).toEqual([id('hall', 'shelf', 'cup')]);
    expect(contentsSeenOfKind(at, CHEST, kind('Cup'))).toEqual([COIN]);
    expect(contentsSeenOfKind(asker(draft, SHELF), CHEST, kind('Cup'))).toEqual([]);
    expect(contentsSeenOfKind(at, SHELF, null)).toHaveLength(2);
  });

  it('charges the range question it asks of each thing', () => {
    const { draft } = world();
    const at = asker(draft, SHELF);
    contentsSeen(at, SHELF);
    // For each of the two: the shelf and its two ancestors climbed, and the thing's own step.
    expect(at.budget.spentSteps).toBe(8);
  });
});
