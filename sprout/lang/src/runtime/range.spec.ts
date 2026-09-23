import { describe, expect, it } from 'vitest';

import type { MessageDeclaration } from '../syntax/ast.js';
import { Budget, BudgetExhausted, type TurnKind } from './budget.js';
import { DEFAULT_LIMITS, limitsFrom } from '../bundle/limits.js';
import { Diagnostics } from '../source/diagnostics.js';
import { EnumTable } from '../declare/enums.js';
import { MessageTable, type DeclaredMessage } from '../declare/messages.js';
import { parseDeclarations } from '../syntax/parse.js';
import { SourceFile } from '../source/source.js';
import { declaredTree, liveTreeOf, passRuleOf } from '../fixtures/live-tree.js';
import {
  rangeOf,
  reaches,
  type Asking,
  type LiveTree,
  type PassRule,
  type RangeContext,
  type RangeWalk,
} from './range.js';

/** A tree from what each container holds, in order; anything no one holds has no container. */
function treeOf(holding: Record<string, readonly string[]>): LiveTree<string> {
  const containers = new Map<string, string>();
  for (const [holder, held] of Object.entries(holding)) {
    for (const item of held) containers.set(item, holder);
  }
  return {
    contents: (node) => holding[node] ?? [],
    containerOf: (node) => containers.get(node) ?? null,
  };
}

/**
 * The spec's house, as a tree: two places in a world that refuses, a
 * wardrobe with Ann in it, Marta with a key in her pocket, a shut chest,
 * and a box on a table.
 */
const HOUSE = treeOf({
  house: ['bedroom', 'yard'],
  bedroom: ['wardrobe', 'chest', 'marta', 'table'],
  yard: ['well'],
  wardrobe: ['ann', 'coat'],
  chest: ['brass_key'],
  marta: ['pocket_key'],
  table: ['box'],
  box: ['ring'],
  ann: ['key', 'bag', 'pouch'],
  bag: ['coin'],
  pouch: ['gem'],
});

/** What refuses unless a case says otherwise: the world, the actors, and whatever is shut. */
const SHUT = ['house', 'wardrobe', 'chest', 'marta', 'ann', 'pouch'];

/** A pass rule over names: what is in `shut` refuses, anything else relays. */
const refusing =
  (shut: Iterable<string>): PassRule<string> =>
  (container) =>
    !new Set(shut).has(container);

/** The house's rule with some things opened (`open`) and some shut (`shut`). */
function houseRule(change: { open?: readonly string[]; shut?: readonly string[] } = {}) {
  const shut = new Set(SHUT);
  for (const name of change.open ?? []) shut.delete(name);
  for (const name of change.shut ?? []) shut.add(name);
  return refusing(shut);
}

const budgetOf = (overrides: Partial<typeof DEFAULT_LIMITS.budgets> = {}, kind?: TurnKind) =>
  new Budget(limitsFrom({ budgets: overrides }).budgets, kind);

function contextOf<Id>(
  tree: LiveTree<Id>,
  passes: PassRule<Id>,
  budget = budgetOf(),
): RangeContext<Id> {
  return { tree, passes, budget };
}

/** A walk as words: each node, with how it came into range unless it passed. */
const shown = <Id>(walk: RangeWalk<Id>): string[] =>
  walk.reached.map(({ node, via }) => (via === 'passed' ? String(node) : `${node} (${via})`));

/** Walk the house from `asker`, asking `any` unless told otherwise. */
function walkHouse(
  asker: string,
  change: { open?: readonly string[]; shut?: readonly string[] } = {},
  asking: Asking = 'any',
) {
  return rangeOf(contextOf(HOUSE, houseRule(change)), asker, asking);
}

function messages(): { illuminating: DeclaredMessage; stir: DeclaredMessage } {
  const diagnostics = new Diagnostics();
  const declared = parseDeclarations(
    new SourceFile('events.sprout', 'message :illuminating with boolean\nmessage :stir'),
    diagnostics,
  ).filter((d): d is MessageDeclaration => d.kind === 'message');
  const table = new MessageTable();
  table.add('shop', declared, new EnumTable(), diagnostics);
  expect(diagnostics.refusals).toEqual([]);
  return {
    illuminating: table.qualified('shop', 'illuminating')!,
    stir: table.qualified('shop', 'stir')!,
  };
}

