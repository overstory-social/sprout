import { describe, expect, it } from 'vitest';

import { SourceFile, type Span } from '../source/source.js';
import type { Entry } from './cartridge-graph.js';
import { readGraph, writeGraph } from './cartridge-graph.js';
import { NAME_FIELDS, namesWritten, restoreNames } from './cartridge-names.js';

const file = new SourceFile('hut.sprout', 'move lamp -> kiln.shelf\n');
const at = (start: number): Span => ({ source: file, start, end: start + 1 });
const ident = (text: string, start = 0) => ({ kind: 'ident', text, at: at(start) });
const path = (...parts: string[]) => ({
  kind: 'path',
  parts: parts.map((p) => ident(p)),
  at: at(0),
});

/** Writes `roots` as a cartridge writes names, `bound` being what the name table binds, and reads it back. */
function roundTrip(roots: Record<string, unknown>, bound: object[] = []) {
  const names = namesWritten(new Set(bound));
  const { roots: cells, tables } = writeGraph(roots, names.rewrite);
  const entries: Entry[] = [...tables.prose, ...tables.bodies, ...tables.rest];
  const graph = readGraph(tables, restoreNames);
  return { cells, entries, read: (name: string) => graph.read(cells[name]!) };
}

describe('the names a cartridge writes', () => {
  it('writes an identifier as its text and a path as its steps joined by dots', () => {
    const move = {
      kind: 'move',
      thing: path('lamp'),
      destination: path('kiln', 'shelf'),
      at: at(0),
    };
    const { entries } = roundTrip({ move });
    expect(entries).toEqual([
      { o: { kind: 'move', thing: 'lamp', destination: 'kiln.shelf', at: { p: [0, 1, 1] } } },
    ]);
  });

  it('keeps a name the name table binds as an entry with no place, and a bound path of one step as that step', () => {
    const lone = ident('lamp');
    const dotted = path('kiln', 'shelf');
    const one = { kind: 'path', parts: [lone], at: at(0) };
    const move = { kind: 'move', thing: one, destination: dotted, at: at(0) };
    const names = namesWritten(new Set<object>([lone, dotted]));
    const { roots, tables } = writeGraph(
      {
        move,
        table: new Map([
          [lone, 1],
          [names.key(dotted), 2],
        ]),
      },
      names.rewrite,
    );
    const entries = [...tables.prose, ...tables.bodies, ...tables.rest];
    const written = entries.flatMap((entry) => ('o' in entry ? [entry.o] : []));
    expect(written).toContainEqual({ kind: 'ident', text: 'lamp' });
    expect(written).toContainEqual({ kind: 'path', text: 'kiln.shelf' });
    // The table's keys are the very entries the move writes.
    const moveEntry = written.find((o) => o['kind'] === 'move')!;
    const table = entries[(roots['table'] as [number])[0]]!;
    expect('m' in table && table.m.map(([key]) => key)).toEqual([
      moveEntry['thing'],
      moveEntry['destination'],
    ]);
  });

  it('writes a list of names, a null among them, as a list of texts', () => {
    const handler = {
      kind: 'handler',
      message: ident('tick'),
      parameters: [ident('who'), null],
      at: at(0),
    };
    const { entries } = roundTrip({ handler });
    expect(entries).toContainEqual({ a: ['who', null] });
    expect(entries).toContainEqual({ o: expect.objectContaining({ message: 'tick' }) as unknown });
  });

  it('writes words in a name field that holds words, and refuses a string where a name belongs', () => {
    const literal = { kind: 'prose-literal', value: 'Hello.', at: at(0) };
    const { entries } = roundTrip({ say: { kind: 'say', said: literal, at: at(0) } });
    expect(entries).toContainEqual({
      o: expect.objectContaining({ kind: 'prose-literal' }) as unknown,
    });
    expect(() => roundTrip({ say: { kind: 'say', said: 'hello', at: at(0) } })).toThrow(
      'a cartridge writes say.said as a name, and it holds a string',
    );
  });

  it('refuses a name in a field it does not list, which a reader could not give back', () => {
    expect(() => roundTrip({ odd: { kind: 'odd', name: ident('x') } })).toThrow(
      'a cartridge holds no name at odd.name',
    );
  });

  it('reads back as the compiler built it: identifiers and paths with their text, at no place', () => {
    const lone = ident('lamp');
    const dotted = path('kiln', 'shelf');
    const handler = {
      kind: 'handler',
      message: ident('tick'),
      parameters: [ident('who'), null],
      at: at(0),
    };
    const move = {
      kind: 'move',
      thing: { kind: 'path', parts: [lone], at: at(0) },
      destination: dotted,
      at: at(0),
    };
    const names = namesWritten(new Set<object>([lone, dotted]));
    const { roots, tables } = writeGraph(
      {
        handler,
        move,
        table: new Map([
          [lone, 1],
          [names.key(dotted), 2],
        ]),
      },
      names.rewrite,
    );
    const graph = readGraph(tables, restoreNames);
    const readMove = graph.read(roots['move']!) as {
      thing: { kind: string; parts: { text: string }[] };
      destination: { kind: string; parts: { text: string; at: Span }[]; at: Span };
    };
    expect(readMove.thing.kind).toBe('path');
    expect(readMove.thing.parts.map((part) => part.text)).toEqual(['lamp']);
    expect(readMove.destination.kind).toBe('path');
    expect(readMove.destination.parts.map((part) => part.text)).toEqual(['kiln', 'shelf']);
    expect(readMove.destination.at.source.name).toBe('');
    expect(readMove.destination).not.toHaveProperty('text');
    // The name table still finds what the move writes.
    const table = graph.read(roots['table']!) as Map<object, number>;
    expect([...table.keys()]).toEqual([readMove.thing.parts[0], readMove.destination]);
    const readHandler = graph.read(roots['handler']!) as {
      message: { kind: string; text: string };
      parameters: ({ kind: string; text: string } | null)[];
    };
    expect(readHandler.message).toMatchObject({ kind: 'ident', text: 'tick' });
    expect(readHandler.parameters.map((one) => one?.text ?? null)).toEqual(['who', null]);
  });

  it('lists only fields of node kinds, each one name, path or list of names', () => {
    for (const fields of Object.values(NAME_FIELDS)) {
      for (const field of Object.values(fields)) expect(['name', 'path', 'names']).toContain(field);
    }
  });
});
