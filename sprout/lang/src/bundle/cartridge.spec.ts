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

const bodyText = (bytes: Uint8Array): string =>
  new TextDecoder().decode(gunzip(bytes.subarray(CARTRIDGE_HEADER_BYTES)));

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

  it('is sixteen bytes: SPRT, the format, the language level, and eight zeros', () => {
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('SPRT');
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    expect(view.getUint16(4, true)).toBe(CARTRIDGE_FORMAT);
    expect(view.getUint16(6, true)).toBe(BENCH.level);
    expect([...bytes.subarray(8, 16)]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(readCartridgeHeader(bytes)).toEqual({ format: 1, level: BENCH.level });
    // Gzip's own magic follows.
    expect([...bytes.subarray(16, 18)]).toEqual([0x1f, 0x8b]);
  });

  it('refuses a newer format, naming both numbers', () => {
    const message = refusal(() =>
      readCartridge(withHeader(bytes, CARTRIDGE_FORMAT + 1, BENCH.level)),
    );
    expect(message).toContain(`format version ${CARTRIDGE_FORMAT + 1}`);
    expect(message).toContain(`up to version ${CARTRIDGE_FORMAT}`);
  });

  it('refuses a newer language level, naming both numbers', () => {
    const message = refusal(() => readCartridge(withHeader(bytes, 1, LANGUAGE_LEVEL + 1)));
    expect(message).toContain(`language level ${LANGUAGE_LEVEL + 1}`);
    expect(message).toContain(`up to level ${LANGUAGE_LEVEL}`);
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
      'kinds',
      'tree',
      'verbs',
      'grammar',
      'messages',
      'prose',
      'bodies',
      'table',
      'caps',
      'extensions',
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
    const text = bodyText(emitCartridge(BENCH));
    expect(text).not.toContain('world bench is sprout.World');
    expect(text).not.toContain('import * as sprout');
    expect(text).not.toContain('diagnostics');
  });

  it('keep a span only as a file, a line and a column, on nodes that can fault', () => {
    const text = bodyText(emitCartridge(BENCH));
    expect(text).toContain('{"p":[0,');
    expect(cartridge.table.files).toContain('bench.sprout');
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
    const text = bodyText(emitCartridge(hut));
    expect(text).toContain('toll');
    expect(text).toContain('jimmy');
    expect(text).toContain('force');
    expect(text).not.toContain('"synonyms":');
    expect(text).not.toContain('"words":"jimmy"');
  });
});

describe('a cartridge of a bundle with gaps', () => {
  it('is refused, since a cartridge holds a world whole', () => {
    const gapped = { ...BENCH, absent: [{ kind: 'file', name: 'x.sprout' }] } as unknown as Bundle;
    expect(() => emitCartridge(gapped)).toThrow(/gap\(s\) in what it needs/);
  });
});

describe('a cartridge damaged after the header', () => {
  const header = emitCartridge(BENCH).subarray(0, CARTRIDGE_HEADER_BYTES);
  const withBody = (body: Uint8Array): Uint8Array => Uint8Array.from([...header, ...body]);

  it('is refused when its body is not gzip', () => {
    expect(refusal(() => readCartridge(withBody(new TextEncoder().encode('plain'))))).toContain(
      'cannot be read',
    );
  });

  it('is refused when its body is not JSON', () => {
    expect(
      refusal(() => readCartridge(withBody(gzip(new TextEncoder().encode('{nope'))))),
    ).toContain('not JSON');
  });

  it('is refused, naming where, when its JSON is not shaped as a cartridge is', () => {
    const json = JSON.parse(bodyText(emitCartridge(BENCH)));
    json.header.name = 7;
    const message = refusal(() =>
      readCartridge(withBody(gzip(new TextEncoder().encode(JSON.stringify(json))))),
    );
    expect(message).toContain('`header.name`');
  });
});