describe('an object reaches itself, its own contents, and the surface of its container', () => {
  it('leaves Ann in a shut wardrobe her hands, what her open bag holds, and the wardrobe', () => {
    const walk = walkHouse('ann');
    expect(shown(walk)).toEqual([
      'ann (self)',
      'key (held)',
      'bag (held)',
      'pouch (held)',
      'coin',
      'wardrobe (surface)',
    ]);
    expect(walk.walls).toEqual(['pouch', 'wardrobe']);
    for (const out of ['gem', 'coat', 'bedroom', 'marta', 'house']) {
      expect(walk.within.has(out), out).toBe(false);
    }
  });

  it('lets a key in a shut chest see the chest and nothing past it', () => {
    const walk = walkHouse('brass_key');
    expect(shown(walk)).toEqual(['brass_key (self)', 'chest (surface)']);
    expect(walk.walls).toEqual(['chest']);
  });

  it('lets a visitor shut in a chest name what they hold and the chest, to open it', () => {
    const tree = treeOf({ bedroom: ['chest'], chest: ['visitor'], visitor: ['key'] });
    const walk = rangeOf(contextOf(tree, refusing(['chest', 'visitor'])), 'visitor', 'any');
    expect(shown(walk)).toEqual(['visitor (self)', 'key (held)', 'chest (surface)']);
  });

  it('never asks the asker’s own rule: a shut chest still counts what it holds', () => {
    const asked: string[] = [];
    const passes: PassRule<string> = (container) => {
      asked.push(container);
      return container !== 'chest' && container !== 'house';
    };
    const walk = rangeOf(contextOf(HOUSE, passes), 'chest', 'any');
    expect(shown(walk).slice(0, 2)).toEqual(['chest (self)', 'brass_key (held)']);
    expect(asked).not.toContain('chest');
  });

  it('leaves a visitor standing in a world that holds actors only the world’s surface', () => {
    const tree = treeOf({ shop: ['visitor', 'bench'], visitor: ['key'] });
    const walk = rangeOf(contextOf(tree, refusing(['shop'])), 'visitor', 'any');
    expect(shown(walk)).toEqual(['visitor (self)', 'key (held)', 'shop (surface)']);
    expect(walk.walls).toEqual(['shop']);
  });

  it('leaves a visitor who is away themselves and what they hold, crossing inward, and nothing else', () => {
    const tree = treeOf({
      house: ['bedroom'],
      drifter: ['lantern', 'purse'],
      lantern: ['wick'],
      purse: ['coin'],
    });
    const walk = rangeOf(contextOf(tree, refusing(['purse', 'house'])), 'drifter', 'any');
    expect(shown(walk)).toEqual(['drifter (self)', 'lantern (held)', 'purse (held)', 'wick']);
    expect(walk.walls).toEqual(['purse']);
  });
});

