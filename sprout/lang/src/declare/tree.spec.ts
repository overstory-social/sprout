import { describe, expect, it } from 'vitest';

import type { Ident, KindDeclaration, ObjectDeclaration } from '../syntax/ast.js';
import { Diagnostics } from '../source/diagnostics.js';
import { EnumTable } from './enums.js';
import { KindTable } from './kinds.js';
import { resolveObjects } from './objects.js';
import { parseDeclarations } from '../syntax/parse.js';
import { locationOf, SourceFile } from '../source/source.js';
import {
  contentsOf,
  inReach,
  pathKey,
  placeObjects,
  resolveFrom,
  type ObjectTree,
  type Resolution,
} from './tree.js';

/** Kinds every world below may make its objects of. */
const KINDS = `kind Room { contains actors }
kind Chest { contains }
kind Thing { }
`;

/**
 * Place the objects in `text`, composed against `KINDS` and the kinds in
 * it, in the world `shop`. A step nothing answers to is reported through
 * the callback, as a compile reports a gap; everything else is refused.
 */
function place(text: string, options: { callback?: boolean } = {}) {
  const read = new Diagnostics();
  const declared = parseDeclarations(new SourceFile('shop.sprout', `${KINDS}${text}`), read);
  expect(read.refusals, 'the fixture parses').toEqual([]);
  const enums = new EnumTable();
  const kinds = new KindTable();
  kinds.add(
    'shop',
    declared.filter((d): d is KindDeclaration => d.kind === 'kind'),
    read,
  );
  kinds.resolve(enums, read);
  const composed = resolveObjects(
    'shop',
    declared.filter((d): d is ObjectDeclaration => d.kind === 'object'),
    { enums, kinds, diagnostics: read, onUnknown: () => {} },
  );
  expect(read.refusals, 'the fixture composes').toEqual([]);

  const diagnostics = new Diagnostics();
  const gaps: (readonly [string, string, string, string])[] = [];
  const tree = placeObjects(composed, {
    world: 'shop',
    diagnostics,
    ...(options.callback === false
      ? {}
      : {
          onUnknown: (container, step, message, remedy) =>
            gaps.push([
              container.parts.map((p) => p.text).join('.'),
              locationOf(step.at),
              message,
              remedy,
            ]),
        }),
  });
  return {
    tree,
    gaps,
    said: diagnostics.sorted().map((d) => [locationOf(d.at), d.message, d.remedy] as const),
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
const SHOP = `object hall: Room in shop
object yard: Room in shop
object red_chest: Chest in hall
object blue_chest: Chest in hall
object key: Thing in hall
object key: Thing in hall.red_chest
object key: Thing in hall.blue_chest
object box: Chest in hall.red_chest
object pin: Thing in hall.red_chest.box
`;

describe('placing every object under the world', () => {
  it('reads each `in` from inside the world, a deeper container by its path', () => {
    const { tree, said, gaps } = place(SHOP);
    expect([said, gaps]).toEqual([[], []]);
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

  it('keeps what each node holds in the order declared', () => {
    const { tree } = place(SHOP);
    expect(contentsOf(tree, [])).toEqual(['hall', 'yard']);
    expect(contentsOf(tree, ['hall'])).toEqual(['red_chest', 'blue_chest', 'key']);
    expect(contentsOf(tree, ['hall', 'red_chest'])).toEqual(['key', 'box']);
    expect(contentsOf(tree, ['nowhere'])).toEqual([]);
  });

  it('places whatever order the declarations are written in', () => {
    const reversed = SHOP.trim().split('\n').reverse().join('\n');
    const { tree, said, gaps } = place(reversed);
    expect([said, gaps]).toEqual([[], []]);
    expect(paths(tree).sort()).toEqual(paths(place(SHOP).tree).sort());
    // Still in the order declared within each node.
    expect(contentsOf(tree, ['hall'])).toEqual(['key', 'blue_chest', 'red_chest']);
  });

  it('places an object whose kind is absent, and what it holds under it', () => {
    const { tree, said, gaps } = place(
      'object hall: Room in shop\nobject crate: Missing in hall\nobject nail: Thing in hall.crate',
    );
    expect([said, gaps]).toEqual([[], []]);
    expect(tree.placed.get('hall.crate')!.kind).toBeNull();
    expect(tree.placed.get('hall.crate.nail')!.kind!.name).toBe('nail');
  });

  it('places a nest deeper than anyone writes, deepest written first', () => {
    // Nesting has no cap, so placing is a loop and not a recursion.
    const file = new SourceFile('deep.sprout', 'x');
    const at = file.span(0, 1);
    const ident = (text: string): Ident => ({ kind: 'ident', at, text });
    const names = Array.from({ length: 3000 }, (_, i) => ident(`n${i}`));
    const objects = names
      .map((name, i) => ({
        declaration: {
          kind: 'object',
          at,
          name,
          composes: [],
          members: [],
          container: { kind: 'path', at, parts: i === 0 ? [ident('shop')] : names.slice(0, i) },
        } satisfies ObjectDeclaration,
        kind: null,
      }))
      .reverse();
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

describe('what an `in` may not say', () => {
  it('names nothing in reach: a gap, with the name it most likely meant', () => {
    const { gaps, said, tree } = place(
      'object hall: Room in shop\nobject bench: Chest in hal\nobject leg: Thing in hall.bench',
    );
    expect(said).toEqual([]);
    // Said once: what the bench would have held is not said again.
    expect(gaps).toEqual([
      [
        'hal',
        'shop.sprout:5:24',
        'Nothing here is called `hal`. Did you mean `hall`?',
        'Write `in hall`, or declare an object called `hal`.',
      ],
    ]);
    expect(paths(tree)).toEqual(['hall']);
  });

  it('is refused rather than a gap where nothing asks for gaps', () => {
    const { said } = place('object bench: Thing in hal\nobject hall: Room in shop', {
      callback: false,
    });
    expect(said).toEqual([
      [
        'shop.sprout:4:24',
        'Nothing here is called `hal`. Did you mean `hall`?',
        'Write `in hall`, or declare an object called `hal`.',
      ],
    ]);
  });

  it('names something deeper without its path: told the path to write', () => {
    const { gaps } = place(
      'object kiln: Room in shop\nobject shelf: Chest in kiln\nobject pot: Thing in shelf',
    );
    expect(gaps).toEqual([
      [
        'shelf',
        'shop.sprout:6:22',
        'Nothing here is called `shelf`.',
        '`shelf` is inside `kiln`, so write `in kiln.shelf`.',
      ],
    ]);
  });

  it('names one of several deeper things of that name: told each path', () => {
    const { gaps } = place(
      'object kiln: Room in shop\nobject shed: Room in shop\nobject shelf: Chest in kiln\nobject shelf: Chest in shed\nobject pot: Thing in shelf.lid',
    );
    expect(gaps.map(([, , message, remedy]) => [message, remedy])).toEqual([
      [
        'Nothing here is called `shelf`.',
        'There is a `shelf` in more than one place; write the one you mean: `in kiln.shelf.lid` or `in shed.shelf.lid`.',
      ],
    ]);
  });

  it('takes a wrong step deeper in a path: nothing in that container is called that', () => {
    const { gaps } = place(
      'object kiln: Room in shop\nobject shelf: Chest in kiln\nobject pot: Thing in kiln.shelv\nobject cup: Thing in kiln.rack',
    );
    expect(gaps.map(([, at, message, remedy]) => [at, message, remedy])).toEqual([
      [
        'shop.sprout:6:27',
        'Nothing in `kiln` is called `shelv`. Did you mean `shelf`?',
        'Write `in kiln.shelf`, or declare an object called `shelv`.',
      ],
      ['shop.sprout:7:27', 'Nothing in `kiln` is called `rack`.', '`kiln` holds `shelf`.'],
    ]);
  });

  it('names something in the world by a path that goes through the wrong container', () => {
    const { gaps } = place(
      'object kiln: Room in shop\nobject yard: Room in shop\nobject pot: Thing in kiln.yard',
    );
    expect(gaps.map(([, , , remedy]) => remedy)).toEqual([
      '`yard` is directly in the world, so write `in yard`.',
    ]);
  });

  it('puts two objects in each other: refused once, at the first of the ring', () => {
    const { said, gaps, tree } = place(
      'object a: Chest in b\nobject b: Chest in a\nobject c: Thing in a',
    );
    expect(gaps).toEqual([]);
    expect(said).toEqual([
      [
        'shop.sprout:4:20',
        '`a` is in `b`, which is in `a`.',
        'Something cannot hold what holds it. Put one of them somewhere else.',
      ],
    ]);
    expect(paths(tree)).toEqual([]);
  });

  it('puts three in a ring, however it is written down', () => {
    const { said } = place(
      'object c: Chest in a\nobject a: Chest in b\nobject b: Chest in c\nobject d: Chest in shop',
    );
    expect(said.map(([at, message]) => [at, message])).toEqual([
      ['shop.sprout:4:20', '`c` is in `a`, which is in `b`, which is in `c`.'],
    ]);
  });

  it('finds a ring through deeper steps too', () => {
    const { said } = place(
      'object k: Room in shop\nobject a: Chest in k.b\nobject b: Chest in k.a',
    );
    expect(said.map(([at, message]) => [at, message])).toEqual([
      ['shop.sprout:5:22', '`a` is in `b`, which is in `a`.'],
    ]);
  });

  it('puts an object in itself', () => {
    const { said } = place('object a: Chest in a\nobject b: Thing in a');
    expect(said).toEqual([
      [
        'shop.sprout:4:20',
        '`a` cannot be inside itself.',
        '`in` names what holds `a`: name something else.',
      ],
    ]);
  });

  it('puts an object in something that holds nothing, whatever it holds itself', () => {
    const { said, tree } = place(
      'object hall: Room in shop\nobject bench: Thing in hall\nobject key: Thing in hall.bench\nobject nail: Thing in hall.bench.key',
    );
    expect(said).toEqual([
      [
        'shop.sprout:6:27',
        '`bench` holds nothing, so `key` cannot be in it.',
        'Put `key` in something that holds things, or let `bench` hold things by writing `contains` in its body.',
      ],
    ]);
    expect(paths(tree)).toEqual(['hall', 'hall.bench']);
  });

  it('takes a container by its own body’s `contains`, and the world always holds things', () => {
    const { said } = place(
      'object bench: Thing in shop { contains }\nobject key: Thing in bench\nobject lamp: Thing in shop',
    );
    expect(said).toEqual([]);
  });

  it('puts two of one name in one container: refused at the second', () => {
    const { said, tree } = place(
      'object hall: Room in shop\nobject key: Thing in hall\nobject key: Thing in hall\nobject key: Thing in shop\nobject key: Thing in shop',
    );
    expect(said).toEqual([
      [
        'shop.sprout:6:8',
        '`hall` holds two objects called `key`.',
        'Give one of them another name, or remove it.',
      ],
      [
        'shop.sprout:8:8',
        '`shop` holds two objects called `key`.',
        'Give one of them another name, or remove it.',
      ],
    ]);
    expect(paths(tree)).toEqual(['hall', 'key', 'hall.key']);
  });

  it('names an object as the world is named', () => {
    const { said } = place('object shop: Room in shop\nobject key: Thing in shop');
    expect(said).toEqual([
      [
        'shop.sprout:4:8',
        "`shop` is the world's name, so no object can take it.",
        'Give the object another name.',
      ],
    ]);
  });

  it('writes the world’s name as a step of a path', () => {
    const { said } = place(
      'object hall: Room in shop\nobject key: Thing in shop.hall\nobject pin: Thing in hall.shop',
    );
    expect(said).toEqual([
      [
        'shop.sprout:5:22',
        '`shop` is the world, which is named on its own and never as a step of a path.',
        'A path starts from something directly in the world: write `in hall`.',
      ],
      [
        'shop.sprout:6:27',
        '`shop` is the world, which is named on its own and never as a step of a path.',
        'A path starts from something directly in the world: write `in hall`.',
      ],
    ]);
  });
});

describe('a well-formed object is never lost to a neighbour’s mistake', () => {
  // Generated worlds: a random tree, written in a random order, with one
  // object given a container that cannot resolve. Everything not inside
  // that object is placed exactly where it was written, and exactly one
  // thing is said.
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
    const DEFECTS = ['typo', 'unknown', 'self', 'ring', 'holds-nothing', 'twice'] as const;
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
      const line = (i: number, container: string, kind = 'Chest'): string =>
        `object o${i}: ${kind} in ${container}`;
      const lines = new Map<number, string>();
      for (let i = 1; i <= n; i++) {
        lines.set(i, line(i, parent[i] === 0 ? 'shop' : pathOf(parent[i]!).join('.')));
      }

      const broken = 1 + below(n);
      const defect = DEFECTS[below(DEFECTS.length)]!;
      seen.add(defect);
      const extra: string[] = [];
      const written = (i: number): string =>
        parent[i] === 0 ? 'shop' : pathOf(parent[i]!).join('.');
      switch (defect) {
        case 'typo':
          lines.set(broken, line(broken, `${written(broken)}x`.replace('shopx', 'shpo')));
          break;
        case 'unknown':
          lines.set(broken, line(broken, 'nowhere'));
          break;
        case 'self':
          lines.set(broken, line(broken, `o${broken}`));
          break;
        case 'ring':
          lines.set(broken, line(broken, 'ring_b'));
          extra.push('object ring_b: Chest in ring_c', `object ring_c: Chest in o${broken}`);
          break;
        case 'holds-nothing':
          if (parent[broken] === 0) {
            lines.set(broken, line(broken, 'plank'));
            extra.push('object plank: Thing in shop');
          } else {
            const holder = parent[broken]!;
            lines.set(holder, line(holder, written(holder), 'Thing'));
          }
          break;
        case 'twice':
          extra.push(line(broken, written(broken)));
          break;
      }

      const order = [...lines.values(), ...extra];
      for (let i = order.length - 1; i > 0; i--) {
        const j = below(i + 1);
        [order[i], order[j]] = [order[j]!, order[i]!];
      }
      const text = order.join('\n');
      const { tree, said, gaps } = place(text);

      // What the defect takes with it: the broken object and everything
      // under it, or for a container that holds nothing, what it holds.
      const lost = (i: number): boolean => {
        const root = defect === 'holds-nothing' && parent[broken] !== 0 ? parent[broken]! : broken;
        for (let at = i; at !== 0; at = parent[at]!) {
          if (defect === 'holds-nothing' && parent[broken] !== 0 && at === root) return i !== root;
          if (defect !== 'holds-nothing' && defect !== 'twice' && at === root) return true;
          if (defect === 'holds-nothing' && parent[broken] === 0 && at === root) return true;
        }
        return false;
      };
      for (let i = 1; i <= n; i++) {
        const key = pathKey(pathOf(i));
        if (lost(i)) {
          expect(tree.placed.has(key), `${text}\n  o${i} was placed`).toBe(false);
        } else {
          expect(tree.placed.get(key)?.declaration.name.text, `${text}\n  o${i} vanished`).toBe(
            `o${i}`,
          );
        }
      }
      // One account of the defect; a container that holds nothing is
      // told of at each thing written in it.
      const told =
        defect === 'holds-nothing' && parent[broken] !== 0
          ? parent.filter((up, i) => i > 0 && up === parent[broken]).length
          : 1;
      expect(said.length + gaps.length, `${text}\n  said ${JSON.stringify([said, gaps])}`).toBe(
        told,
      );
    }
    expect(seen.size).toBe(DEFECTS.length);
  });
});
