// How a cartridge holds what the compiler built (the spec's The compiler ›
// What compiling produces): a graph of plain objects, arrays, maps and
// sets, written as a flat table of entries that refer to one another by
// index, so that a thing two parts of the world share is one entry and
// reads back as one object. Every name a body writes is bound to what it
// names this way: the name table is a map from the node written to the
// thing it reached, both entries in the table.
//
// The table is three runs laid end to end under one numbering: the prose
// nodes, the statements and expressions, and everything else. A span
// survives as its file, line and column on every node but an expression,
// which never faults on its own; it reads back as a place in a file that
// holds no text, which is all a fault is told.

import { SourceFile, type Span } from '../source/source.js';
import type { Expr, Statement } from '../syntax/ast.js';
import type { Prose, ProseLiteral, ProsePiece } from '../syntax/ast-prose.js';

/** A reference to an entry of the table, by its index. */
export type Ref = readonly [number];

/** A span as it travels: an index into the files, a line and a column; file -1 is a place that was not kept. */
export interface Place {
  readonly p: readonly [number, number, number];
}

/** What a field, an element or a root is: JSON's scalars, a reference or a place. */
export type Cell = null | boolean | number | string | Ref | Place;

/** One object of the graph. */
export type Entry =
  | { readonly o: { readonly [key: string]: Cell } }
  | { readonly a: readonly Cell[] }
  | { readonly m: readonly (readonly [Cell, Cell])[] }
  | { readonly s: readonly Cell[] };

/** The table: the files spans name, and the three runs of entries. */
export interface GraphTables {
  readonly files: readonly string[];
  readonly prose: readonly Entry[];
  readonly bodies: readonly Entry[];
  readonly rest: readonly Entry[];
}

type ProseKind = Prose['kind'] | ProseLiteral['kind'] | ProsePiece['kind'];
const PROSE_KINDS: Record<ProseKind, true> = {
  'prose-words': true,
  'prose-paragraph': true,
  'prose-newline': true,
  'prose-slot': true,
  'prose-if': true,
  'prose-for': true,
  'prose-one-of': true,
  prose: true,
  'prose-literal': true,
};

const EXPRESSION_KINDS: Record<Expr['kind'], true> = {
  boolean: true,
  integer: true,
  string: true,
  binding: true,
  'symbol-expr': true,
  'kind-expr': true,
  unary: true,
  binary: true,
  member: true,
  call: true,
  'free-call': true,
  bound: true,
};

const STATEMENT_KINDS: Record<Statement['kind'] | 'block', true> = {
  block: true,
  let: true,
  spawn: true,
  destroy: true,
  move: true,
  connect: true,
  act: true,
  send: true,
  broadcast: true,
  wake: true,
  'cancel-wakes': true,
  each: true,
  if: true,
  refuse: true,
  allow: true,
  say: true,
  tell: true,
  text: true,
  'expression-statement': true,
  'extension-statement': true,
};

const has = (kinds: Record<string, true>, kind: string): boolean =>
  Object.prototype.hasOwnProperty.call(kinds, kind);

type Run = 'prose' | 'bodies' | 'rest';

/** Which run of the table an object belongs in: by the node kind it carries, if it carries one. */
function runOf(value: object): Run {
  const kind = (value as { kind?: unknown }).kind;
  if (typeof kind !== 'string') return 'rest';
  if (has(PROSE_KINDS, kind)) return 'prose';
  if (has(EXPRESSION_KINDS, kind) || has(STATEMENT_KINDS, kind)) return 'bodies';
  return 'rest';
}

function isSpan(value: unknown): value is Span {
  return (
    value !== null &&
    typeof value === 'object' &&
    (value as { source?: unknown }).source instanceof SourceFile
  );
}

/** What kind of object a value is in the graph, or why it cannot be one. */
type Shape = 'object' | 'array' | 'map' | 'set';

function shapeOf(value: object, where: string): Shape {
  if (Array.isArray(value)) return 'array';
  if (value instanceof Map) return 'map';
  if (value instanceof Set) return 'set';
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto === Object.prototype || proto === null) return 'object';
  const name = (value as { constructor?: { name?: unknown } }).constructor?.name;
  throw new Error(
    `a cartridge cannot hold ${typeof name === 'string' ? name : 'an object'} ${where}`,
  );
}

/**
 * Whether a field is the host's code rather than the world's data: the
 * definition an extension's value type carries. It does not travel; the
 * host that plays the cartridge supplies its own for the extension's name.
 */
