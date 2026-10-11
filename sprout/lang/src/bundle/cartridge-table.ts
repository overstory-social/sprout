// The table a cartridge holds its graph in (the spec's The compiler › What
// compiling produces): the entries `writeGraph` numbers, as a block of
// little-endian words a runtime reads in place, with no parse and nothing
// built. A node is twelve bytes; an object's, an array's or a map's children
// are indexes into one pool; a scalar (a string, a number, a place, true,
// false or null) is one node per distinct value, after the entries, so an
// entry's index is its place in the table and a scalar is told from an entry
// by lying past them. Strings are one run of bytes with a NUL after each.
//
// The layout, every count a 32-bit word and every section padded to eight:
//
//   `TBL3`, then node count, entry count, the three runs' counts (prose,
//   bodies, rest), child count, string count, string bytes, double count,
//   place count, shape count, shape field count;
//   nodes: kind (a byte), flags (a byte), shape (16 bits), count, first;
//   children: node indexes;
//   string offsets (one more than the strings, the last the bytes' length),
//   then the bytes;
//   doubles;
//   places: line (32 bits), file (16, signed, -1 for none), column (16);
//   shape offsets (one more than the shapes), then the shapes' fields as
//   string indexes.
//
// An object's `shape` names its fields, `count` is how many and `first` where
// its values begin; an array's or a set's elements, and a map's pairs (key then
// value, `count` pairs), likewise. A string's `first` is its index and `count`
// its length. A number is `first` as a signed 32-bit integer when the INLINE
// flag is set, else `first` indexes the doubles. A place's `first` indexes the
// places. A boolean's TRUE flag is its value.

import type { Cell, Entry, GraphTables } from './cartridge-graph.js';

/** The four bytes the table begins with. */
export const TABLE_MAGIC = 'TBL3';

/** A table that is not what this reads: damaged, or from something that is not this compiler. */
export class TableUnreadable extends Error {
  override readonly name = 'TableUnreadable';
}

const NULL = 0;
const BOOLEAN = 1;
const NUMBER = 2;
const STRING = 3;
const PLACE = 4;
const OBJECT = 5;
const ARRAY = 6;
const MAP = 7;
const SET = 8;

const INLINE = 1; /* a number's `first` is a signed 32-bit integer */
const TRUE = 1; /* a boolean's value */

const NODE_BYTES = 12;
const HEAD_WORDS = 11;
const HEAD_BYTES = 4 + HEAD_WORDS * 4;

const padded = (bytes: number): number => (bytes + 7) & ~7;

/** Whether a number travels inline: a whole number a signed 32-bit word holds. */
const isInline = (value: number): boolean =>
  Number.isInteger(value) && value >= -2147483648 && value <= 2147483647 && !Object.is(value, -0);

// --- writing -----------------------------------------------------------------

interface Interned<T> {
  readonly ids: Map<string, number>;
  readonly values: T[];
}

function interned<T>(): Interned<T> {
  return { ids: new Map(), values: [] };
}

function intern<T>(table: Interned<T>, key: string, value: T): number {
  let id = table.ids.get(key);
  if (id === undefined) {
    id = table.values.length;
    table.ids.set(key, id);
    table.values.push(value);
  }
  return id;
}

interface NodeRecord {
  kind: number;
  flags: number;
  shape: number;
  count: number;
  first: number;
}

