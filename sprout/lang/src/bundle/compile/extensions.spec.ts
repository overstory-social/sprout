import { describe, expect, it } from 'vitest';

import type { Manifest } from '../bundle.js';
import { locationOf } from '../../source/source.js';
import { file, refusals, warnings, world, worldFiles, WORLD_TEXT } from '../../fixtures/compile.js';
import { MEDIA } from '../../fixtures/extensions.js';
import { compileBundle } from './compile.js';
import type { Extension } from '../../declare/extensions.js';
import type { Diagnostic } from '../../source/diagnostics.js';

/** A manifest text pinning `pins`, so a problem with one names its line and column. */
const manifestPinning = (pins: Manifest['extensions']): string =>
  [
    '{',
    '  "name": "printers_shop",',
    `  "extensions": ${JSON.stringify(pins)},`,
    '  "files": []',
    '}',
    '',
  ].join('\n');

/** What compiling the shop, pinning `pins` and with `text` as its world's file, says. */
function compiled(
  pins: Manifest['extensions'],
  options: { installed?: readonly Extension[]; mode?: 'publish' | 'load'; text?: string } = {},
) {
  const files = worldFiles(options.text ?? WORLD_TEXT);
  return compileBundle(
    world({ files, manifest: { extensions: pins }, manifestText: manifestPinning(pins) }),
    { extensions: options.installed ?? [], mode: options.mode ?? 'publish' },
  );
}

const said = (diagnostics: readonly Diagnostic[]) =>
  diagnostics.map((d) => [locationOf(d.at), d.message, d.remedy]);

describe('the extensions a manifest pins, against the host’s', () => {
  it('compiles where the host installed each at its major, and says nothing', () => {
    const { bundle, diagnostics } = compiled([{ name: 'media', major: 2 }], { installed: [MEDIA] });
    expect(diagnostics).toEqual([]);
    expect(bundle!.absent).toEqual([]);
  });

  it('refuses at publish one the host does not provide, or not at that major, at the pin', () => {
    const { bundle, diagnostics } = compiled(
      [
        { name: 'media', major: 1 },
        { name: 'maps', major: 0 },
      ],
      { installed: [MEDIA] },
    );
    expect(bundle).toBeNull();
    expect(said(refusals(diagnostics))).toEqual([
      [
        'sprout.json:3:26',
        'This host provides the extension `media`, and not at major version 1.',
        'Pin the major version this host provides, if the world reads the same with it.',
      ],
      [
        'sprout.json:3:53',
        'This host does not provide the extension `maps`.',
        'Ask whoever runs this host to install `maps`, or take it out of the manifest and every file that names it.',
      ],
    ]);
  });

  it('at load runs without it, recording the gap the absent table names', () => {
    const { bundle, diagnostics } = compiled([{ name: 'media', major: 2 }], { mode: 'load' });
    expect(bundle).not.toBeNull();
    expect(bundle!.absent).toEqual([
      {
        what: 'media',
        kind: 'extension',
        reason: 'missing',
        at: expect.anything(),
        consequence: 'its statements record nothing and its types hold their defaults',
      },
    ]);
    expect(bundle!.extensions).toEqual([
      { name: 'media', major: 2, installed: null, absence: 'not-installed' },
    ]);
    expect(warnings(diagnostics).map((d) => d.message)).toEqual([
      'This host does not provide the extension `media`. Its statements record nothing and its types hold their defaults.',
    ]);
  });

  it('refuses a name a file could not write, or one a library or the namespace takes', () => {
    const { diagnostics } = compiled(
      [
        { name: 'Media', major: 2 },
        { name: 'sprout', major: 1 },
        { name: 'printers_shop', major: 1 },
      ],
      { installed: [MEDIA] },
    );
    expect(refusals(diagnostics).map((d) => d.message)).toEqual([
      '"Media" cannot name an extension.',
      '`sprout` names both an extension and a library or namespace of this world, so `sprout.` could mean either.',
      '`printers_shop` names both an extension and a library or namespace of this world, so `printers_shop.` could mean either.',
    ]);
  });
});

describe('the `extension` lines at the top of a file, against the manifest', () => {
  it('refuses one the manifest does not pin, one at another major, and one named twice', () => {
    const lamp = file(
      'lamp.sprout',
      'extension media 3\nextension maps 1\nextension media 2\nkind Lamp { }\n',
    );
    const files = [...worldFiles(WORLD_TEXT), lamp];
    const pins = [{ name: 'media', major: 2 }];
    const { diagnostics } = compileBundle(
      world({ files, manifest: { extensions: pins }, manifestText: manifestPinning(pins) }),
      { extensions: [MEDIA] },
    );
    expect(said(refusals(diagnostics))).toEqual([
      [
        'lamp.sprout:1:17',
        'The manifest pins `media` at major version 2, and this file names 3.',
        'Write `extension media 2`, the major version the manifest pins.',
      ],
      [
        'lamp.sprout:2:11',
        'The manifest does not pin the extension `maps`.',
        'Pin it in the manifest, as in `"extensions": [{ "name": "maps", "major": 1 }]`.',
      ],
      [
        'lamp.sprout:3:11',
        'This file names the extension `media` twice.',
        'Keep one `extension` line for it.',
      ],
    ]);
  });
});
