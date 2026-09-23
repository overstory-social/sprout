import { describe, expect, it } from 'vitest';

import type {
  Ident,
  KindDeclaration,
  ObjectDeclaration,
  ObjectPath,
  WorldDeclaration,
} from '../syntax/ast.js';
import { Diagnostics } from '../source/diagnostics.js';
import { EnumTable } from './enums.js';
import { KindTable } from './kinds.js';
import { objectsIn, resolveObjects } from './objects.js';
import { parseDeclarations } from '../syntax/parse.js';
import { locationOf, SourceFile } from '../source/source.js';
import {
  contentsOf,
  inReach,
  pathKey,
  placeObjects,
  resolveFrom,
  unknownStep,
  worldInPath,
  type ObjectTree,
  type Placeable,
  type Resolution,
} from './tree.js';

/** Kinds every world below may make its objects of. */
const KINDS = `kind Room { contains actors }
kind Chest { contains }
kind Thing { }
`;

/**
 * Place the objects written in `body`, the body of the world `shop`,
 * composed against `KINDS` and the kinds in it. `KINDS` takes three lines
 * and the world's head one more, so `body` starts on line 5.
 */
function place(body: string, kinds = '') {
  const read = new Diagnostics();
  const declared = parseDeclarations(
    new SourceFile('shop.sprout', `${KINDS}world shop is sprout.World {\n${body}\n}\n${kinds}`),
    read,
  );
  expect(read.refusals, 'the fixture parses').toEqual([]);
  const enums = new EnumTable();
  const table = new KindTable();
  table.add(
    'shop',
    declared.filter((d): d is KindDeclaration => d.kind === 'kind'),
    read,
  );
  table.resolve('shop', enums, read);
  const world = declared.find((d): d is WorldDeclaration => d.kind === 'world')!;
  const composed = resolveObjects('shop', objectsIn(world), {
    enums,
    kinds: table,
    diagnostics: read,
    onUnknown: () => {},
  });
  expect(read.refusals, 'the fixture composes').toEqual([]);

  const diagnostics = new Diagnostics();
  const tree = placeObjects(composed, { world: 'shop', diagnostics });
  return {
    tree,
    said: diagnostics.sorted().map((d) => [locationOf(d.at), d.message, d.remedy] as const),
    severities: diagnostics.sorted().map((d) => d.severity),
  };
}

/** Every placed object's path, in the order placed. */
const paths = (tree: ObjectTree): string[] => [...tree.placed.keys()];

/** A resolution as a word: the path reached, `world`, or where it stopped. */
function shown(found: Resolution): string {
  switch (found.found) {
    case 'object':
      return pathKey(found.placement.path);
    case 'world':
      return 'world';
    case 'missing':
      return `missing at ${found.step}${found.within === null ? '' : ` in ${pathKey(found.within)}`}`;
    case 'world-inside':
      return `world inside at ${found.step}`;
  }
}

/** A shop with a key in two chests and a key in the room beside them. */
const SHOP = `object hall is Room {
  object red_chest is Chest {
    object key is Thing
    object box is Chest {
      object pin is Thing
    }
  }
  object blue_chest is Chest {
    object key is Thing
  }
  object key is Thing
}
object yard is Room`;

/** What placing `SHOP` says: each chest's key hides the room's. */
const HIDDEN_IN_SHOP = [
  [
    'shop.sprout:7:12',
    '`key` hides `hall.key`: inside `hall.red_chest`, a bare `key` now means this one.',
    'Write `hall.key` where the outer one is meant, or give this one another name.',
  ],
  [
    'shop.sprout:13:12',
    '`key` hides `hall.key`: inside `hall.blue_chest`, a bare `key` now means this one.',
    'Write `hall.key` where the outer one is meant, or give this one another name.',
  ],
] as const;