/** `tables` as the bytes of a table. */
export function writeTable(tables: GraphTables): Uint8Array {
  const entries: readonly Entry[] = [...tables.prose, ...tables.bodies, ...tables.rest];
  const nodes: NodeRecord[] = entries.map(() => ({
    kind: NULL,
    flags: 0,
    shape: 0,
    count: 0,
    first: 0,
  }));
  const children: number[] = [];
  const strings = interned<string>();
  const doubles: number[] = [];
  const places = interned<readonly [number, number, number]>();
  const shapes = interned<readonly number[]>();
  const scalars = new Map<string, number>();
  const encoder = new TextEncoder();

  const scalar = (key: string, make: () => NodeRecord): number => {
    let at = scalars.get(key);
    if (at === undefined) {
      at = nodes.length;
      scalars.set(key, at);
      nodes.push(make());
    }
    return at;
  };
  const nodeOf = (cell: Cell): number => {
    if (cell === null)
      return scalar('null', () => ({ kind: NULL, flags: 0, shape: 0, count: 0, first: 0 }));
    switch (typeof cell) {
      case 'boolean':
        return scalar(cell ? 'true' : 'false', () => ({
          kind: BOOLEAN,
          flags: cell ? TRUE : 0,
          shape: 0,
          count: 0,
          first: 0,
        }));
      case 'number':
        if (!Number.isFinite(cell)) throw new Error(`a table cannot hold ${cell}`);
        return scalar(`n:${Object.is(cell, -0) ? '-0' : cell}`, () => {
          if (isInline(cell))
            return { kind: NUMBER, flags: INLINE, shape: 0, count: 0, first: cell };
          doubles.push(cell);
          return { kind: NUMBER, flags: 0, shape: 0, count: 0, first: doubles.length - 1 };
        });
      case 'string':
        return scalar(`s:${cell}`, () => ({
          kind: STRING,
          flags: 0,
          shape: 0,
          count: encoder.encode(cell).length,
          first: intern(strings, cell, cell),
        }));
      default: {
        if ('p' in cell) {
          const place = cell.p;
          return scalar(`p:${place.join(':')}`, () => ({
            kind: PLACE,
            flags: 0,
            shape: 0,
            count: 0,
            first: intern(places, place.join(':'), place),
          }));
        }
        const at = cell[0];
        if (!Number.isInteger(at) || at < 0 || at >= entries.length)
          throw new Error(`a table cannot refer to entry ${at}`);
        return at;
      }
    }
  };

  entries.forEach((entry, i) => {
    const node = nodes[i]!;
    node.first = children.length;
    if ('o' in entry) {
      const keys = Object.keys(entry.o);
      const fields = keys.map((key) => intern(strings, key, key));
      node.kind = OBJECT;
      node.shape = intern(shapes, fields.join(','), fields);
      node.count = keys.length;
      for (const key of keys) children.push(nodeOf(entry.o[key]!));
    } else if ('a' in entry || 's' in entry) {
      const items = 'a' in entry ? entry.a : entry.s;
      node.kind = 'a' in entry ? ARRAY : SET;
      node.count = items.length;
      for (const item of items) children.push(nodeOf(item));
    } else {
      node.kind = MAP;
      node.count = entry.m.length;
      for (const [key, value] of entry.m) children.push(nodeOf(key), nodeOf(value));
    }
  });
  if (shapes.values.length > 65535)
    throw new Error('a table cannot hold more than 65,535 shapes of object');

  const stringBytes = strings.values.map((text) => encoder.encode(text));
  const stringTotal = stringBytes.reduce((sum, bytes) => sum + bytes.length + 1, 0);
  const shapeFields = shapes.values.reduce((sum, fields) => sum + fields.length, 0);
  const sizes = [
    padded(nodes.length * NODE_BYTES),
    padded(children.length * 4),
    padded((strings.values.length + 1) * 4),
    padded(stringTotal),
    doubles.length * 8,
    places.values.length * 8,
    padded((shapes.values.length + 1) * 4),
    padded(shapeFields * 4),
  ];
  const out = new Uint8Array(HEAD_BYTES + sizes.reduce((a, b) => a + b, 0));
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode(TABLE_MAGIC));
  const head = [
    nodes.length,
    entries.length,
    tables.prose.length,
    tables.bodies.length,
    tables.rest.length,
    children.length,
    strings.values.length,
    stringTotal,
    doubles.length,
    places.values.length,
    shapes.values.length,
  ];
  head.forEach((word, i) => view.setUint32(4 + i * 4, word, true));
  let at = HEAD_BYTES;
  for (const node of nodes) {
    view.setUint8(at, node.kind);
    view.setUint8(at + 1, node.flags);
    view.setUint16(at + 2, node.shape, true);
    view.setUint32(at + 4, node.count, true);
    if (node.kind === NUMBER && node.flags === INLINE) view.setInt32(at + 8, node.first, true);
    else view.setUint32(at + 8, node.first, true);
    at += NODE_BYTES;
  }
  at = HEAD_BYTES + sizes[0]!;
  children.forEach((child, i) => view.setUint32(at + i * 4, child, true));
  at += sizes[1]!;
  let offset = 0;
  stringBytes.forEach((bytes, i) => {
    view.setUint32(at + i * 4, offset, true);
    offset += bytes.length + 1;
  });
  view.setUint32(at + stringBytes.length * 4, offset, true);
  at += sizes[2]!;
  offset = 0;
  for (const bytes of stringBytes) {
    out.set(bytes, at + offset);
    offset += bytes.length + 1;
  }
  at += sizes[3]!;
  doubles.forEach((value, i) => view.setFloat64(at + i * 8, value, true));
  at += sizes[4]!;
  places.values.forEach(([file, line, column], i) => {
    view.setInt32(at + i * 8, line, true);
    view.setInt16(at + i * 8 + 4, file, true);
    view.setUint16(at + i * 8 + 6, column, true);
  });
  at += sizes[5]!;
  offset = 0;
  shapes.values.forEach((fields, i) => {
    view.setUint32(at + i * 4, offset, true);
    offset += fields.length;
  });
  view.setUint32(at + shapes.values.length * 4, offset, true);
  at += sizes[6]!;
  offset = 0;
  for (const fields of shapes.values) {
    fields.forEach((field, i) => view.setUint32(at + (offset + i) * 4, field, true));
    offset += fields.length;
  }
  return out;
}

