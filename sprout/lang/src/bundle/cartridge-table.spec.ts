import { describe, expect, it } from 'vitest';

import { BENCH } from '../fixtures/bench.js';
import { cartridgeOf } from './cartridge.js';
import type { Entry, GraphTables } from './cartridge-graph.js';
import { readTable, TABLE_MAGIC, TableUnreadable, writeTable } from './cartridge-table.js';

const tables = (prose: Entry[], bodies: Entry[], rest: Entry[]): GraphTables => ({
  files: [],
  prose,
  bodies,
  rest,
});

const refusal = (run: () => unknown): string => {
  try {
    run();
  } catch (thrown) {
    expect(thrown).toBeInstanceOf(TableUnreadable);
    return (thrown as Error).message;
  }
  throw new Error('was not refused');
};

const word = (bytes: Uint8Array, at: number): number =>
  new DataView(bytes.buffer, bytes.byteOffset).getUint32(at, true);

describe('the table', () => {
  const sample = tables(
    [{ o: { kind: 'prose', next: [1], at: { p: [0, 3, 4] } } }],
    [
      {
        o: {
          kind: 'integer',
          value: 8,
          at: { p: [-1, 0, 0] },
          big: 2 ** 40,
          half: 0.5,
          negative: -7,
        },
      },
    ],
    [
      { a: [[0], [1], [0], null, true, false, 'word', 'word'] },
      {
        m: [
          ['k', [0]],
          [[1], true],
          [2, 'two'],
        ],
      },
      { s: [null, 1, 'word'] },
      { o: {} },
      {
        o: {
          kind: 'integer',
          value: 8,
          at: { p: [0, 3, 4] },
          big: 2 ** 40,
          half: 0.5,
          negative: -7,
        },
      },
    ],
  );

  it('reads back as it was written, run by run', () => {
    const read = readTable(writeTable(sample));
    expect(read.prose).toEqual(sample.prose);
    expect(read.bodies).toEqual(sample.bodies);
    expect(read.rest).toEqual(sample.rest);
  });

  it('holds one node per distinct scalar, after the entries, and one shape per field list', () => {
    const bytes = writeTable(sample);
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe(TABLE_MAGIC);
    // null, true, false; 'prose', 'integer', 'word', 'k', 'two'; 8, 2^40, 0.5, -7, 1, 2; two places
    expect(word(bytes, 4 + 1 * 4)).toBe(7); // entries
    expect(word(bytes, 4 + 0 * 4)).toBe(7 + 16); // nodes
    expect(word(bytes, 4 + 8 * 4)).toBe(2); // doubles: 2^40 and 0.5
    expect(word(bytes, 4 + 9 * 4)).toBe(3); // shapes: {kind,next,at}, {kind,value,at,big,half,negative} (written twice), {}
  });

  it('holds a place in its node: the file as its shape, the line as its first word, the column as its count', () => {
    const bytes = writeTable(tables([], [], [{ a: [{ p: [0, 3, 4] }, { p: [-1, 0, 0] }] }]));
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    const node = (i: number) => 48 + i * 12;
    const places = [1, 2].map(node).filter((at) => view.getUint8(at) === 4);
    expect(
      places.map((at) => [
        view.getUint16(at + 2, true),
        view.getUint32(at + 8, true),
        view.getUint32(at + 4, true),
      ]),
    ).toEqual([
      [0, 3, 4],
      [0xffff, 0, 0],
    ]);
    expect(readTable(bytes).rest).toEqual([{ a: [{ p: [0, 3, 4] }, { p: [-1, 0, 0] }] }]);
  });

  it('is eight-aligned in every section and starts with the counts', () => {
    const bytes = writeTable(sample);
    expect(bytes.length % 8).toBe(0);
    expect(word(bytes, 4 + 2 * 4) + word(bytes, 4 + 3 * 4) + word(bytes, 4 + 4 * 4)).toBe(7);
  });

  it('round-trips the bench world, with every entry equal', () => {
    const cartridge = cartridgeOf(BENCH);
    const written = tables(
      cartridge.prose.entries,
      cartridge.bodies.entries,
      cartridge.table.entries,
    );
    const read = readTable(writeTable(written));
    expect(read.prose).toEqual(written.prose);
    expect(read.bodies).toEqual(written.bodies);
    expect(read.rest).toEqual(written.rest);
  });

  it('refuses a reference past the entries when written', () => {
    expect(() => writeTable(tables([], [], [{ a: [[3]] }]))).toThrow('entry 3');
  });

  it('refuses, in words, bytes that are not a table', () => {
    expect(refusal(() => readTable(new Uint8Array(8)))).toBe('it does not begin with `TBL4`');
    const bytes = writeTable(sample);
    const short = bytes.subarray(0, bytes.length - 16);
    expect(refusal(() => readTable(short))).toBe('it ends before its sections do');
    const counts = Uint8Array.from(bytes);
    new DataView(counts.buffer).setUint32(4 + 1 * 4, 1, true); // one entry, but the runs say six
    expect(refusal(() => readTable(counts))).toBe('its counts do not agree');
    const child = Uint8Array.from(bytes);
    const children = 48 + Math.ceil((word(bytes, 4) * 12) / 8) * 8;
    new DataView(child.buffer).setUint32(children, 9999, true);
    expect(refusal(() => readTable(child))).toBe('it refers to a node it does not hold');
  });
});
