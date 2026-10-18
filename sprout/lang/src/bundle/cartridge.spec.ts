import { describe, expect, it } from 'vitest';

import { BENCH } from '../fixtures/bench.js';
import { compiledWorld } from '../fixtures/bundle.js';
import { gunzip, gzip } from '../source/gzip.js';
import { LANGUAGE_LEVEL, type Bundle } from './bundle.js';
import {
  CARTRIDGE_FORMAT,
  CARTRIDGE_HEADER_BYTES,
  CartridgeUnreadable,
  cartridgeOf,
  emitCartridge,
  readCartridge,
  readCartridgeHeader,
} from './cartridge.js';

/** A single quote, as an import's specifier is written between them. */
const Q = "'";

/** The inflated body: the preamble's text, and the table's bytes. */
const bodyOf = (bytes: Uint8Array): { preamble: string; table: Uint8Array; whole: string } => {
  const header = readCartridgeHeader(bytes);
  const body = gunzip(bytes.subarray(CARTRIDGE_HEADER_BYTES, header.assetsAt));
  return {
    preamble: new TextDecoder().decode(body.subarray(0, header.tableAt)).replace(/\0+$/, ''),
    table: body.subarray(header.tableAt),
    whole: new TextDecoder('latin1').decode(body),
  };
};

/** A cartridge whose body is `preamble` then `table`, with the header saying so. */
const cartridgeWith = (level: number, preamble: string, table: Uint8Array): Uint8Array => {
  const text = new TextEncoder().encode(preamble);
  const tableAt = (text.length + 7) & ~7;
  const body = new Uint8Array(tableAt + table.length);
  body.set(text);
  body.set(table, tableAt);
  const compressed = gzip(body);
  const out = new Uint8Array(CARTRIDGE_HEADER_BYTES + compressed.length);
  out.set(new TextEncoder().encode('SPRT'));
  const view = new DataView(out.buffer);
  view.setUint16(4, CARTRIDGE_FORMAT, true);
  view.setUint16(6, level, true);
  view.setUint32(8, body.length, true);
  view.setUint32(12, tableAt, true);
  view.setUint32(16, out.length, true);
  out.set(compressed, CARTRIDGE_HEADER_BYTES);
  return out;
};

/** `bytes` with the format and level the header says replaced. */
function withHeader(bytes: Uint8Array, format: number, level: number): Uint8Array {
  const out = Uint8Array.from(bytes);
  const view = new DataView(out.buffer);
  view.setUint16(4, format, true);
  view.setUint16(6, level, true);
  return out;
}

const refusal = (run: () => unknown): string => {
  try {
    run();
  } catch (thrown) {
    expect(thrown).toBeInstanceOf(CartridgeUnreadable);
    return (thrown as Error).message;
  }
  throw new Error('was not refused');
};

