import { describe, expect, it } from 'vitest';

import { locationOf } from '../../source/source.js';
import { compileBundle } from './compile.js';
import { file, PERSON, refusals, warnings, world, WORLD_LINE } from '../../fixtures/compile.js';

const MIRROR = 'kind Mirror {\n  prose "mirror.prose"\n  :mood 0\n}\n';
const PASSAGES = 'passage greeting { The glass is cold. }\npassage shine default { It shines. }\n';

/** The world's line and person, with these files beside them. */
function compiled(
  files: Record<string, string>,
  options: { mode?: 'load'; withheld?: string[] } = {},
) {
  const all = [
    file('world.sprout', `${WORLD_LINE}\n`),
    PERSON,
    ...Object.entries(files).map(([name, text]) => file(name, text)),
  ];
  const result = compileBundle(
    world({
      files: all,
      ...(options.withheld === undefined ? {} : { withheld: options.withheld }),
    }),
    options.mode === undefined ? {} : { mode: options.mode },
  );
  const said = (list: typeof result.diagnostics) => list.map((d) => [locationOf(d.at), d.message]);
  return {
    bundle: result.bundle,
    refused: said(refusals(result.diagnostics)),
    warned: said(warnings(result.diagnostics)),
  };
}

describe('a kind’s `.prose` file gives it the passages in it', () => {
  it('as if they were written in its braces, each spanned in the file', () => {
    const { bundle, refused } = compiled({ 'mirror.sprout': MIRROR, 'mirror.prose': PASSAGES });
    expect(refused).toEqual([]);
    const mirror = bundle!.kindLookup.qualified('printers_shop', 'Mirror')!;
    expect([...mirror.passages.values()].map((p) => [p.name, p.origin, p.yields])).toEqual([
      ['greeting', 'printers_shop.Mirror', false],
      ['shine', 'printers_shop.Mirror', true],
    ]);
    expect(locationOf(mirror.passages.get('shine')!.at)).toBe('mirror.prose:2:9');
  });

  it('reads the file beside the one the kind is written in', () => {
    const { bundle, refused } = compiled({
      'rooms/mirror.sprout': MIRROR,
      'rooms/mirror.prose': PASSAGES,
    });
    expect(refused).toEqual([]);
    expect(bundle!.kindLookup.qualified('printers_shop', 'Mirror')!.passages.size).toBe(2);
  });

  it('refuses a passage written both in the braces and in the file, at the second', () => {
    const { refused } = compiled({
      'mirror.sprout': 'kind Mirror {\n  passage greeting { Hi. }\n  prose "mirror.prose"\n}\n',
      'mirror.prose': PASSAGES,
    });
    expect(refused).toEqual([
      ['mirror.prose:1:9', '`Mirror` writes the passage `greeting` twice.'],
    ]);
  });
});

describe('a file belongs to one kind, and a kind names one file', () => {
  it('refuses a second `prose` line, and a file another kind points at', () => {
    expect(
      compiled({
        'mirror.sprout': 'kind Mirror {\n  prose "mirror.prose"\n  prose "glass.prose"\n}\n',
        'mirror.prose': PASSAGES,
        'glass.prose': 'passage glint { Glint. }\n',
      }).refused,
    ).toEqual([['mirror.sprout:3:3', '`Mirror` points at a `.prose` file twice.']]);
    expect(
      compiled({
        'mirror.sprout': MIRROR,
        'lamp.sprout': 'kind Lamp { prose "mirror.prose" }\n',
        'mirror.prose': PASSAGES,
      }).refused,
    ).toEqual([
      [
        'lamp.sprout:1:19',
        '"mirror.prose" holds `Mirror`\'s passages, and a file\'s passages belong to one kind.',
      ],
    ]);
  });

  it('warns about a file no kind points at, which nothing can say', () => {
    const { refused, warned } = compiled({ 'lamp.prose': 'passage glow { Glow. }\n' });
    expect(refused).toEqual([]);
    expect(warned).toEqual([
      ['lamp.prose:1:1', 'No kind points at "lamp.prose", so nothing says its passages.'],
    ]);
  });
});

describe('a `.prose` file that is not there', () => {
  it('is refused at publish where the world never had it', () => {
    expect(compiled({ 'mirror.sprout': MIRROR }).refused).toEqual([
      [
        'mirror.sprout:2:9',
        '`Mirror` points at "mirror.prose", and no such file is in this world.',
      ],
    ]);
  });

  it('is a gap at load, and the kind runs without its passages', () => {
    const { bundle, refused } = compiled({ 'mirror.sprout': MIRROR }, { mode: 'load' });
    expect(refused).toEqual([]);
    expect(bundle!.absent.map((gap) => [gap.what, gap.kind])).toEqual([
      ['mirror.prose', 'passage'],
    ]);
    expect(bundle!.kindLookup.qualified('printers_shop', 'Mirror')!.passages.size).toBe(0);
  });

  it('withheld at load, leaves what says one of its passages to render nothing, told as a gap', () => {
    const { bundle, refused } = compiled(
      {
        'mirror.sprout':
          'kind Mirror {\n  prose "mirror.prose"\n  as target for peer { do { say greeting } }\n}\n',
        'verbs.sprout': 'verb peer { role target  "peer at [target]" }\n',
        'mirror.prose': PASSAGES,
      },
      { mode: 'load', withheld: ['mirror.prose'] },
    );
    expect(refused).toEqual([]);
    expect(bundle!.absent.map((gap) => [gap.what, gap.kind, gap.reason])).toEqual([
      ['mirror.prose', 'file', 'withheld'],
      ['greeting', 'passage', 'missing'],
    ]);
  });
});
