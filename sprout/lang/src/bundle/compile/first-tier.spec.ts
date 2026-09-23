// The first tier, which reads each file alone for its shape before the
// bundle is closed (the spec's Two tiers), over the world's files and its
// libraries alike; a library file that will not compile reads as absent.

import { describe, expect, it } from 'vitest';

import { STANDARD_LIBRARY } from '../standard-library.js';
import { libraryHash, type LibrarySource } from '../bundle.js';
import { DEFAULT_LIMITS, limitsFrom } from '../limits.js';
import { locationOf, SourceFile } from '../../source/source.js';
import { checkShape, readFirstTier } from './first-tier.js';
import { compileBundle } from './compile.js';
import { Report } from './report.js';
import { refusals, ROOT, world } from '../../fixtures/compile.js';

const file = (name: string, text: string): SourceFile => new SourceFile(name, text);

describe('the first tier reads one file alone, for its shape', () => {
  it('gives back the file’s declarations and nothing to say about a clean one', () => {
    const { declarations, diagnostics } = checkShape(file('ward.sprout', 'enum Ward { oak }'));
    expect(diagnostics).toEqual([]);
    expect(declarations).toHaveLength(1);
    expect(declarations[0]!.kind).toBe('enum');
  });

  it('names the line and column of what it refuses', () => {
    const { diagnostics } = checkShape(file('ward.sprout', 'enum Ward {\n  oak % silver\n}'));
    // Exactly one: the lexer steps the character over and the parser
    // does not report the gap it left as a missing comma.
    expect(diagnostics).toHaveLength(1);
    expect(locationOf(diagnostics[0]!.at)).toBe('ward.sprout:2:7');
  });

  it('checks a declaration against itself, which is all the first tier can see', () => {
    const { diagnostics } = checkShape(file('ward.sprout', 'enum Ward { oak, oak }'));
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.message).toContain('twice');
  });

  it('checks a verb’s roles and phrases against each other, under the host’s caps', () => {
    const text = 'verb take { role target  "take [thing]"  "get [target]" }\n';
    expect(
      checkShape(file('verbs.sprout', text)).diagnostics.map((d) => [locationOf(d.at), d.message]),
    ).toEqual([
      ['verbs.sprout:1:32', '`"take [thing]"` names `thing`, and `take` has no such role.'],
    ]);
    const caps = limitsFrom({ caps: { phrasesPerVerb: 1 } }).caps;
    const fits = 'verb take { role target  "take [target]" }\n';
    expect(checkShape(file('verbs.sprout', fits), caps).diagnostics).toEqual([]);
    expect(
      checkShape(file('verbs.sprout', text.replace('[thing]', '[target]')), caps).diagnostics.map(
        (d) => d.message,
      ),
    ).toEqual(['`take` has 2 phrases, and 1 is as many as a verb may have.']);
  });

  it('refuses a world that does not write `sprout.World`', () => {
    // One declaration answers this on its own — nothing has to be
    // resolved — so it belongs to the tier an editor runs on each
    // keystroke.
    const { diagnostics } = checkShape(
      file('world.sprout', 'world shop {\n  visitors are Creature\n}\n'),
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.message).toBe('`shop` does not compose `sprout.World`.');
    expect(locationOf(diagnostics[0]!.at)).toBe('world.sprout:1:7');
  });

  it('takes the world that writes it', () => {
    const { declarations, diagnostics } = checkShape(
      file('world.sprout', 'world shop: sprout.World {\n  visitors are Creature\n}\n'),
    );
    expect(diagnostics).toEqual([]);
    expect(declarations.map((d) => d.kind)).toEqual(['world']);
  });

  it('refuses a kind or an object that writes `sprout.World`, and an object with no kind', () => {
    // Anything but a world composing it is refused, and one declaration
    // answers that on its own, as it does whether an object named a kind.
    const { declarations, diagnostics } = checkShape(
      file(
        'kinds.sprout',
        'kind Crate: sprout.World { }\nobject bench: sprout.World in hall\nobject lamp in hall\n',
      ),
    );
    expect(declarations.map((d) => d.kind)).toEqual(['kind', 'object', 'object']);
    expect(diagnostics.map((d) => [locationOf(d.at), d.message])).toEqual([
      ['kinds.sprout:1:13', '`Crate` composes `sprout.World`, which only a world may.'],
      ['kinds.sprout:2:15', '`bench` composes `sprout.World`, which only a world may.'],
      ['kinds.sprout:3:8', '`lamp` does not say what kind of thing it is.'],
    ]);
  });

  it('takes a kind and an object that compose what they may', () => {
    const { diagnostics } = checkShape(
      file('kinds.sprout', 'kind Crate: sprout.Container { }\nobject box: Crate in hall\n'),
    );
    expect(diagnostics).toEqual([]);
  });

  it('leaves a .prose file to B29 rather than reading it as code', () => {
    const { declarations, diagnostics } = checkShape(
      file('mirror.prose', 'You see yourself, and % is not a problem here.'),
    );
    expect(diagnostics).toEqual([]);
    expect(declarations).toEqual([]);
  });
});