describe('placing every object under the body it is written in', () => {
  it('makes the body an object is written in its container, the world’s for what sits in it', () => {
    const { tree, said } = place(SHOP);
    expect(said).toEqual(HIDDEN_IN_SHOP);
    expect(tree.world).toBe('shop');
    expect(paths(tree).sort()).toEqual(
      [
        'hall',
        'yard',
        'hall.red_chest',
        'hall.blue_chest',
        'hall.key',
        'hall.red_chest.key',
        'hall.blue_chest.key',
        'hall.red_chest.box',
        'hall.red_chest.box.pin',
      ].sort(),
    );
    const pin = tree.placed.get('hall.red_chest.box.pin')!;
    expect([pin.path, pin.container, pin.declaration.name.text]).toEqual([
      ['hall', 'red_chest', 'box', 'pin'],
      ['hall', 'red_chest', 'box'],
      'pin',
    ]);
  });

  it('keeps what each node holds in the order written', () => {
    const { tree } = place(SHOP);
    expect(contentsOf(tree, [])).toEqual(['hall', 'yard']);
    expect(contentsOf(tree, ['hall'])).toEqual(['red_chest', 'blue_chest', 'key']);
    expect(contentsOf(tree, ['hall', 'red_chest'])).toEqual(['key', 'box']);
    expect(contentsOf(tree, ['nowhere'])).toEqual([]);
  });

  it('places shallowest first, and in the order written within a depth', () => {
    const { tree } = place(SHOP);
    expect(paths(tree)).toEqual([
      'hall',
      'yard',
      'hall.red_chest',
      'hall.blue_chest',
      'hall.key',
      'hall.red_chest.key',
      'hall.red_chest.box',
      'hall.blue_chest.key',
      'hall.red_chest.box.pin',
    ]);
  });

  it('places an object whose kind is absent, and what it holds under it', () => {
    const { tree, said } = place(
      'object hall is Room {\n  object crate is Missing {\n    object nail is Thing\n  }\n}',
    );
    expect(said).toEqual([]);
    expect(tree.placed.get('hall.crate')!.kind).toBeNull();
    expect(tree.placed.get('hall.crate.nail')!.kind!.name).toBe('nail');
  });

  it('places a nest deeper than anyone writes', () => {
    // Nesting has no cap, so placing is a loop and not a recursion.
    const file = new SourceFile('deep.sprout', 'x');
    const at = file.span(0, 1);
    const ident = (text: string): Ident => ({ kind: 'ident', at, text });
    const names = Array.from({ length: 3000 }, (_, i) => ident(`n${i}`));
    const declarations = names.map((name): ObjectDeclaration => ({
      kind: 'object',
      at,
      name,
      composes: [],
      members: [],
      objects: [],
    }));
    const objects: Placeable[] = declarations.map((declaration, i) => ({
      declaration,
      within: i === 0 ? null : declarations[i - 1]!,
      kind: null,
    }));
    const diagnostics = new Diagnostics();
    const tree = placeObjects(objects, { world: 'shop', diagnostics });
    expect(diagnostics.all).toEqual([]);
    expect(tree.placed.size).toBe(3000);
    const deepest = names.map((name) => name.text);
    expect(shown(resolveFrom(tree, deepest, ['n0']))).toBe('n0');
    expect(shown(resolveFrom(tree, [], deepest))).toBe(pathKey(deepest));
    expect(inReach(tree, deepest)).toHaveLength(3001);
  });
});

