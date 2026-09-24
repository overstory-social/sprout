// Attaching each kind's `.prose` file to it (the spec's Prose › Passages;
// The compiler › What absent means, What it warns about), over what the
// first tier read; the last cases run the whole compile, for what the
// attached passages become in the bundle.

import { describe, expect, it } from 'vitest';

import type { CompileMode } from '../absent.js';
import type { Declaration, KindMember, WorldMember } from '../../syntax/ast.js';
import type { Diagnostic } from '../../source/diagnostics.js';
import { locationOf } from '../../source/source.js';
import { attachProse } from './prose.js';
import { compileBundle } from './compile.js';
import {
  file,
  firstTierOf,
  PERSON,
  refusals,
  warnings,
  world,
  WORLD_LINE,
} from '../../fixtures/compile.js';

const MIRROR = 'kind Mirror {\n  prose "mirror.prose"\n  :mood 0\n}\n';
const PASSAGES = 'passage greeting { The glass is cold. }\npassage shine default { It shines. }\n';

const said = (list: readonly Diagnostic[]) => list.map((d) => [locationOf(d.at), d.message]);

/**
 * `files` read by the first tier and attached in `mode`, the manifest
 * naming `named` (every file, unless a case says otherwise).
 */
function attached(
  files: Record<string, string>,
  options: { mode?: CompileMode; named?: string[] } = {},
) {
  const { first, report } = firstTierOf(
    Object.entries(files).map(([name, text]) => file(name, text)),
    options.mode,
  );
  expect(said(report.diagnostics.all), 'the fixture reads').toEqual([]);
  const result = attachProse(
    first.byLibrary,
    { prose: first.prose, named: new Set(options.named ?? Object.keys(files)) },
    report,
  );
  const own = result.byLibrary.get('printers_shop') ?? [];
  return {
    result,
    report,
    refused: said(refusals(report.diagnostics.all)),
    warned: said(warnings(report.diagnostics.all)),
    /** The members of the kind or world called `name`, each as its kind and, for a passage, its name and where it is written. */
    members: (name: string) => membersOf(own, name),
  };
}

/** The members of the declaration or declared object called `name`, anywhere among `declared`. */
function membersOf(declared: readonly Declaration[], name: string): string[] {
  type Holder = {
    name: { text: string };
    members: readonly (KindMember | WorldMember)[];
    objects: readonly Holder[];
  };
  const holders = declared.flatMap((d) => (d.kind === 'kind' || d.kind === 'world' ? [d] : []));
  const find = (among: readonly Holder[]): Holder | undefined => {
    for (const holder of among) {
      if (holder.name.text === name) return holder;
      const inner = find(holder.objects);
      if (inner !== undefined) return inner;
    }
    return undefined;
  };
  const holder = find(holders);
  expect(holder, `\`${name}\` is declared`).toBeDefined();
  return holder!.members.map((member) =>
    member.kind === 'passage'
      ? `passage ${member.name.text} ${locationOf(member.name.at)}`
      : member.kind,
  );
}

describe('a kind’s `.prose` file gives it the passages in it', () => {
  it('as if they were written in its braces, after its own members, each spanned in the file', () => {
    const { members, refused, warned, result } = attached({
      'mirror.sprout': MIRROR,
      'mirror.prose': PASSAGES,
    });
    expect(refused).toEqual([]);
    expect(warned).toEqual([]);
    expect(members('Mirror')).toEqual([
      'prose-file',
      'property',
      'passage greeting mirror.prose:1:9',
      'passage shine mirror.prose:2:9',
    ]);
    expect(result.gone.size).toBe(0);
    expect(result.declarations).toEqual([...result.byLibrary.values()].flat());
  });

  it('reads the file beside the one the kind is written in, and no other', () => {
    expect(
      attached({ 'rooms/mirror.sprout': MIRROR, 'rooms/mirror.prose': PASSAGES }).members('Mirror'),
    ).toEqual([
      'prose-file',
      'property',
      'passage greeting rooms/mirror.prose:1:9',
      'passage shine rooms/mirror.prose:2:9',
    ]);
    const elsewhere = attached(
      { 'rooms/mirror.sprout': MIRROR, 'mirror.prose': PASSAGES },
      { named: ['rooms/mirror.sprout', 'mirror.prose'] },
    );
    expect(elsewhere.members('Mirror')).toEqual(['prose-file', 'property']);
    expect(elsewhere.refused).toEqual([
      [
        'rooms/mirror.sprout:2:9',
        '`Mirror` points at "mirror.prose", and no such file is in this world.',
      ],
    ]);
  });

  it('gives a declared object, however deep, the passages of the file it points at', () => {
    const { members, refused } = attached({
      'printers_shop.sprout':
        'world printers_shop is sprout.World { visitors are Person visitors arrive at hall\n' +
        '  object hall is sprout.Place { object bell is sprout.Thing { prose "bell.prose" } }\n' +
        '}\n',
      'bell.prose': 'passage ring { Ding. }\n',
    });
    expect(refused).toEqual([]);
    expect(members('bell')).toEqual(['prose-file', 'passage ring bell.prose:1:9']);
    expect(members('hall')).toEqual([]);
  });

  it('keeps a passage written both in the braces and in the file, for the kind to refuse', () => {
    const { members, refused } = attached({
      'mirror.sprout': 'kind Mirror {\n  passage greeting { Hi. }\n  prose "mirror.prose"\n}\n',
      'mirror.prose': PASSAGES,
    });
    expect(refused).toEqual([]);
    expect(members('Mirror')).toEqual([
      'passage greeting mirror.sprout:2:11',
      'prose-file',
      'passage greeting mirror.prose:1:9',
      'passage shine mirror.prose:2:9',
    ]);
  });
});

