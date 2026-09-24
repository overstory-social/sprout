import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { compiledWorld } from '../fixtures/bundle.js';
import type { EachStatement } from '../syntax/ast.js';
import { parseStatement } from '../syntax/parse.js';
import { Diagnostics } from '../source/diagnostics.js';
import { SourceFile } from '../source/source.js';
import { Budget } from './budget.js';
import { catalogueOf } from './catalogue.js';
import { eachWalked } from './each.js';
import { boundObject, type Evaluated, type Frame } from './evaluate.js';
import { declaredId, type InstanceId } from './ids.js';
import { initialState } from './load.js';
import { passRules } from './passes.js';
import { readerOf } from './state.js';

/** A hall with a shelf of two cups and a jar, and a shut chest holding a coin. */
const bundle = compiledWorld('pantry', {
  'pantry.sprout': [
    'world pantry is sprout.World {',
    '  visitors are Person visitors arrive at hall',
    '  object hall is sprout.Place {',
    '    object shelf is Shelf { object cup is Cup  object jar is Jar  object mug is Cup }',
    '    object chest is sprout.Container { :open false  object coin is Cup }',
    '    object ladle is Cup',
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
const [HALL, SHELF, CHEST, LADLE] = [
  id('hall'),
  id('hall', 'shelf'),
  id('hall', 'chest'),
  id('hall', 'ladle'),
];

function each(text: string): EachStatement {
  const diagnostics = new Diagnostics();
  const statement = parseStatement(new SourceFile('each.sprout', text), diagnostics);
  expect(diagnostics.refusals).toEqual([]);
  if (statement?.kind !== 'each') throw new Error(`${text} is not an each`);
  return statement;
}

/** A frame whose body is `self`'s, with `bindings` bound, over the world as it loads. */
function frame(self: InstanceId, bindings: [string, Evaluated][] = []): Frame {
  const state = readerOf(initialState(catalogue));
  const budget = new Budget(DEFAULT_LIMITS.budgets);
  const context = {
    state,
    kinds: catalogue.lookup,
    caps: catalogue.caps,
    budget,
    names: catalogue.names,
  };
  return {
    ...context,
    library: 'pantry',
    self,
    bindings: new Map(bindings),
    passes: passRules(context),
  };
}

const walked = (text: string, at: Frame): string[] =>
  eachWalked(each(text), at).map((one) => (one.binds === 'object' ? one.id : 'not an object'));

describe('what `each … in` walks', () => {
  it('visits what the container directly holds, in its order, and nothing inside those', () => {
    expect(walked('each thing in self { }', frame(SHELF))).toEqual([
      id('hall', 'shelf', 'cup'),
      id('hall', 'shelf', 'jar'),
      id('hall', 'shelf', 'mug'),
    ]);
    expect(walked('each thing in self { }', frame(HALL))).toEqual([SHELF, CHEST, LADLE]);
  });

  it('keeps only the contents composing the kind a filter names', () => {
    expect(walked('each c: Cup in self { }', frame(SHELF))).toEqual([
      id('hall', 'shelf', 'cup'),
      id('hall', 'shelf', 'mug'),
    ]);
    expect(walked('each j: Jar in self { }', frame(HALL))).toEqual([]);
  });

  it('walks a shut container seen from outside as holding nothing, and from inside as it is', () => {
    const outside = frame(LADLE, [['box', boundObject(CHEST)]]);
    expect(walked('each thing in box { }', outside)).toEqual([]);
    expect(walked('each thing in self { }', frame(CHEST))).toEqual([id('hall', 'chest', 'coin')]);
  });

  it('charges the range question it asks of each thing it walks past', () => {
    const at = frame(SHELF);
    walked('each thing in self { }', at);
    // `self`: 1. For each of the three: the shelf and its two ancestors
    // climbed, and the thing's own step: 4.
    expect(at.budget.spentSteps).toBe(13);
  });
});

describe('what `each … of` walks', () => {
  it('visits a set role’s members in the order the reading bound them', () => {
    const tools: Evaluated = { binds: 'set', ids: [LADLE, SHELF] };
    expect(walked('each tool of tools { }', frame(HALL, [['tools', tools]]))).toEqual([
      LADLE,
      SHELF,
    ]);
  });
});