describe('the header of a cartridge', () => {
  const bytes = emitCartridge(BENCH);

  it('is twenty-four bytes: SPRT, the format, the language level, the body size, where the table begins and where the assets are', () => {
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('SPRT');
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    expect(view.getUint16(4, true)).toBe(CARTRIDGE_FORMAT);
    expect(view.getUint16(6, true)).toBe(BENCH.level);
    const header = readCartridgeHeader(bytes);
    expect(header).toMatchObject({ format: CARTRIDGE_FORMAT, level: BENCH.level });
    const body = gunzip(bytes.subarray(CARTRIDGE_HEADER_BYTES, header.assetsAt));
    expect(header.bodyBytes).toBe(body.length);
    // A world that names no file has an empty assets section, at the file's end.
    expect([header.assetsAt, header.assetsBytes]).toEqual([bytes.length, 0]);
    expect(header.tableAt % 8).toBe(0);
    expect(header.tableAt).toBeLessThan(body.length);
    expect(new TextDecoder().decode(body.subarray(header.tableAt, header.tableAt + 4))).toBe(
      'TBL4',
    );
    // Gzip's own magic follows.
    expect([...bytes.subarray(24, 26)]).toEqual([0x1f, 0x8b]);
  });

  it('refuses a file that is not the size its header says, a byte short or a byte long', () => {
    const said = 'This cartridge cannot be read: it is not the size its header says.';
    expect(refusal(() => readCartridge(bytes.subarray(0, bytes.length - 1)))).toBe(said);
    const longer = new Uint8Array(bytes.length + 1);
    longer.set(bytes);
    expect(refusal(() => readCartridge(longer))).toBe(said);
  });

  it('refuses a newer format, naming both numbers', () => {
    const message = refusal(() =>
      readCartridge(withHeader(bytes, CARTRIDGE_FORMAT + 1, BENCH.level)),
    );
    expect(message).toContain(`format version ${CARTRIDGE_FORMAT + 1}`);
    expect(message).toContain(`up to version ${CARTRIDGE_FORMAT}`);
  });

  it('refuses a newer language level, naming both numbers', () => {
    const message = refusal(() =>
      readCartridge(withHeader(bytes, CARTRIDGE_FORMAT, LANGUAGE_LEVEL + 1)),
    );
    expect(message).toContain(`language level ${LANGUAGE_LEVEL + 1}`);
    expect(message).toContain(`up to level ${LANGUAGE_LEVEL}`);
  });

  it('refuses an older format, since only the current layout is read', () => {
    const message = refusal(() =>
      readCartridge(withHeader(bytes, CARTRIDGE_FORMAT - 1, BENCH.level)),
    );
    expect(message).toBe(
      `This cartridge is format version ${CARTRIDGE_FORMAT - 1}, and this runtime reads version ${CARTRIDGE_FORMAT}. Pack the world again with \`sprout pack\`.`,
    );
  });

  it('refuses a format of 0, a file that is not a cartridge, and one too short to be', () => {
    expect(refusal(() => readCartridge(withHeader(bytes, 0, BENCH.level)))).toContain('damaged');
    expect(
      refusal(() => readCartridge(new TextEncoder().encode('sprout.json, a folder'))),
    ).toContain('does not begin with `SPRT`');
    expect(refusal(() => readCartridge(bytes.subarray(0, 9)))).toContain('not a Sprout cartridge');
  });
});

describe('the sections of a cartridge', () => {
  const cartridge = cartridgeOf(BENCH);

  it('are all present for a bench world, each holding something', () => {
    expect(Object.keys(cartridge)).toEqual([
      'header',
      'caps',
      'extensions',
      'kinds',
      'tree',
      'verbs',
      'grammar',
      'messages',
      'prose',
      'bodies',
      'table',
    ]);
    expect(cartridge.header).toMatchObject({
      name: BENCH.manifest.name,
      version: BENCH.manifest.version,
      author: BENCH.manifest.author,
      license: BENCH.manifest.license,
      level: BENCH.level,
      hash: BENCH.hash,
    });
    expect(cartridge.grammar.words.length).toBeGreaterThan(0);
    expect(cartridge.grammar.words).toEqual([...BENCH.words]);
    expect(cartridge.tree.world).toBe(BENCH.tree.world);
    expect(cartridge.prose.entries.length).toBeGreaterThan(0);
    expect(cartridge.bodies.entries.length).toBeGreaterThan(0);
    expect(cartridge.table.entries.length).toBeGreaterThan(0);
    expect(cartridge.caps).toEqual(BENCH.caps);
  });

  it('read back as they were written, the schema holding the emitter and the reader to one shape', () => {
    expect(readCartridge(emitCartridge(BENCH))).toEqual(JSON.parse(JSON.stringify(cartridge)));
  });

  it('are the same bytes every time the same bundle is emitted', () => {
    expect(emitCartridge(BENCH)).toEqual(emitCartridge(BENCH));
  });

  it('hold no source text, and no diagnostics', () => {
    const { whole } = bodyOf(emitCartridge(BENCH));
    expect(whole).not.toContain('world bench is sprout.World');
    expect(whole).not.toContain('import * as sprout');
    expect(whole).not.toContain('diagnostics');
  });

  it('keep a span only as a file, a line and a column, on nodes that can fault', () => {
    const read = readCartridge(emitCartridge(BENCH));
    expect(JSON.stringify(read.bodies.entries)).toContain('{"p":[0,');
    expect(JSON.stringify(read.bodies.entries)).toContain('{"p":[-1,0,0]}');
    expect(cartridge.table.files).toContain('bench.sprout');
  });

  it('hold the entries in the table and everything else in the preamble', () => {
    const { preamble } = bodyOf(emitCartridge(BENCH));
    const json = JSON.parse(preamble);
    expect(Object.keys(json)).not.toContain('prose');
    expect(json.bodies.entries).toBeUndefined();
    expect(json.table.entries).toBeUndefined();
    expect(json.table.files).toContain('bench.sprout');
  });
});