describe('outward, a container is passed through only if it passes', () => {
  it('opens the wardrobe onto the bedroom, and stops at the world’s surface', () => {
    const walk = walkHouse('ann', { open: ['wardrobe'] });
    expect(shown(walk)).toEqual([
      'ann (self)',
      'key (held)',
      'bag (held)',
      'pouch (held)',
      'coin',
      'wardrobe',
      'coat',
      'bedroom',
      'chest',
      'marta',
      'table',
      'box',
      'ring',
      'house (surface)',
    ]);
    expect(walk.walls).toEqual(['pouch', 'chest', 'marta', 'house']);
    for (const out of ['gem', 'brass_key', 'pocket_key', 'yard', 'well']) {
      expect(walk.within.has(out), out).toBe(false);
    }
  });

  it('crosses breadth-first: an opened chest’s key comes with the box, a level before the ring', () => {
    const walk = walkHouse('ann', { open: ['wardrobe', 'chest'] });
    expect(shown(walk).slice(7)).toEqual([
      'bedroom',
      'chest',
      'marta',
      'table',
      'brass_key',
      'box',
      'ring',
      'house (surface)',
    ]);
  });

  it('names Marta and not the key in her pocket', () => {
    const walk = walkHouse('ann', { open: ['wardrobe'] });
    expect(walk.within.has('marta')).toBe(true);
    expect(walk.within.has('pocket_key')).toBe(false);
  });

  it('crosses into a box on a table, and stops at its lid when it is shut', () => {
    expect(shown(walkHouse('table')).slice(0, 3)).toEqual(['table (self)', 'box (held)', 'ring']);
    const shut = walkHouse('table', { shut: ['box'] });
    expect(shut.within.has('box')).toBe(true);
    expect(shut.within.has('ring')).toBe(false);
    expect(shut.walls[0]).toBe('box');
  });

  it('lets a thing in a room reach the world as a surface, and keeps places apart until it passes', () => {
    const closed = walkHouse('table');
    expect(closed.reached.at(-1)).toEqual({ node: 'house', via: 'surface' });
    for (const out of ['yard', 'well']) expect(closed.within.has(out), out).toBe(false);
    expect(closed.walls.at(-1)).toBe('house');

    const open = walkHouse('table', { open: ['house'] });
    expect(shown(open).slice(-3)).toEqual(['house', 'yard', 'well']);
    expect(open.walls).not.toContain('house');
  });

  it('lets a place reach the world as its surface and no further', () => {
    const walk = walkHouse('bedroom', { open: ['wardrobe'] });
    expect(walk.reached.at(-1)).toEqual({ node: 'house', via: 'surface' });
    expect(walk.within.has('yard')).toBe(false);
    expect(walk.within.has('well')).toBe(false);
  });

  it('walks the whole world from the world, into whatever passes', () => {
    const walk = walkHouse('house', { open: ['wardrobe'] });
    expect(shown(walk)).toEqual([
      'house (self)',
      'bedroom (held)',
      'yard (held)',
      'wardrobe',
      'chest',
      'marta',
      'table',
      'well',
      'ann',
      'coat',
      'box',
      'ring',
    ]);
    expect(walk.walls).toEqual(['chest', 'marta', 'ann']);
    for (const out of ['brass_key', 'pocket_key', 'key', 'bag', 'pouch', 'coin', 'gem']) {
      expect(walk.within.has(out), out).toBe(false);
    }
  });
});

describe('what is asked decides what passes', () => {
  // kind GlassCase { contains  pass :illuminating (true)  pass any (false) }
  const tree = treeOf({ hall: ['room'], room: ['glass_case', 'lamp'], glass_case: ['moth'] });
  const passes: PassRule<string> = (container, asking) => {
    if (container === 'glass_case') return asking !== 'any' && asking.name === 'illuminating';
    return container !== 'hall';
  };
  const { illuminating, stir } = messages();

  it('lets light through a glass case to the moth', () => {
    const walk = rangeOf(contextOf(tree, passes), 'lamp', illuminating);
    expect(walk.within.has('moth')).toBe(true);
    expect(walk.walls).toEqual(['hall']);
  });

  it('keeps the moth out of reach of `get`, `each` and nouns, which ask `any`', () => {
    const walk = rangeOf(contextOf(tree, passes), 'lamp', 'any');
    expect(walk.within.has('glass_case')).toBe(true);
    expect(walk.within.has('moth')).toBe(false);
    expect(walk.walls).toEqual(['glass_case', 'hall']);
  });

  it('falls back to `pass any` for a message the case has no rule for', () => {
    const walk = rangeOf(contextOf(tree, passes), 'lamp', stir);
    expect(walk.within.has('moth')).toBe(false);
  });
});

describe('each rule is asked only where it decides something', () => {
  function spied(change: { open?: readonly string[] } = {}) {
    const rule = houseRule(change);
    const asked: string[] = [];
    const passes: PassRule<string> = (container, asking) => {
      asked.push(container);
      return rule(container, asking);
    };
    return { passes, asked };
  }

  it('never asks an empty container', () => {
    const { passes, asked } = spied({ open: ['wardrobe'] });
    rangeOf(contextOf(HOUSE, passes), 'ann', 'any');
    for (const empty of ['key', 'coin', 'coat', 'ring', 'gem'])
      expect(asked, empty).not.toContain(empty);
  });

  it('asks each container at most once, and never the asker', () => {
    for (const asker of ['ann', 'house', 'table', 'bedroom', 'coin']) {
      const { passes, asked } = spied({ open: ['wardrobe', 'house'] });
      rangeOf(contextOf(HOUSE, passes), asker, 'any');
      expect(new Set(asked).size, asker).toBe(asked.length);
      expect(asked, asker).not.toContain(asker);
    }
  });

  it('asks in the order it walks, and the walls are the ones that said no', () => {
    const { passes, asked } = spied({ open: ['wardrobe'] });
    const walk = rangeOf(contextOf(HOUSE, passes), 'ann', 'any');
    expect(asked).toEqual([
      'bag',
      'pouch',
      'wardrobe',
      'bedroom',
      'chest',
      'marta',
      'table',
      'box',
      'house',
    ]);
    expect(walk.walls).toEqual(
      asked.filter((container) => !houseRule({ open: ['wardrobe'] })(container, 'any')),
    );
  });
});