// --- reading -----------------------------------------------------------------

/** The sections of a table, located and checked. */
interface Located {
  readonly view: DataView;
  readonly nodes: number;
  readonly entries: number;
  readonly runs: readonly [number, number, number];
  readonly children: number;
  readonly strings: number;
  readonly stringBytes: number;
  readonly doubles: number;
  readonly places: number;
  readonly shapes: number;
  readonly at: {
    readonly nodes: number;
    readonly children: number;
    readonly stringOffsets: number;
    readonly stringBytes: number;
    readonly doubles: number;
    readonly places: number;
    readonly shapeOffsets: number;
    readonly shapeFields: number;
  };
}

const refuse = (why: string): never => {
  throw new TableUnreadable(why);
};

function locate(bytes: Uint8Array): Located {
  if (bytes.length < HEAD_BYTES || new TextDecoder().decode(bytes.subarray(0, 4)) !== TABLE_MAGIC)
    refuse('it does not begin with `TBL3`');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const word = (i: number): number => view.getUint32(4 + i * 4, true);
  const [
    nodes,
    entries,
    prose,
    bodies,
    rest,
    children,
    strings,
    stringBytes,
    doubles,
    places,
    shapes,
  ] = [
    word(0),
    word(1),
    word(2),
    word(3),
    word(4),
    word(5),
    word(6),
    word(7),
    word(8),
    word(9),
    word(10),
  ] as const;
  if (entries > nodes || prose + bodies + rest !== entries) refuse('its counts do not agree');
  if (shapes > 65535) refuse('it holds more shapes than a node names');
  const at = { nodes: HEAD_BYTES } as {
    nodes: number;
    children: number;
    stringOffsets: number;
    stringBytes: number;
    doubles: number;
    places: number;
    shapeOffsets: number;
    shapeFields: number;
  };
  at.children = at.nodes + padded(nodes * NODE_BYTES);
  at.stringOffsets = at.children + padded(children * 4);
  at.stringBytes = at.stringOffsets + padded((strings + 1) * 4);
  at.doubles = at.stringBytes + padded(stringBytes);
  at.places = at.doubles + doubles * 8;
  at.shapeOffsets = at.places + places * 8;
  at.shapeFields = at.shapeOffsets + padded((shapes + 1) * 4);
  if (at.shapeFields > bytes.length) refuse('it ends before its sections do');
  const fieldWords = view.getUint32(at.shapeOffsets + shapes * 4, true);
  if (at.shapeFields + fieldWords * 4 > bytes.length) refuse('it ends before its sections do');
  return {
    view,
    nodes,
    entries,
    runs: [prose, bodies, rest],
    children,
    strings,
    stringBytes,
    doubles,
    places,
    shapes,
    at,
  };
}