describe('resolving a name from somewhere in the tree, the nearest winning', () => {
  const { tree } = place(SHOP);

  it('finds the chest’s own key from inside the chest, though the room has another', () => {
    expect(shown(resolveFrom(tree, ['hall', 'red_chest'], ['key']))).toBe('hall.red_chest.key');
    expect(shown(resolveFrom(tree, ['hall', 'blue_chest'], ['key']))).toBe('hall.blue_chest.key');
    expect(shown(resolveFrom(tree, ['hall'], ['key']))).toBe('hall.key');
  });

  it('lets an occupant name its own container, and what sits beside it', () => {
    const pin = ['hall', 'red_chest', 'box', 'pin'];
    expect(shown(resolveFrom(tree, pin, ['box']))).toBe('hall.red_chest.box');
    expect(shown(resolveFrom(tree, pin, ['red_chest']))).toBe('hall.red_chest');
    expect(shown(resolveFrom(tree, pin, ['blue_chest']))).toBe('hall.blue_chest');
    // The nearest key from the pin is its chest's, not the room's.
    expect(shown(resolveFrom(tree, pin, ['key']))).toBe('hall.red_chest.key');
  });

  it('reaches a place directly in the world from anywhere, at any depth', () => {
    for (const vantage of [[], ['hall'], ['hall', 'red_chest', 'box', 'pin'], ['yard']]) {
      expect(shown(resolveFrom(tree, vantage, ['yard'])), vantage.join('.')).toBe('yard');
    }
  });

  it('follows a path from a deep vantage, each step among what the last reached', () => {
    const pin = ['hall', 'red_chest', 'box', 'pin'];
    expect(shown(resolveFrom(tree, pin, ['blue_chest', 'key']))).toBe('hall.blue_chest.key');
    expect(shown(resolveFrom(tree, pin, ['hall', 'red_chest', 'box']))).toBe('hall.red_chest.box');
    expect(shown(resolveFrom(tree, ['yard'], ['hall', 'key']))).toBe('hall.key');
  });

  it('names the world by its name, and only as the whole path', () => {
    expect(shown(resolveFrom(tree, ['hall', 'red_chest'], ['shop']))).toBe('world');
    expect(shown(resolveFrom(tree, [], ['shop', 'hall']))).toBe('world inside at 0');
  });

  it('says where a path stops when nothing answers', () => {
    expect(shown(resolveFrom(tree, ['hall'], ['kiln']))).toBe('missing at 0');
    expect(shown(resolveFrom(tree, [], ['hall', 'shelf']))).toBe('missing at 1 in hall');
    expect(shown(resolveFrom(tree, [], ['hall', 'red_chest', 'lid']))).toBe(
      'missing at 2 in hall.red_chest',
    );
    // A thing inside something is not in reach from outside it by its name alone.
    expect(shown(resolveFrom(tree, ['yard'], ['box']))).toBe('missing at 0');
    expect(shown(resolveFrom(tree, [], []))).toBe('missing at 0');
  });

  it('lists what a first step can reach, nearest first, a nearer name hiding an outer one', () => {
    expect(inReach(tree, ['hall', 'red_chest'])).toEqual([
      'key',
      'box',
      'red_chest',
      'blue_chest',
      'hall',
      'yard',
      'shop',
    ]);
    expect(inReach(tree, [])).toEqual(['hall', 'yard', 'shop']);
  });
});

describe('an object hiding one of its name further out', () => {
  it('is warned about at the inner declaration, naming the path the outer one is reached by', () => {
    // Written before what it hides: the tree is whole when this is asked.
    const { said, severities, tree } = place(
      'object hall is Room {\n  object chest is Chest {\n    object key is Thing\n  }\n  object key is Thing\n}',
    );
    expect(said).toEqual([
      [
        'shop.sprout:7:12',
        '`key` hides `hall.key`: inside `hall.chest`, a bare `key` now means this one.',
        'Write `hall.key` where the outer one is meant, or give this one another name.',
      ],
    ]);
    expect(severities).toEqual(['warning']);
    expect(paths(tree).sort()).toEqual(['hall', 'hall.chest', 'hall.chest.key', 'hall.key']);
  });

  it('hides one any number of containers further out', () => {
    const { said } = place(
      'object hall is Room {\n  object key is Thing\n  object chest is Chest {\n    object box is Chest {\n      object key is Thing\n    }\n  }\n}',
    );
    expect(said.map(([at, message]) => [at, message])).toEqual([
      [
        'shop.sprout:9:14',
        '`key` hides `hall.key`: inside `hall.chest.box`, a bare `key` now means this one.',
      ],
    ]);
  });

  it('names only the nearest one it hides, each hider warned about once', () => {
    const { said } = place(
      'object hall is Room {\n  object key is Thing\n  object chest is Chest {\n    object key is Thing\n    object box is Chest {\n      object key is Thing\n    }\n  }\n}',
    );
    expect(said.map(([at, message]) => [at, message])).toEqual([
      [
        'shop.sprout:8:12',
        '`key` hides `hall.key`: inside `hall.chest`, a bare `key` now means this one.',
      ],
      [
        'shop.sprout:10:14',
        '`key` hides `hall.chest.key`: inside `hall.chest.box`, a bare `key` now means this one.',
      ],
    ]);
  });

  it('says so where the one hidden is directly in the world, which no path reaches from inside', () => {
    const { said, severities } = place(
      'object key is Thing\nobject hall is Room {\n  object key is Thing\n}',
    );
    expect(said).toEqual([
      [
        'shop.sprout:7:10',
        '`key` hides the `key` directly in the world: inside `hall`, a bare `key` now means this one.',
        "No path reaches the world's `key` from inside `hall`, since the world's name is never a step of one. Give one of them another name if both are meant there.",
      ],
    ]);
    expect(severities).toEqual(['warning']);
  });

  it('says nothing of two of one name in sibling containers, which hide nothing', () => {
    const { said } = place(
      'object hall is Room {\n  object red is Chest { object key is Thing }\n  object blue is Chest { object key is Thing }\n}\nobject yard is Room { object key is Thing }',
    );
    expect(said).toEqual([]);
  });

  it('hides its own container where it takes that name, since the container is held further out', () => {
    const { said } = place(
      'object hall is Room {\n  object box is Chest {\n    object box is Thing\n  }\n}',
    );
    expect(said.map(([at, message]) => [at, message])).toEqual([
      [
        'shop.sprout:7:12',
        '`box` hides `hall.box`: inside `hall.box`, a bare `box` now means this one.',
      ],
    ]);
  });
});