function isHostCode(owner: object, key: string): boolean {
  return key === 'definition' && (owner as { type?: unknown }).type === 'extension';
}

/** What the writer makes of a field before it is written: the value to write in its place, or undefined to leave it out. */
export type Rewrite = (owner: object, key: string, value: unknown) => unknown;

/** The fields of `owner` that travel, as written: those the host's code or `rewrite` leave out do not appear. */
function fieldsOf(owner: object, rewrite: Rewrite): [string, unknown][] {
  const fields: [string, unknown][] = [];
  for (const [key, value] of Object.entries(owner)) {
    if (value === undefined || isHostCode(owner, key)) continue;
    const written = rewrite(owner, key, value);
    if (written !== undefined) fields.push([key, written]);
  }
  return fields;
}

/** The children of `value`, as the writer follows them, in a fixed order. */
function childrenOf(value: object, shape: Shape, rewrite: Rewrite): unknown[] {
  switch (shape) {
    case 'array':
      return [...(value as unknown[])];
    case 'set':
      return [...(value as Set<unknown>)];
    case 'map':
      return [...(value as Map<unknown, unknown>)].flat();
    case 'object':
      return fieldsOf(value, rewrite).map(([, child]) => child);
  }
}

/** Write `roots` as tables, and each root as the cell that reaches it. */
export function writeGraph(
  roots: Readonly<Record<string, unknown>>,
  rewrite: Rewrite = (_owner, _key, value) => value,
): {
  readonly roots: Readonly<Record<string, Cell>>;
  readonly tables: GraphTables;
} {
  const runs: Record<Run, object[]> = { prose: [], bodies: [], rest: [] };
  const local = new Map<object, number>();
  const shapes = new Map<object, Shape>();
  const files: string[] = [];
  const fileIndex = new Map<string, number>();

  // Walk the graph once, giving each object its place in its run. The walk
  // keeps its own stack, so how deep a body nests is not how deep it recurses.
  const pending: [unknown, string][] = Object.entries(roots).map(([name, value]) => [value, name]);
  while (pending.length > 0) {
    const [value, where] = pending.pop()!;
    if (value === null || typeof value !== 'object' || isSpan(value) || local.has(value)) continue;
    const shape = shapeOf(value, `at ${where}`);
    const run = runOf(value);
    local.set(value, runs[run].length);
    runs[run].push(value);
    shapes.set(value, shape);
    const kind = (value as { kind?: unknown }).kind;
    const here = typeof kind === 'string' ? `${where} (${kind})` : where;
    for (const child of childrenOf(value, shape, rewrite).reverse()) pending.push([child, here]);
  }

  const base = {
    prose: 0,
    bodies: runs.prose.length,
    rest: runs.prose.length + runs.bodies.length,
  };
  const refOf = (value: object): Ref => [base[runOf(value)] + local.get(value)!];

  const place = (span: Span, kept: boolean): Place => {
    if (!kept) return { p: [-1, 0, 0] };
    const name = span.source.name;
    let file = fileIndex.get(name);
    if (file === undefined) {
      file = files.length;
      files.push(name);
      fileIndex.set(name, file);
    }
    const { line, column } = span.source.positionAt(span.start);
    return { p: [file, line, column] };
  };

  const cellOf = (value: unknown, owner: object | null, key: string): Cell => {
    if (value === null) return null;
    switch (typeof value) {
      case 'boolean':
      case 'string':
        return value;
      case 'number':
        if (!Number.isFinite(value)) throw new Error(`a cartridge cannot hold ${value}`);
        return value;
      case 'object': {
        if (isSpan(value)) {
          const kind = (owner as { kind?: unknown } | null)?.kind;
          return place(value, !(typeof kind === 'string' && has(EXPRESSION_KINDS, kind)));
        }
        return refOf(value);
      }
      default:
        throw new Error(`a cartridge cannot hold a ${typeof value} (${key})`);
    }
  };

  const entryOf = (value: object): Entry => {
    switch (shapes.get(value)!) {
      case 'array':
        return { a: (value as unknown[]).map((one) => cellOf(one, value, 'element')) };
      case 'set':
        return { s: [...(value as Set<unknown>)].map((one) => cellOf(one, value, 'member')) };
      case 'map':
        return {
          m: [...(value as Map<unknown, unknown>)].map(
            ([key, one]) => [cellOf(key, value, 'key'), cellOf(one, value, 'value')] as const,
          ),
        };
      case 'object': {
        const fields: Record<string, Cell> = {};
        for (const [key, one] of fieldsOf(value, rewrite)) fields[key] = cellOf(one, value, key);
        return { o: fields };
      }
    }
  };

  const tables = {
    prose: runs.prose.map(entryOf),
    bodies: runs.bodies.map(entryOf),
    rest: runs.rest.map(entryOf),
  };
  const cells: Record<string, Cell> = {};
  for (const [name, value] of Object.entries(roots)) cells[name] = cellOf(value, null, name);
  return { roots: cells, tables: { files, ...tables } };
}