/** `bytes`, a table, read back as the tables `writeGraph` makes; refuses, in words, a table that is not one. */
export function readTable(bytes: Uint8Array): GraphTables {
  const t = locate(bytes);
  const { view, at } = t;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const stringAt = (id: number): string => {
    if (id >= t.strings) refuse('it names a string it does not hold');
    const start = view.getUint32(at.stringOffsets + id * 4, true);
    const end = view.getUint32(at.stringOffsets + (id + 1) * 4, true);
    if (end <= start || end > t.stringBytes) refuse('a string lies outside its bytes');
    if (view.getUint8(at.stringBytes + end - 1) !== 0) refuse('a string has no NUL after it');
    try {
      return decoder.decode(bytes.subarray(at.stringBytes + start, at.stringBytes + end - 1));
    } catch {
      return refuse('a string is not UTF-8');
    }
  };
  const strings: string[] = [];
  for (let i = 0; i < t.strings; i++) strings.push(stringAt(i));
  const shapes: string[][] = [];
  for (let i = 0; i < t.shapes; i++) {
    const start = view.getUint32(at.shapeOffsets + i * 4, true);
    const end = view.getUint32(at.shapeOffsets + (i + 1) * 4, true);
    if (end < start) refuse('a shape lies outside its fields');
    const fields: string[] = [];
    for (let f = start; f < end; f++) {
      const id = view.getUint32(at.shapeFields + f * 4, true);
      fields.push(strings[id] ?? refuse('a shape names a string it does not hold'));
    }
    shapes.push(fields);
  }
  const node = (
    i: number,
  ): { kind: number; flags: number; shape: number; count: number; first: number } => {
    const base = at.nodes + i * NODE_BYTES;
    return {
      kind: view.getUint8(base),
      flags: view.getUint8(base + 1),
      shape: view.getUint16(base + 2, true),
      count: view.getUint32(base + 4, true),
      first: view.getUint32(base + 8, true),
    };
  };
  const cellOf = (index: number): Cell => {
    if (index >= t.nodes) return refuse('it refers to a node it does not hold');
    if (index < t.entries) return [index];
    const n = node(index);
    switch (n.kind) {
      case NULL:
        return null;
      case BOOLEAN:
        return (n.flags & TRUE) !== 0;
      case NUMBER:
        if ((n.flags & INLINE) !== 0) return view.getInt32(at.nodes + index * NODE_BYTES + 8, true);
        if (n.first >= t.doubles) refuse('it names a number it does not hold');
        return view.getFloat64(at.doubles + n.first * 8, true);
      case STRING:
        return strings[n.first] ?? refuse('it names a string it does not hold');
      case PLACE: {
        if (n.first >= t.places) refuse('it names a place it does not hold');
        const base = at.places + n.first * 8;
        return {
          p: [
            view.getInt16(base + 4, true),
            view.getInt32(base, true),
            view.getUint16(base + 6, true),
          ],
        };
      }
      default:
        return refuse('a scalar is not a scalar');
    }
  };
  const entries: Entry[] = [];
  for (let i = 0; i < t.entries; i++) {
    const n = node(i);
    const width = n.kind === MAP ? 2 : 1;
    if (n.first + n.count * width > t.children) refuse('an entry reaches past the children');
    const child = (j: number): Cell =>
      cellOf(view.getUint32(at.children + (n.first + j) * 4, true));
    switch (n.kind) {
      case OBJECT: {
        const fields = shapes[n.shape] ?? refuse('an object has a shape it does not hold');
        if (fields.length !== n.count) refuse("an object's shape does not match its count");
        const o: Record<string, Cell> = {};
        fields.forEach((key, j) => (o[key] = child(j)));
        entries.push({ o });
        break;
      }
      case ARRAY:
        entries.push({ a: Array.from({ length: n.count }, (_, j) => child(j)) });
        break;
      case SET:
        entries.push({ s: Array.from({ length: n.count }, (_, j) => child(j)) });
        break;
      case MAP:
        entries.push({
          m: Array.from({ length: n.count }, (_, j) => [child(2 * j), child(2 * j + 1)] as const),
        });
        break;
      default:
        refuse('an entry is not an object, an array, a map or a set');
    }
  }
  const [prose, bodies] = t.runs;
  return {
    files: [],
    prose: entries.slice(0, prose),
    bodies: entries.slice(prose, prose + bodies),
    rest: entries.slice(prose + bodies),
  };
}
