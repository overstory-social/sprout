import { describe, expect, it } from 'vitest';

import { inKind, nameSource } from '../fixtures/names.js';
import { nameFrom, namesInReach, type DeclaredAt, type Naming } from './names.js';

const source = nameSource();

const at = (step: DeclaredAt): string =>
  step.in === 'tree' ? step.path.join('.') : `${step.giver}:${step.path.join('.')}`;

/** A naming as a short shape: what it names and where. */
function shaped(naming: Naming): string {
  switch (naming.names) {
    case 'world':
      return 'the world';
    case 'declared':
      return `declared ${naming.path.join('.')}`;
    case 'own':
      return `own ${naming.parts.join('.')} via ${naming.steps.map(at).join(' ')}`;
    case 'placed':
      return `placed ${naming.candidates.map((one) => one.steps.map(at).join('>')).join(' | ')}`;
    case 'missing':
      return `missing at ${naming.step} in ${naming.within ?? 'reach'}`;
    case 'world-inside':
      return `the world inside at ${naming.step}`;
  }
}

const inTree = (...path: string[]) => ({ in: 'tree' as const, path });

describe('a name in the world’s or a declared object’s body resolves at compile time', () => {
  it('nearest first, the hall’s lamp hiding the world’s', () => {
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

  it('is missing where a step names nothing, and refused where the world is a later step', () => {
    expect(shaped(nameFrom(source, inTree(), ['hall', 'stool']))).toBe('missing at 1 in hall');
    expect(shaped(nameFrom(source, inTree(), ['hall', 'shop']))).toBe('the world inside at 1');
  });
});

describe('a name in a kind’s body', () => {
  it('is the running instance’s own copy where its own body always declares it', () => {
    expect(shaped(nameFrom(source, inKind(source, 'shop.Lantern'), ['wick']))).toBe(
      'own wick via shop.Lantern:wick',
    );
    expect(shaped(nameFrom(source, inKind(source, 'shop.Lantern'), ['wick', 'flame']))).toBe(
      'own wick.flame via shop.Lantern:wick shop.Lantern:wick.flame',
    );
    // From the wick's own body, `flame` is its own.
    expect(shaped(nameFrom(source, inKind(source, 'shop.Lantern', 'wick'), ['flame']))).toBe(
      'own flame via shop.Lantern:wick.flame',
    );
  });

  it('is every object the bundle declares by the name, for the run to choose the nearest', () => {
    // Both lamps, and neither fixed: which one a lantern reaches is where it sits.
    expect(shaped(nameFrom(source, inKind(source, 'shop.Lantern'), ['lamp']))).toBe(
      'placed lamp | hall.lamp',
    );
    // Not in the world's body, and still reachable by a lantern in the hall.
    expect(shaped(nameFrom(source, inKind(source, 'shop.Lantern'), ['bench']))).toBe(
      'placed hall.bench',
    );
    // The wick is its lantern's own, so from the wick's body `wick` is anyone's.
    expect(shaped(nameFrom(source, inKind(source, 'shop.Lantern', 'wick'), ['wick']))).toBe(
      'placed hall.lantern.wick | shop.Lantern:wick',
    );
  });

  it('follows each declaration down the path, and is missing where none holds the rest', () => {
    expect(shaped(nameFrom(source, inKind(source, 'shop.Lantern'), ['hall', 'bench']))).toBe(
      'placed hall>hall.bench',
    );
    expect(shaped(nameFrom(source, inKind(source, 'shop.Lantern'), ['lamp', 'cushion']))).toBe(
      'missing at 1 in lamp',
    );
  });

  it('keeps the world’s name as a first step fixed', () => {
    expect(shaped(nameFrom(source, inKind(source, 'shop.Lantern'), ['shop', 'lamp']))).toBe(
      'declared lamp',
    );
  });

  it('is missing where the bundle declares nothing by the name, or where its own copy stops', () => {
    expect(shaped(nameFrom(source, inKind(source, 'shop.Lantern'), ['stool']))).toBe(
      'missing at 0 in reach',
    );
    expect(shaped(nameFrom(source, inKind(source, 'shop.Lantern'), ['wick', 'smoke']))).toBe(
      'missing at 1 in wick',
    );
    expect(shaped(nameFrom(source, inKind(source, 'shop.Lantern'), ['hall', 'shop']))).toBe(
      'the world inside at 1',
    );
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

  it('from a kind’s body are its instance’s own, then every name the bundle declares', () => {
    expect(namesInReach(source, inKind(source, 'shop.Lantern'))).toEqual([
      'wick',
      'hall',
      'cellar',
      'lamp',
      'bench',
      'lantern',
      'cushion',
      'flame',
      'shop',
    ]);
  });
});