describe('a walk is charged one step for every object it reaches', () => {
  const walkWith = (budget: Budget) =>
    rangeOf(contextOf(HOUSE, houseRule({ open: ['wardrobe'] }), budget), 'ann', 'any');

  it('costs exactly what it reaches', () => {
    const budget = budgetOf({ steps: 14 });
    const walk = walkWith(budget);
    expect(walk.reached).toHaveLength(14);
    expect(budget.spentSteps).toBe(14);
  });

  it('faults a command turn that cannot afford the walk, with nothing half-walked to show', () => {
    let walk: RangeWalk<string> | undefined;
    try {
      walk = walkWith(budgetOf({ steps: 13 }));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(BudgetExhausted);
      expect((error as BudgetExhausted).limit).toBe('steps');
      expect((error as BudgetExhausted).allowed).toBe(13);
    }
    expect(walk).toBeUndefined();
  });

  it('charges a poll to the poll’s budget', () => {
    try {
      walkWith(budgetOf({ pollSteps: 13 }, 'poll'));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as BudgetExhausted).limit).toBe('pollSteps');
    }
  });

  it('charges a pass rule’s own work to the same meter', () => {
    const budget = budgetOf();
    const rule = houseRule({ open: ['wardrobe'] });
    let asked = 0;
    const passes: PassRule<string> = (container, asking) => {
      asked += 1;
      budget.spend();
      return rule(container, asking);
    };
    rangeOf({ tree: HOUSE, passes, budget }, 'ann', 'any');
    expect(asked).toBe(9);
    expect(budget.spentSteps).toBe(14 + 9);
  });

  it('charges a membership test one step per node on the path, not a whole walk', () => {
    const budget = budgetOf();
    reaches(contextOf(HOUSE, houseRule({ open: ['wardrobe'] }), budget), 'coin', 'ring', 'any');
    // coin, bag, ann, wardrobe, bedroom, house climbed; then ring, box, table.
    expect(budget.spentSteps).toBe(9);
  });
});

describe('nesting has no cap, so a walk is a loop and not a recursion', () => {
  const depth = 100_000;
  const chain: LiveTree<number> = {
    contents: (node) => (node < depth ? [node + 1] : []),
    containerOf: (node) => (node > 0 ? node - 1 : null),
  };
  const context = () => contextOf(chain, () => true, budgetOf({ steps: 1_000_000 }));

  it('walks a hundred thousand containers down from the world', () => {
    const walk = rangeOf(context(), 0, 'any');
    expect(walk.reached).toHaveLength(depth + 1);
    expect(walk.reached.at(-1)).toEqual({ node: depth, via: 'passed' });
  });

  it('walks them out from the bottom', () => {
    const walk = rangeOf(context(), depth, 'any');
    expect(walk.reached).toHaveLength(depth + 1);
    expect(walk.reached[1]).toEqual({ node: depth - 1, via: 'passed' });
    expect(walk.reached.at(-1)).toEqual({ node: 0, via: 'passed' });
  });

  it('answers membership both ways along it', () => {
    expect(reaches(context(), 0, depth, 'any')).toBe(true);
    expect(reaches(context(), depth, 0, 'any')).toBe(true);
  });
});