describe('what is refused where an object is written', () => {
  it('an object in something that holds nothing, and nothing more of what it holds', () => {
    const { said, tree } = place(
      'object hall is Room {\n  object bench is Thing {\n    object key is Thing {\n      object nail is Thing\n    }\n  }\n}',
    );
    expect(said).toEqual([
      [
        'shop.sprout:7:12',
        '`bench` holds nothing, so `key` cannot be in it.',
        "Move `key` out of `bench`'s braces into something that holds things, or let `bench` hold things by writing `contains` in its body.",
      ],
    ]);
    expect(paths(tree)).toEqual(['hall', 'hall.bench']);
  });

  it('takes a container by its own body’s `contains`, and the world always holds things', () => {
    const { said } = place(
      'object bench is Thing {\n  contains\n  object key is Thing\n}\nobject lamp is Thing',
    );
    expect(said).toEqual([]);
  });

  it('two of one name in one body, refused at the second, what it holds with it', () => {
    const { said, tree } = place(
      'object hall is Room {\n  object key is Thing\n  object key is Chest {\n    object pin is Thing\n  }\n}\nobject pin is Thing\nobject pin is Thing',
    );
    expect(said).toEqual([
      [
        'shop.sprout:7:10',
        '`hall` holds two objects called `key`.',
        'Give one of them another name, or remove it.',
      ],
      [
        'shop.sprout:12:8',
        '`shop` holds two objects called `pin`.',
        'Give one of them another name, or remove it.',
      ],
    ]);
    expect(paths(tree)).toEqual(['hall', 'pin', 'hall.key']);
  });

  it('an object named as the world is, and nothing more of what it holds', () => {
    const { said, tree } = place('object shop is Room {\n  object key is Thing\n}');
    expect(said).toEqual([
      [
        'shop.sprout:5:8',
        "`shop` is the world's name, so no object can take it.",
        'Give the object another name.',
      ],
    ]);
    expect(paths(tree)).toEqual([]);
  });
});

describe('a well-formed object is never lost to a neighbour’s mistake', () => {
  // Generated worlds: a random tree, written as it nests, with one
  // defect: a container whose kind holds nothing, a name written twice in
  // one body, or an object named as the world is. Everything not inside
  // what the defect costs is placed exactly where it was written, and
  // exactly one thing is said of each object the defect refuses.
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

  it('over generated trees, each with one defect', () => {
    const below = chooser(20_260_922);
    const DEFECTS = ['holds-nothing', 'twice', 'world-name'] as const;
    const seen = new Set<string>();
    for (let round = 0; round < 300; round++) {
      // Nodes 1..n, each under an earlier one or the world (0).
      const n = 3 + below(12);
      const parent = [0];
      for (let i = 1; i <= n; i++) parent.push(below(i));
      const pathOf = (i: number): string[] => {
        const out: string[] = [];
        for (let at = i; at !== 0; at = parent[at]!) out.unshift(`o${at}`);
        return out;
      };
      const children = (i: number): number[] =>
        parent.flatMap((up, child) => (child > 0 && up === i ? [child] : []));

      const broken = 1 + below(n);
      // A holder that holds nothing needs something in it to refuse, and
      // the world always holds things.
      const holders = parent.filter((up) => up > 0);
      const drawn = DEFECTS[below(DEFECTS.length)]!;
      const defect = drawn === 'holds-nothing' && holders.length === 0 ? 'twice' : drawn;
      seen.add(defect);
      const holder = defect === 'holds-nothing' ? holders[below(holders.length)]! : -1;
      const name = (i: number): string =>
        defect === 'world-name' && i === broken ? 'shop' : `o${i}`;
      const kind = (i: number): string => (i === holder ? 'Thing' : 'Chest');
      const written = (i: number, depth: number): string[] => {
        const pad = '  '.repeat(depth);
        const inner = children(i).flatMap((child) => written(child, depth + 1));
        const extra =
          defect === 'twice' && parent[broken] === i ? [`${pad}  object o${broken} is Thing`] : [];
        const all = [...inner, ...extra];
        if (all.length === 0) return [`${pad}object ${name(i)} is ${kind(i)}`];
        return [`${pad}object ${name(i)} is ${kind(i)} {`, ...all, `${pad}}`];
      };
      const top = children(0).flatMap((child) => written(child, 0));
      if (defect === 'twice' && parent[broken] === 0) top.push(`object o${broken} is Thing`);
      const text = top.join('\n');
      const { tree, said } = place(text);

      // What the defect takes with it: everything under what it refuses.
      const under = (i: number, root: number): boolean => {
        for (let at = i; at !== 0; at = parent[at]!) if (at === root) return true;
        return false;
      };
      const lost = (i: number): boolean => {
        if (defect === 'holds-nothing') return children(holder).some((c) => under(i, c));
        if (defect === 'world-name') return under(i, broken);
        return false;
      };
      for (let i = 1; i <= n; i++) {
        const key = pathKey(pathOf(i));
        if (lost(i) || (defect === 'world-name' && i === broken)) {
          expect(tree.placed.has(key), `${text}\n  o${i} was placed`).toBe(false);
        } else {
          expect(tree.placed.get(key)?.declaration.name.text, `${text}\n  o${i} vanished`).toBe(
            `o${i}`,
          );
        }
      }
      // One account of the defect; a container that holds nothing is
      // told of at each thing written in it.
      const told = defect === 'holds-nothing' ? children(holder).length : 1;
      expect(said.length, `${text}\n  said ${JSON.stringify(said)}`).toBe(told);
    }
    expect(seen.size).toBe(DEFECTS.length);
  });
});