describe('a cartridge’s grammar', () => {
  const files = {
    'hut.sprout': [
      `import * as sprout from ${Q}sprout${Q}`,
      `import {open} from ${Q}sprout${Q}`,
      'world hut is sprout.World {',
      '  visitors are Person',
      '  visitors arrive at room',
      '  synonyms open: "jimmy"',
      '  object room is sprout.Place {',
      '    object chest is sprout.Container { :open false  synonyms open: "force" }',
      '    object bell is Bell',
      '  }',
      '}',
      'verb ring { role target: Bell  "ring [target]"  synonyms "toll" }',
      'kind Bell { }',
      'kind Person is sprout.Visitor { }',
    ].join('\n'),
  };

  it('holds phrase templates, with every synonym already given as the phrases it makes, and no synonym words', () => {
    const hut = compiledWorld('hut', files);
    const entries = JSON.stringify(readCartridge(emitCartridge(hut)).table.entries);
    expect(entries).toContain('toll');
    expect(entries).toContain('jimmy');
    expect(entries).toContain('force');
    expect(entries).not.toContain('"synonyms":');
    expect(entries).not.toContain('"words":"jimmy"');
  });
});

describe('a cartridge of a bundle with gaps', () => {
  it('is refused, since a cartridge holds a world whole', () => {
    const gapped = { ...BENCH, absent: [{ kind: 'file', name: 'x.sprout' }] } as unknown as Bundle;
    expect(() => emitCartridge(gapped)).toThrow(/gap\(s\) in what it needs/);
  });
});

describe('a cartridge damaged after the header', () => {
  const whole = emitCartridge(BENCH);
  const header = whole.subarray(0, CARTRIDGE_HEADER_BYTES);
  const withBody = (body: Uint8Array): Uint8Array => Uint8Array.from([...header, ...body]);
  const { preamble, table } = bodyOf(whole);

  it('is refused when its body is not gzip', () => {
    expect(refusal(() => readCartridge(withBody(new TextEncoder().encode('plain'))))).toContain(
      'cannot be read',
    );
  });

  it('is refused when its body is not the size its header says', () => {
    expect(refusal(() => readCartridge(withBody(gzip(new TextEncoder().encode('{}')))))).toContain(
      'not the size its header says',
    );
  });

  it('is refused when its preamble is not JSON', () => {
    expect(refusal(() => readCartridge(cartridgeWith(BENCH.level, '{nope', table)))).toContain(
      'preamble is not JSON',
    );
  });

  it('is refused, naming where, when its preamble is not shaped as a cartridge is', () => {
    const json = JSON.parse(preamble);
    json.header.name = 7;
    const message = refusal(() =>
      readCartridge(cartridgeWith(BENCH.level, JSON.stringify(json), table)),
    );
    expect(message).toContain('`header.name`');
  });

  it('is refused, in words, when its table is not one', () => {
    const message = refusal(() =>
      readCartridge(cartridgeWith(BENCH.level, preamble, new Uint8Array(16))),
    );
    expect(message).toBe(
      'This cartridge is not shaped as a cartridge is at `table`: it does not begin with `TBL4`.',
    );
  });
});