describe('`reaches` answers from the path alone, as the walk would', () => {
  const inHouse = (
    asker: string,
    target: string,
    change: { open?: readonly string[]; shut?: readonly string[] } = {},
  ) => reaches(contextOf(HOUSE, houseRule(change)), asker, target, 'any');

  it('reaches itself and its own contents without asking its own rule', () => {
    expect(inHouse('ann', 'ann')).toBe(true);
    expect(inHouse('ann', 'pouch')).toBe(true);
    expect(inHouse('ann', 'coin')).toBe(true);
    expect(inHouse('ann', 'gem')).toBe(false);
  });

  it('reaches its own container’s surface, and nothing past a shut one', () => {
    expect(inHouse('ann', 'wardrobe')).toBe(true);
    expect(inHouse('ann', 'coat')).toBe(false);
    expect(inHouse('ann', 'bedroom')).toBe(false);
    expect(inHouse('key', 'ann')).toBe(true);
    expect(inHouse('key', 'wardrobe')).toBe(false);
    expect(inHouse('brass_key', 'chest')).toBe(true);
    expect(inHouse('brass_key', 'bedroom')).toBe(false);
    expect(inHouse('bedroom', 'house')).toBe(true);
  });

  it('names Marta and not her key, through an open wardrobe', () => {
    expect(inHouse('ann', 'marta', { open: ['wardrobe'] })).toBe(true);
    expect(inHouse('ann', 'pocket_key', { open: ['wardrobe'] })).toBe(false);
    expect(inHouse('table', 'ring')).toBe(true);
    expect(inHouse('table', 'ring', { shut: ['box'] })).toBe(false);
    expect(inHouse('table', 'box', { shut: ['box'] })).toBe(true);
  });

  it('reaches an ancestor as a surface when nothing between refuses, whatever its own rule', () => {
    expect(inHouse('ann', 'bedroom', { open: ['wardrobe'] })).toBe(true);
    expect(inHouse('ann', 'house', { open: ['wardrobe'] })).toBe(true);
    expect(inHouse('ann', 'house')).toBe(false);
    expect(inHouse('ann', 'yard', { open: ['wardrobe'] })).toBe(false);
    expect(inHouse('table', 'house')).toBe(true);
    expect(inHouse('table', 'yard')).toBe(false);
    expect(inHouse('table', 'well', { open: ['house'] })).toBe(true);
  });

  it('reaches down from the world into what passes', () => {
    expect(inHouse('house', 'ann', { open: ['wardrobe'] })).toBe(true);
    expect(inHouse('house', 'key', { open: ['wardrobe'] })).toBe(false);
  });

  it('reaches nothing across a gap in the tree', () => {
    const tree = treeOf({ house: ['bedroom'], drifter: ['lantern'] });
    const context = contextOf(tree, () => true);
    expect(reaches(context, 'drifter', 'bedroom', 'any')).toBe(false);
    expect(reaches(context, 'bedroom', 'lantern', 'any')).toBe(false);
    expect(reaches(context, 'drifter', 'lantern', 'any')).toBe(true);
  });
});

