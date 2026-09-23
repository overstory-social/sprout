import { describe, expect, it } from 'vitest';

import { nameSource } from '../fixtures/names.js';
import { nameFrom, namesInReach, type Naming } from './names.js';

const source = nameSource();

/** A naming as a short shape: what it names and where. */
function shaped(naming: Naming): string {
  switch (naming.names) {
    case 'world':
      return 'the world';
    case 'declared':
      return `declared ${naming.path.join('.')}`;
    case 'given':
      return `given ${naming.giver} ${naming.path.join('.')} from ${naming.depth} out`;
    case 'missing':
      return `missing at ${naming.step} in ${naming.within ?? 'reach'}`;
    case 'world-inside':
      return `the world inside at ${naming.step}`;
  }
}

const inTree = (...path: string[]) => ({ in: 'tree' as const, path });
const inKind = (giver: string, ...path: string[]) => ({ in: 'kind' as const, giver, path });

describe('a name in a body resolves from where the body is written', () => {
  it('from a declared object’s body, nearest first, the hall’s lamp hiding the world’s', () => {
    expect(shaped(nameFrom(source, inTree('hall', 'bench'), ['lamp']))).toBe('declared hall.lamp');
    expect(shaped(nameFrom(source, inTree('cellar'), ['lamp']))).toBe('declared lamp');
    expect(shaped(nameFrom(source, inTree('hall', 'bench'), ['cushion']))).toBe(
      'declared hall.bench.cushion',
    );
  });

  it('down a dotted path, and from the world’s name anywhere', () => {
    expect(shaped(nameFrom(source, inTree(), ['hall', 'bench', 'cushion']))).toBe(
      'declared hall.bench.cushion',
    );
    expect(shaped(nameFrom(source, inTree('hall'), ['shop', 'lamp']))).toBe('declared lamp');
    expect(shaped(nameFrom(source, inTree('hall'), ['shop']))).toBe('the world');
  });

  it('a kind’s copies, from the kind’s body, as what each instance was given', () => {
    expect(shaped(nameFrom(source, inKind('shop.Lantern'), ['wick']))).toBe(
      'given shop.Lantern wick from 0 out',
    );
    expect(shaped(nameFrom(source, inKind('shop.Lantern'), ['wick', 'flame']))).toBe(
      'given shop.Lantern wick.flame from 0 out',
    );
    // From the wick's own body, `flame` is its own and `wick` is itself, one out.
    expect(shaped(nameFrom(source, inKind('shop.Lantern', 'wick'), ['flame']))).toBe(
      'given shop.Lantern wick.flame from 1 out',
    );
  });

  it('from a kind’s body, what the world’s body holds and nothing nearer any instance', () => {
    expect(shaped(nameFrom(source, inKind('shop.Lantern'), ['lamp']))).toBe('declared lamp');
    expect(shaped(nameFrom(source, inKind('shop.Lantern'), ['bench']))).toBe(
      'missing at 0 in reach',
    );
    expect(shaped(nameFrom(source, inKind('shop.Lantern'), ['hall', 'bench']))).toBe(
      'declared hall.bench',
    );
  });

  it('is missing where a step names nothing, and refused where the world is a later step', () => {
    expect(shaped(nameFrom(source, inTree(), ['hall', 'stool']))).toBe('missing at 1 in hall');
    expect(shaped(nameFrom(source, inKind('shop.Lantern'), ['wick', 'smoke']))).toBe(
      'missing at 1 in wick',
    );
    expect(shaped(nameFrom(source, inTree(), ['hall', 'shop']))).toBe('the world inside at 1');
  });
});

describe('the names in reach of a body', () => {
  it('are its own and each container’s outward, then the world’s name', () => {
    expect(namesInReach(source, inTree('hall', 'bench'))).toEqual([
      'cushion',
      'lamp',
      'bench',
      'lantern',
      'hall',
      'cellar',
      'shop',
    ]);
  });

  it('from a kind’s body are what it gives, then the world’s body', () => {
    expect(namesInReach(source, inKind('shop.Lantern'))).toEqual([
      'wick',
      'hall',
      'cellar',
      'lamp',
      'shop',
    ]);
  });
});