// --- reading -----------------------------------------------------------------

/**
 * A file as a fault names it: its name, and the places in it that spans
 * kept, each a line and column. A span into it is an index into those, so
 * it reports where it was written and holds no text.
 */
export class PlacedFile extends SourceFile {
  constructor(
    name: string,
    private readonly places: readonly (readonly [number, number])[],
  ) {
    super(name, ' '.repeat(places.length));
  }

  override positionAt(offset: number): { line: number; column: number } {
    const [line, column] = this.places[offset] ?? [1, 1];
    return { line, column };
  }
}

function isPlace(cell: Cell): cell is Place {
  return cell !== null && typeof cell === 'object' && !Array.isArray(cell);
}

function isRef(cell: Cell): cell is Ref {
  return Array.isArray(cell);
}

/** The graph a cartridge's tables hold, read back: each cell gives the object it stands for. */
export interface Graph {
  read(cell: Cell): unknown;
}

/** Read `tables` back into objects, a reference to one entry being one object wherever it is read. */
export function readGraph(
  tables: GraphTables,
  /** Told of each plain object once it holds all its fields, so a host can give back what did not travel. */
  onObject?: (object: Record<string, unknown>) => void,
): Graph {
  const entries = [...tables.prose, ...tables.bodies, ...tables.rest];

  // Each file's places are gathered first, so a file knows how many it holds.
  const wanted: Map<string, number>[] = tables.files.map(() => new Map());
  const lists: [number, number][][] = tables.files.map(() => []);
  const note = (cell: Cell): void => {
    if (!isPlace(cell)) return;
    const [file, line, column] = cell.p;
    if (file < 0) return;
    if (file >= tables.files.length) throw new Error('the cartridge names a file it does not list');
    const key = `${line}:${column}`;
    if (!wanted[file]!.has(key)) {
      wanted[file]!.set(key, lists[file]!.length);
      lists[file]!.push([line, column]);
    }
  };
  for (const entry of entries) {
    if ('o' in entry) Object.values(entry.o).forEach(note);
    else if ('a' in entry) entry.a.forEach(note);
    else if ('s' in entry) entry.s.forEach(note);
    else entry.m.forEach(([key, value]) => (note(key), note(value)));
  }
  const files = tables.files.map((name, i) => new PlacedFile(name, lists[i]!));
  const nowhere = new PlacedFile('', [[1, 1]]);

  const shells: object[] = entries.map((entry) => {
    if ('o' in entry) return {};
    if ('a' in entry) return [];
    if ('m' in entry) return new Map();
    return new Set();
  });

  const read = (cell: Cell): unknown => {
    if (isRef(cell)) {
      const shell = shells[cell[0]];
      if (shell === undefined) throw new Error('the cartridge refers to an entry it does not hold');
      return shell;
    }
    if (isPlace(cell)) {
      const [file, line, column] = cell.p;
      if (file < 0) return { source: nowhere, start: 0, end: 0 } satisfies Span;
      const at = wanted[file]!.get(`${line}:${column}`)!;
      return { source: files[file]!, start: at, end: at } satisfies Span;
    }
    return cell;
  };

  entries.forEach((entry, i) => {
    const shell = shells[i]!;
    if ('o' in entry) {
      const target = shell as Record<string, unknown>;
      for (const [key, cell] of Object.entries(entry.o)) target[key] = read(cell);
      onObject?.(target);
    } else if ('a' in entry) (shell as unknown[]).push(...entry.a.map(read));
    else if ('s' in entry) for (const cell of entry.s) (shell as Set<unknown>).add(read(cell));
    else
      for (const [key, cell] of entry.m)
        (shell as Map<unknown, unknown>).set(read(key), read(cell));
  });
  return { read };
}
