import { describe, expect, it } from 'vitest';

import { emitCartridge, readCartridge } from '../cartridge.js';
import { CartridgeSchema } from '../cartridge-schema.js';
import { limitsFrom } from '../limits.js';
import type { AssetFile } from '../../declare/extensions.js';
import { MEDIA } from '../../declare/media.js';
import { locationOf } from '../../source/source.js';
import { refusals, warnings, world, worldFiles, worldLine } from '../../fixtures/compile.js';
import { compileBundle } from './compile.js';

/** The first bytes of a PNG with the given bit depth and colour type. */
function pngHead(bitDepth: number, colour: number): Uint8Array {
  const head = new Uint8Array(33);
  head.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  head.set([0x49, 0x48, 0x44, 0x52], 12);
  head[24] = bitDepth;
  head[25] = colour;
  return head;
}

const file = (bytes: number, bitDepth = 1, colour = 0): AssetFile => ({
  bytes,
  sha: `sha-of-${bytes}`,
  head: pngHead(bitDepth, colour),
});

/** A world whose lamp shows `statements`, compiled on a host that installs `media` and holds `folder`. */
function compiled(
  statements: string,
  folder: Record<string, AssetFile> | undefined,
  options: { mode?: 'publish' | 'load'; assetBytes?: number | null } = {},
) {
  const files = worldFiles(
    worldLine('object lamp is Lamp'),
    `extension media 1\nkind Lamp {\n  describe {\n    text "A lamp."\n${statements}\n  }\n}`,
  );
  const source = world({ files, manifest: { extensions: [{ name: 'media', major: 1 }] } });
  return compileBundle(
    folder === undefined ? source : { ...source, assets: (path) => folder[path] ?? null },
    {
      extensions: [MEDIA],
      mode: options.mode ?? 'publish',
      ...(options.assetBytes === undefined
        ? {}
        : { limits: limitsFrom({ caps: { assetBytes: options.assetBytes } }) }),
    },
  );
}

const said = (diagnostics: Parameters<typeof refusals>[0]) =>
  diagnostics.map((d) => [locationOf(d.at), d.message, d.remedy]);

describe('the files an extension’s values name', () => {
  it('are each found in the world’s folder once, by path, with their size and hash', () => {
    const { bundle, diagnostics } = compiled(
      '    media.show("b.png")\n    media.show("a.png", "an a")\n    media.show("b.png", "again")',
      { 'a.png': file(10), 'b.png': file(25) },
    );
    expect(diagnostics).toEqual([]);
    expect(bundle!.assets).toEqual([
      { extension: 'media', path: 'a.png', bytes: 10, sha: 'sha-of-10' },
      { extension: 'media', path: 'b.png', bytes: 25, sha: 'sha-of-25' },
    ]);
    expect(bundle!.size.assetBytes).toBe(35);
  });

  it('name nothing where the world holds no statement that shows one', () => {
    const { bundle } = compiled('', {});
    expect(bundle!.assets).toEqual([]);
    expect(bundle!.size.assetBytes).toBe(0);
  });

  it('are refused at publish, at the literal, when the folder lacks one', () => {
    const { bundle, diagnostics } = compiled('    media.show("gone.png")', {});
    expect(bundle).toBeNull();
    expect(said(refusals(diagnostics))).toEqual([
      [
        'lamp.sprout:5:16',
        'The file "gone.png" is not in this world’s folder.',
        'Put the file there, with the path from the world’s folder written exactly, or name another.',
      ],
    ]);
  });

  it('are a warning at load, which runs the world without the file listed', () => {
    const { bundle, diagnostics } = compiled('    media.show("gone.png")', {}, { mode: 'load' });
    expect(said(warnings(diagnostics)).map(([where]) => where)).toEqual(['lamp.sprout:5:16']);
    expect(bundle!.assets).toEqual([]);
  });

  it('are refused where the file is not a PNG of one bit a pixel, with the extension’s own words', () => {
    const { diagnostics } = compiled(
      '    media.show("grey.png")\n    media.show("indexed.png")\n    media.show("rgb.png")',
      { 'grey.png': file(5, 8, 0), 'indexed.png': file(5, 1, 3), 'rgb.png': file(5, 1, 2) },
    );
    expect(said(refusals(diagnostics))).toEqual([
      [
        'lamp.sprout:5:16',
        'grey.png: This image is not black and white: it has 8 bits to a pixel, and an image here has one.',
        'Save the picture again as a 1-bit PNG, black and white without grey.',
      ],
      [
        'lamp.sprout:7:16',
        'rgb.png: This image is not black and white: it has 1 bits to a pixel, and an image here has one.',
        'Save the picture again as a 1-bit PNG, black and white without grey.',
      ],
    ]);
  });

  it('are refused where the file is not a PNG at all', () => {
    const notPng: AssetFile = { bytes: 3, sha: 'x', head: new TextEncoder().encode('abc') };
    const { diagnostics } = compiled('    media.show("text.png")', { 'text.png': notPng });
    expect(said(refusals(diagnostics))).toEqual([
      [
        'lamp.sprout:5:16',
        'text.png: This file is not a PNG image.',
        'Save the picture as a PNG file with one bit to a pixel (black and white).',
      ],
    ]);
  });

  it('weigh together no more than the host’s cap, which a host that sets none does not impose', () => {
    const folder = { 'a.png': file(60), 'b.png': file(50) };
    const statements = '    media.show("a.png")\n    media.show("b.png")';
    expect(compiled(statements, folder, { assetBytes: null }).bundle).not.toBeNull();
    expect(compiled(statements, folder, { assetBytes: 110 }).bundle).not.toBeNull();
    const over = compiled(statements, folder, { assetBytes: 109 });
    expect(over.bundle).toBeNull();
    expect(said(refusals(over.diagnostics)).map(([, message]) => message)).toEqual([
      'This world’s files for media are 110 bytes, and 109 is as much as they may be.',
    ]);
  });

  it('are not looked for where the world did not come from a folder', () => {
    const { bundle, diagnostics } = compiled('    media.show("gone.png")', undefined);
    expect(diagnostics).toEqual([]);
    expect(bundle!.assets).toEqual([]);
  });

  it('are listed in the cartridge under the extension that names them, and only there', () => {
    const { bundle } = compiled('    media.show("a.png")', { 'a.png': file(10) });
    const cartridge = readCartridge(emitCartridge(bundle!));
    expect(cartridge.extensions).toEqual([
      { name: 'media', major: 1, assets: [{ path: 'a.png', bytes: 10, sha: 'sha-of-10' }] },
    ]);
    const none = compiled('', {}).bundle!;
    expect(readCartridge(emitCartridge(none)).extensions).toEqual([{ name: 'media', major: 1 }]);
  });

  it('may be missing from the caps of a cartridge packed before the cap existed, which reads as unset', () => {
    const { bundle } = compiled('', {});
    const { assetBytes: _unset, ...older } = readCartridge(emitCartridge(bundle!)).caps;
    const parsed = CartridgeSchema.safeParse({
      ...readCartridge(emitCartridge(bundle!)),
      caps: older,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data!.caps.assetBytes).toBeNull();
  });
});