describe('the first tier reads every file in the bundle', () => {
  const sprout = {
    ...STANDARD_LIBRARY,
    hash: libraryHash(STANDARD_LIBRARY),
    blessed: true,
    bytes: 0,
  };

  /** Read `files` as the world `shop`'s own, beside the standard library, in `mode`. */
  function read(files: SourceFile[], mode: 'publish' | 'load' = 'publish') {
    const report = new Report(mode, file('sprout.json', '').span(0, 0));
    const tier = readFirstTier(files, [sprout], 'shop', DEFAULT_LIMITS.caps, report);
    return { tier, report };
  }

  it('gives back every declaration, by the library it is declared in', () => {
    const { tier, report } = read([file('world.sprout', 'enum Season { spring }')]);
    expect(report.diagnostics.all).toEqual([]);
    expect(tier.ownFileRefused).toBe(false);
    expect([...tier.byLibrary.keys()]).toEqual(['shop', 'sprout']);
    expect(tier.byLibrary.get('shop')!.map((d) => d.name.text)).toEqual(['Season']);
    expect(tier.declarations.map((d) => d.name.text)).toEqual([
      'Season',
      'World',
      'go',
      'look',
      'examine',
      'inventory',
      'wait',
      'help',
      'Place',
      'take',
      'drop',
      'give',
      'Actor',
      'ask',
    ]);
  });

  it('refuses a world file that does not compile at publish, and says it was the world’s', () => {
    const { tier, report } = read([file('world.sprout', '%')]);
    expect(tier.ownFileRefused).toBe(true);
    expect(tier.byLibrary.has('shop')).toBe(false);
    expect(report.diagnostics.refusals.map((d) => locationOf(d.at))).toEqual(['world.sprout:1:1']);
  });

  it('reads such a file as absent at load, keeping what it said as warnings', () => {
    const { tier, report } = read(
      [file('world.sprout', '%'), file('ok.sprout', 'enum A { b }')],
      'load',
    );
    expect(tier.ownFileRefused).toBe(true);
    expect(tier.byLibrary.get('shop')!.map((d) => d.name.text)).toEqual(['A']);
    expect(report.absent.map((a) => [a.what, a.kind, a.reason])).toEqual([
      ['world.sprout', 'file', 'broken'],
    ]);
    expect(report.diagnostics.refusals).toEqual([]);
    expect(report.diagnostics.all.map((d) => d.severity)).toEqual(['warning']);
  });
});

// The same tier through a whole compile, the world's own files and a
// vendored library's read together.

describe('the whole bundle is read, the world’s files and its libraries alike', () => {
  it('refuses a syntax problem in the world’s own source, naming the file', () => {
    const files = [file('other.sprout', ROOT), file('world.sprout', 'enum Season { spring }\n%\n')];
    const { bundle, diagnostics } = compileBundle(world({ files }));
    expect(bundle).toBeNull();
    expect(locationOf(refusals(diagnostics)[0]!.at)).toBe('world.sprout:2:1');
  });

  it('refuses a syntax problem in a vendored library too, because they compile together', () => {
    const broken: LibrarySource = {
      ...STANDARD_LIBRARY,
      files: [file('ward.sprout', 'enum Ward { oak }\n%\n')],
    };
    const { bundle, diagnostics } = compileBundle(
      world({
        libraries: [broken],
        manifest: { libraries: [{ name: 'sprout', version: '0.1.0', sha: libraryHash(broken) }] },
      }),
    );
    expect(bundle).toBeNull();
    expect(locationOf(refusals(diagnostics)[0]!.at)).toBe('ward.sprout:2:1');
  });

  it('gives every problem in reading order, not the first', () => {
    const files = [file('a.sprout', '% ; %'), file('b.sprout', '%'), file('world.sprout', ROOT)];
    const { diagnostics } = compileBundle(world({ files }));
    expect(refusals(diagnostics)).toHaveLength(4);
    expect(refusals(diagnostics).map((d) => locationOf(d.at))).toEqual([
      'a.sprout:1:1',
      'a.sprout:1:3',
      'a.sprout:1:5',
      'b.sprout:1:1',
    ]);
  });
});

describe('a library’s own file reads as absent when it will not compile', () => {
  // The tier-one pass walks the world's files and every usable library's
  // alike, with no branch between them; this is the library half of the
  // world-file case above, kept because the two are only obviously the
  // same path if you have read the loop.
  const broken: LibrarySource = {
    ...STANDARD_LIBRARY,
    files: [...STANDARD_LIBRARY.files, file('ward.sprout', 'enum Ward { oak }\n%\n')],
  };
  const withBroken = () =>
    world({
      libraries: [broken],
      manifest: { libraries: [{ name: 'sprout', version: '0.1.0', sha: libraryHash(broken) }] },
    });

  it('refuses it at publish', () => {
    expect(compileBundle(withBroken()).bundle).toBeNull();
  });

  it('reads it as absent at load, and keeps the rest of the world running', () => {
    const { bundle, diagnostics } = compileBundle(withBroken(), { mode: 'load' });
    expect(bundle).not.toBeNull();
    expect(bundle!.absent).toHaveLength(1);
    expect(bundle!.absent[0]).toMatchObject({
      what: 'ward.sprout',
      kind: 'file',
      reason: 'broken',
    });
    expect(refusals(diagnostics)).toEqual([]);
  });
});
