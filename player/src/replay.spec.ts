import { describe, expect, it } from 'vitest';

import { resolveScript } from './readings.js';
import { blocksOf, expectedBlocks, firstDifference } from './replay.js';
import { scriptOf } from './fixtures/scripts.js';
import { bundleOf, KILN_YARD } from './fixtures/worlds.js';

const printed = (body: string): string => `cartridge: x\n--- play\n${body}`;

describe('blocksOf', () => {
  it('groups the lines under their steps, marks a skipped turn, and keeps the words a play stopped on', () => {
    const { blocks, stoppedOn } = blocksOf(
      printed(
        '## step 1: @arrive Marta\nMarta: A kiln yard.\n## step 2: Marta> sing\n-- skipped, the parser answered: unknown\n## step 3: @tick\n!! not built yet\n',
      ),
    );
    expect([...blocks.keys()]).toEqual([1, 2, 3]);
    expect(blocks.get(1)).toEqual({ lines: ['Marta: A kiln yard.'], unchecked: false });
    expect(blocks.get(2)?.unchecked).toBe(true);
    expect(stoppedOn).toBe('not built yet');
  });

  it('reads nothing before the play line', () => {
    expect(blocksOf('name: x\n').blocks.size).toBe(0);
  });
});

describe('expectedBlocks', () => {
  const script = scriptOf('@arrive Marta\nMarta> fire kiln\nMarta> sing loudly\n');
  const readings = resolveScript(bundleOf('kiln_yard', KILN_YARD), script, 'yard.json');

  it('expects a reader line as its reader and words, and only that', () => {
    const written = {
      steps: [
        {
          arrive: 'Marta',
          expect: [{ reader: 'Marta', kind: 'described', words: 'A kiln yard.' }],
        },
        { as: 'Marta', type: 'fire kiln', expect: [{ level: 'info' as const, text: 'step: x' }] },
        { as: 'Marta', type: 'sing loudly' },
      ],
    };
    const blocks = expectedBlocks(written, readings);
    expect(blocks.get(0)?.lines).toEqual(['Marta: A kiln yard.']);
    expect(blocks.get(1)?.lines).toEqual([]);
  });

  it('leaves a step unchecked where the parser answered a turn of it', () => {
    const blocks = expectedBlocks(script, readings);
    expect(blocks.get(1)?.unchecked).toBe(false);
    expect(blocks.get(2)?.unchecked).toBe(true);
  });
});

describe('firstDifference', () => {
  const one = (...lines: string[]) => ({ lines, unchecked: false });

  it('counts a step the play never reached as a difference', () => {
    const expected = new Map([
      [0, one()],
      [1, one('Ines: hi')],
    ]);
    expect(firstDifference(expected, new Map([[0, one()]]))).toBe('step 1 was never reached');
  });

  it('names the step whose lines differ and shows both sides', () => {
    const expected = new Map([
      [0, one('Ines: hi')],
      [1, one('Ines: bye')],
    ]);
    const actual = new Map([
      [0, one('Ines: hi')],
      [1, one('Ines: farewell')],
    ]);
    const words = firstDifference(expected, actual);
    expect(words).toContain('step 1 said');
    expect(words).toContain('Ines: farewell');
    expect(words).toContain('Ines: bye');
  });

  it('is silent where every checked step agrees, ignoring an unchecked one on either side', () => {
    const expected = new Map([
      [0, one('Ines: hi')],
      [1, { lines: ['a'], unchecked: true }],
    ]);
    const actual = new Map([
      [0, one('Ines: hi')],
      [1, one('b')],
    ]);
    expect(firstDifference(expected, actual)).toBeNull();
    expect(
      firstDifference(new Map([[0, one('x')]]), new Map([[0, { lines: [], unchecked: true }]])),
    ).toBeNull();
  });

  it('tells nothing said from something said', () => {
    expect(firstDifference(new Map([[0, one('Ines: hi')]]), new Map([[0, one()]]))).toContain(
      '(nothing)',
    );
  });
});