describe('over generated trees, the walk, the membership test and the path agree', () => {
  /** mulberry32: a fixed stream of choices, so every failure reproduces from the seed it prints. */
  function chooser(seed: number) {
    let state = seed >>> 0;
    return (n: number): number => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) % n;
    };
  }

  const { illuminating, stir } = messages();
  const askings: Asking[] = ['any', illuminating, stir];

  /** A forest of up to 24 nodes: each takes an earlier node as its container, or none. */
  function generated(seed: number) {
    const below = chooser(seed);
    const size = 1 + below(24);
    const parent: (number | null)[] = [];
    const held: number[][] = [];
    for (let node = 0; node < size; node++) {
      held.push([]);
      const container = node === 0 || below(10) === 0 ? null : below(node);
      parent.push(container);
      if (container !== null) held[container]!.push(node);
    }
    // Each node has a `pass any` answer and, sometimes, its own answer for one message.
    const any = parent.map(() => below(3) !== 0);
    const own = parent.map(() =>
      below(3) === 0 ? { message: below(2), passes: below(2) === 0 } : null,
    );
    const passes: PassRule<number> = (container, asking) => {
      const rule = own[container];
      if (asking !== 'any' && rule !== null && rule !== undefined) {
        if (askings[1 + rule.message] === asking) return rule.passes;
      }
      return any[container]!;
    };
    const tree: LiveTree<number> = {
      contents: (node) => held[node]!,
      containerOf: (node) => parent[node]!,
    };
    return { size, parent, tree, passes };
  }

  /** The rule as a path: every node strictly between passes. */
  function oracle(
    parent: readonly (number | null)[],
    passes: PassRule<number>,
    asker: number,
    target: number,
    asking: Asking,
  ): boolean {
    const up = (from: number): number[] => {
      const line = [from];
      for (let at = parent[from]; at !== null && at !== undefined; at = parent[at]) line.push(at);
      return line;
    };
    const fromAsker = up(asker);
    const fromTarget = up(target);
    const meet = fromAsker.find((node) => fromTarget.includes(node));
    if (meet === undefined) return false;
    const between = [
      ...fromAsker.slice(1, fromAsker.indexOf(meet) + 1),
      ...fromTarget.slice(1, fromTarget.indexOf(meet)),
    ].filter((node) => node !== target && node !== asker);
    return between.every((node) => passes(node, asking));
  }

  it('holds for every asker and target in two hundred generated worlds', () => {
    const budgets = budgetOf().limits;
    for (let seed = 1; seed <= 200; seed++) {
      const { size, parent, tree, passes } = generated(seed);
      const asking = askings[seed % askings.length]!;
      for (let asker = 0; asker < size; asker++) {
        const budget = budgetOf();
        const asked: number[] = [];
        const spy: PassRule<number> = (container, question) => {
          asked.push(container);
          return passes(container, question);
        };
        const walk = rangeOf({ tree, passes: spy, budget }, asker, asking);
        const where = `seed ${seed}, asker ${asker}`;
        const nodes = walk.reached.map(({ node }) => node);
        expect(new Set(nodes).size, `${where}: nothing twice`).toBe(nodes.length);
        expect([...walk.within].sort(), where).toEqual([...nodes].sort());
        expect(budget.spentSteps, `${where}: one step each`).toBe(nodes.length);
        expect(new Set(asked).size, `${where}: each rule once`).toBe(asked.length);
        expect(asked, `${where}: never its own`).not.toContain(asker);
        for (const wall of walk.walls) expect(passes(wall, asking), where).toBe(false);
        // One row per asker, indexed by target: a failure's diff names the target, and one
        // `expect` per row rather than per target keeps the assertions cheaper than the walks.
        const targets = parent.map((_, target) => target);
        const expected = targets.map((target) => oracle(parent, passes, asker, target, asking));
        const byWalk = targets.map((target) => walk.within.has(target));
        const byPath = targets.map((target) =>
          reaches({ tree, passes, budget: new Budget(budgets) }, asker, target, asking),
        );
        expect(byWalk, `${where}: the walk, by target`).toEqual(expected);
        expect(byPath, `${where}: reaches, by target`).toEqual(expected);
      }
    }
  });
});

describe('over a declared world', () => {
  const tree = declaredTree(
    'shop',
    [
      'kind Room { contains actors }',
      'kind Chest { contains }',
      'kind Thing { }',
      'world shop is sprout.World {',
      '  object kiln is Room {',
      '    object crate is Chest',
      '    object shelf is Chest { object key is Thing }',
      '    object lost is Missing { object coin is Thing }',
      '  }',
      '  object yard is Room',
      '}',
    ].join('\n'),
  );
  const live = liveTreeOf(tree);

  it('names objects by their declared path and leaves the absent out', () => {
    expect(live.contents('shop')).toEqual(['shop.kiln', 'shop.yard']);
    expect(live.contents('shop.kiln')).toEqual(['shop.kiln.crate', 'shop.kiln.shelf']);
    expect(live.containerOf('shop.kiln.shelf.key')).toBe('shop.kiln.shelf');
    expect(live.containerOf('shop')).toBeNull();
  });

  it('reaches across a room and stops at the world’s surface', () => {
    const walk = rangeOf(contextOf(live, passRuleOf(tree)), 'shop.kiln.crate', 'any');
    expect(shown(walk)).toEqual([
      'shop.kiln.crate (self)',
      'shop.kiln',
      'shop.kiln.shelf',
      'shop.kiln.shelf.key',
      'shop (surface)',
    ]);
    expect(walk.within.has('shop.yard')).toBe(false);
    expect(walk.walls).toEqual(['shop']);
  });

  it('stops at a shelf that is shut', () => {
    const walk = rangeOf(
      contextOf(live, passRuleOf(tree, ['shop.kiln.shelf'])),
      'shop.kiln.crate',
      'any',
    );
    expect(walk.within.has('shop.kiln.shelf')).toBe(true);
    expect(walk.within.has('shop.kiln.shelf.key')).toBe(false);
    expect(walk.reached.at(-1)).toEqual({ node: 'shop', via: 'surface' });
    expect(walk.walls).toEqual(['shop.kiln.shelf', 'shop']);
  });
});
