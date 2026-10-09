import { describe, expect, it } from 'vitest';

import { SourceFile } from '../source/source.js';
import { readGraph, writeGraph, type Rewrite } from './cartridge-graph.js';

/** `roots` written, then read back from what JSON carries. */
function roundTrip(roots: Record<string, unknown>, rewrite?: Rewrite) {
  const { roots: cells, tables } = writeGraph(roots, rewrite);
  const sent = JSON.parse(JSON.stringify({ cells, tables })) as {
    cells: typeof cells;
    tables: typeof tables;
  };
  const graph = readGraph(sent.tables);
  return { read: (name: string) => graph.read(sent.cells[name]!), tables: sent.tables };
}

describe('the graph a cartridge holds', () => {
  it('reads scalars, arrays, maps, sets and objects back as they were', () => {
    const { read } = roundTrip({
      a: { n: 1, s: 'two', b: true, none: null, list: [1, [2]] },
      m: new Map([['k', new Set(['x', 'y'])]]),
    });
    expect(read('a')).toEqual({ n: 1, s: 'two', b: true, none: null, list: [1, [2]] });
    expect(read('m')).toEqual(new Map([['k', new Set(['x', 'y'])]]));
  });

  it('keeps what two parts share as one object, and a cycle as a cycle', () => {
    const shared = { name: 'shared' };
    const loop: { self?: unknown; shared: unknown } = { shared };
    loop.self = loop;
    const { read } = roundTrip({ one: [shared, loop], two: { shared } });
    const one = read('one') as [unknown, { self: unknown; shared: unknown }];
    expect(one[1].shared).toBe(one[0]);
    expect(one[1].self).toBe(one[1]);
    expect((read('two') as { shared: unknown }).shared).toBe(one[0]);
  });

  it('keeps an object once in its table, however many parts refer to it', () => {
    const shared = { name: 'shared' };
    const { tables } = roundTrip({ a: [shared, shared, shared] });
    expect(tables.rest.filter((entry) => 'o' in entry)).toHaveLength(1);
  });

  it('sorts nodes into runs by the kind they carry: prose, then bodies, then the rest', () => {
    const { tables } = roundTrip({
      all: [
        { kind: 'prose-words', text: 'a' },
        { kind: 'binary' },
        { kind: 'kind-decl' },
        { x: 1 },
      ],
    });
    expect(tables.prose).toHaveLength(1);
    expect(tables.bodies).toHaveLength(1);
    expect(tables.rest).toHaveLength(3);
  });

  it('keeps a span as its file, line and column on a statement, and none on an expression', () => {
    const file = new SourceFile('hut.sprout', 'one\ntwo three\n');
    const at = { source: file, start: 8, end: 13 };
    const { read, tables } = roundTrip({
      statement: { kind: 'say', at },
      expression: { kind: 'integer', at, value: 3 },
    });
    expect(tables.files).toEqual(['hut.sprout']);
    const statement = read('statement') as { at: { source: SourceFile; start: number } };
    expect(statement.at.source.name).toBe('hut.sprout');
    expect(statement.at.source.positionAt(statement.at.start)).toEqual({ line: 2, column: 5 });
    const expression = read('expression') as { at: { source: SourceFile } };
    expect(expression.at.source.name).toBe('');
    expect(expression.at.source.text).toBe(' ');
  });

  it('leaves out the host’s code in an extension’s value type, for the host to give back', () => {
    const { read } = roundTrip({ type: { type: 'extension', name: 'dice', definition: () => 1 } });
    expect(read('type')).toEqual({ type: 'extension', name: 'dice' });
  });

  it('writes a field as the rewrite gives it, and leaves it out when it gives nothing', () => {
    const { read } = roundTrip({ x: { keep: 1, drop: 2, swap: 3 } }, (_owner, key, value) =>
      key === 'drop' ? undefined : key === 'swap' ? 30 : value,
    );
    expect(read('x')).toEqual({ keep: 1, swap: 30 });
  });

  it('refuses what JSON cannot carry, saying where', () => {
    expect(() => writeGraph({ bad: { n: Number.NaN } })).toThrow(/cannot hold NaN/);
    expect(() => writeGraph({ bad: { f: 1n } })).toThrow(/cannot hold a bigint/);
    expect(() => writeGraph({ bad: [new Date(0)] })).toThrow(/cannot hold Date at bad/);
  });

  it('refuses a table that refers to an entry or a file it does not hold', () => {
    expect(() => readGraph({ files: [], prose: [], bodies: [], rest: [{ a: [[5]] }] })).toThrow(
      /entry it does not hold/,
    );
    expect(() => readGraph({ files: [], prose: [], bodies: [], rest: [] }).read([3])).toThrow(
      /entry it does not hold/,
    );
    expect(() =>
      readGraph({ files: [], prose: [], bodies: [], rest: [{ a: [{ p: [0, 1, 1] }] }] }),
    ).toThrow(/file it does not list/);
  });

  it('tells the reader of each object once it has its fields', () => {
    const { roots, tables } = writeGraph({ x: { type: 'extension', name: 'dice' } });
    const told: unknown[] = [];
    readGraph(tables, (object) => told.push({ ...object }));
    expect(roots['x']).toEqual([0]);
    expect(told).toEqual([{ type: 'extension', name: 'dice' }]);
  });
});