describe('a file belongs to one kind, and a kind names one file', () => {
  it('refuses a second `prose` line, and attaches the first', () => {
    const { members, refused } = attached({
      'mirror.sprout': 'kind Mirror {\n  prose "mirror.prose"\n  prose "glass.prose"\n}\n',
      'mirror.prose': PASSAGES,
      'glass.prose': 'passage glint { Glint. }\n',
    });
    expect(refused).toEqual([['mirror.sprout:3:3', '`Mirror` points at a `.prose` file twice.']]);
    expect(members('Mirror')).toEqual([
      'prose-file',
      'prose-file',
      'passage greeting mirror.prose:1:9',
      'passage shine mirror.prose:2:9',
    ]);
  });

  it('refuses a file another kind points at, and gives the second kind nothing from it', () => {
    const { members, refused } = attached({
      'mirror.sprout': MIRROR,
      'lamp.sprout': 'kind Lamp { prose "mirror.prose" }\n',
      'mirror.prose': PASSAGES,
    });
    expect(refused).toEqual([
      [
        'lamp.sprout:1:19',
        '"mirror.prose" holds `Mirror`\'s passages, and a file\'s passages belong to one kind.',
      ],
    ]);
    expect(members('Mirror')).toHaveLength(4);
    expect(members('Lamp')).toEqual(['prose-file']);
  });

  it('warns about a file no kind points at, which nothing can say', () => {
    const { refused, warned } = attached({ 'lamp.prose': 'passage glow { Glow. }\n' });
    expect(refused).toEqual([]);
    expect(warned).toEqual([
      ['lamp.prose:1:1', 'No kind points at "lamp.prose", so nothing says its passages.'],
    ]);
  });
});

describe('a `.prose` file that is not there', () => {
  it('is refused at publish where the world never had it, and the kind is gone', () => {
    const { refused, result, report } = attached(
      { 'mirror.sprout': MIRROR },
      { named: ['mirror.sprout'] },
    );
    expect(refused).toEqual([
      [
        'mirror.sprout:2:9',
        '`Mirror` points at "mirror.prose", and no such file is in this world.',
      ],
    ]);
    expect(report.absent).toEqual([]);
    expect([...result.gone]).toEqual(['printers_shop.Mirror']);
  });

  it('is a gap at load, and the kind runs without its passages', () => {
    const { members, refused, warned, result, report } = attached(
      { 'mirror.sprout': MIRROR },
      { mode: 'load', named: ['mirror.sprout'] },
    );
    expect(refused).toEqual([]);
    expect(warned.map(([at]) => at)).toEqual(['mirror.sprout:2:9']);
    expect(report.absent.map((gap) => [gap.what, gap.kind, gap.reason])).toEqual([
      ['mirror.prose', 'passage', 'missing'],
    ]);
    expect(members('Mirror')).toEqual(['prose-file', 'property']);
    expect([...result.gone]).toEqual(['printers_shop.Mirror']);
  });

  it('is not said again where the manifest names it, as a gap already said, and the kind is gone', () => {
    for (const mode of ['publish', 'load'] as const) {
      const { refused, warned, result, report } = attached(
        { 'mirror.sprout': MIRROR },
        { mode, named: ['mirror.sprout', 'mirror.prose'] },
      );
      expect(refused, mode).toEqual([]);
      expect(warned, mode).toEqual([]);
      expect(report.absent, mode).toEqual([]);
      expect([...result.gone], mode).toEqual(['printers_shop.Mirror']);
    }
  });
});

describe('what the compile makes of the attached passages', () => {
  /** The world's line and person, with these files beside them, compiled whole. */
  function compiled(
    files: Record<string, string>,
    options: { mode?: 'load'; withheld?: string[] } = {},
  ) {
    const result = compileBundle(
      world({
        files: [
          file('printers_shop.sprout', `${WORLD_LINE}\n`),
          PERSON,
          ...Object.entries(files).map(([name, text]) => file(name, text)),
        ],
        ...(options.withheld === undefined ? {} : { withheld: options.withheld }),
      }),
      options.mode === undefined ? {} : { mode: options.mode },
    );
    return { bundle: result.bundle, refused: said(refusals(result.diagnostics)) };
  }

  it('makes them the kind’s own passages, with its origin and their defaults', () => {
    const { bundle, refused } = compiled({ 'mirror.sprout': MIRROR, 'mirror.prose': PASSAGES });
    expect(refused).toEqual([]);
    const mirror = bundle!.kindLookup.qualified('printers_shop', 'Mirror')!;
    expect([...mirror.passages.values()].map((p) => [p.name, p.origin, p.yields])).toEqual([
      ['greeting', 'printers_shop.Mirror', false],
      ['shine', 'printers_shop.Mirror', true],
    ]);
    expect(locationOf(mirror.passages.get('shine')!.at)).toBe('mirror.prose:2:9');
  });

  it('refuses a passage written both in the braces and in the file, at the second', () => {
    expect(
      compiled({
        'mirror.sprout': 'kind Mirror {\n  passage greeting { Hi. }\n  prose "mirror.prose"\n}\n',
        'mirror.prose': PASSAGES,
      }).refused,
    ).toEqual([['mirror.prose:1:9', '`Mirror` writes the passage `greeting` twice.']]);
  });

  it('records the gap at load, and the kind has no passages', () => {
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