describe('the words for a path where visitors arrive', () => {
  /** A path as written, for the word helpers, with nothing to point at but itself. */
  function writtenPath(text: string): ObjectPath {
    const file = new SourceFile('path.sprout', text);
    let at = 0;
    const parts = text.split('.').map((part) => {
      const ident: Ident = { kind: 'ident', text: part, at: file.span(at, at + part.length) };
      at += part.length + 1;
      return ident;
    });
    return { kind: 'path', parts, at: file.span(0, text.length) };
  }

  it('say what was meant, as `visitors arrive at` writes it', () => {
    const { tree } = place('object hall is Room {\n  object nook is Room\n}');
    const miss = { step: 0, within: null };
    expect(unknownStep(tree, writtenPath('hal'), miss)).toMatchObject({
      message: 'Nothing here is called `hal`. Did you mean `hall`?',
      remedy: 'Write `visitors arrive at hall`, or declare an object called `hal`.',
    });
    expect(unknownStep(tree, writtenPath('nook'), miss).remedy).toBe(
      '`nook` is inside `hall`, so write `visitors arrive at hall.nook`.',
    );
    // And the step it is said at is the one that named nothing.
    expect(unknownStep(tree, writtenPath('hall.nok'), { step: 1, within: ['hall'] })).toMatchObject(
      {
        message: 'Nothing in `hall` is called `nok`. Did you mean `nook`?',
        step: { text: 'nok' },
      },
    );
  });

  it('name each path where there is a thing of that name in more than one place', () => {
    const { tree } = place(
      'object kiln is Room { object shelf is Chest }\nobject shed is Room { object shelf is Chest }',
    );
    expect(unknownStep(tree, writtenPath('shelf'), { step: 0, within: null }).remedy).toBe(
      'There is a `shelf` in more than one place; write the one you mean: `visitors arrive at kiln.shelf` or `visitors arrive at shed.shelf`.',
    );
  });

  it('refuse the world’s name as a step, and not as the whole path', () => {
    expect(worldInPath('shop', writtenPath('shop'))).toBeNull();
    expect(worldInPath('shop', writtenPath('hall.nook'))).toBeNull();
    expect(worldInPath('shop', writtenPath('shop.hall'))).toMatchObject({
      step: { text: 'shop' },
      message: '`shop` is the world, which is named on its own and never as a step of a path.',
      remedy:
        'A path starts from something directly in the world: write `visitors arrive at hall`.',
    });
    expect(worldInPath('shop', writtenPath('shop.shop'))!.remedy).toBe(
      'Name a place in the world, as in `visitors arrive at kiln`.',
    );
  });
});
