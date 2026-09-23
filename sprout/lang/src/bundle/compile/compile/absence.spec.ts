// The spec's Two tiers, Strict and lenient, What absent means: at load a
// file, a library, a kind in a composition or a role, or an object's
// container that is missing, mismatched, withheld or broken reads as absent rather than
// refusing the bundle, the rest of the world keeps compiling, and every
// gap says so in a whole sentence. What was never allowable — a name
// that cannot be one, text newer than the compiler — is still refused in
// either mode, since nothing about it is missing.

import { describe, expect, it } from 'vitest';

import { type LibrarySource } from '../../bundle.js';
import { compileBundle } from '../compile.js';
import { limitsFrom } from '../../limits.js';
import { STANDARD_LIBRARY } from '../../standard-library.js';
import { locationOf } from '../../../source/source.js';
import {
  file,
  OWN_BYTES,
  refusals,
  ROOT,
  warnings,
  WORLD_TEXT,
  world,
} from '../../../fixtures/compile.js';

describe('loading is lenient: what is missing reads as absent and the rest runs', () => {
  const load = { mode: 'load' } as const;

  it('runs a world whose library did not travel, and records the gap', () => {
    const { bundle, diagnostics } = compileBundle(world({ libraries: [] }), load);
    expect(bundle).not.toBeNull();
    expect(refusals(diagnostics)).toEqual([]);
    expect(bundle!.absent[0]).toEqual({
      what: 'sprout',
      kind: 'library',
      reason: 'missing',
      at: expect.anything(),
      consequence: 'every kind, enum, verb and message it holds reads as absent',
    });
    // Without it the world, its visitors and the place they arrive at have
    // nothing to be made of, so it admits no one, and says why.
    expect(bundle!.absent.slice(1).map((a) => [a.what, a.kind])).toEqual([
      ['sprout.Actor', 'kind-in-composition'],
      ['sprout.Place', 'kind-in-composition'],
      ['sprout.World', 'world'],
      ['Visitor', 'visitor-kind'],
      ['hall', 'place-of-arrival'],
    ]);
    expect(bundle!.world).toBeNull();
    expect(bundle!.visitor).toBeNull();
  });

  it('runs a world with a kind in a composition that is not there, and its object is absent', () => {
    const files = [
      file(
        'world.sprout',
        `${ROOT}\nobject box: Crate in printers_shop\nobject tin: sprout.Ward in box`,
      ),
    ];
    const loaded = compileBundle(world({ files }), load);
    expect(refusals(loaded.diagnostics)).toEqual([]);
    expect(loaded.bundle!.objects.map((o) => o.name)).toEqual(['hall']);
    // Absent, and still where it was written, so the tin is placed inside it.
    expect([...loaded.bundle!.tree.placed.keys()]).toEqual(['hall', 'box', 'box.tin']);
    expect(loaded.bundle!.absent.map((a) => [a.what, a.kind, a.reason, locationOf(a.at!)])).toEqual(
      [
        ['Crate', 'kind-in-composition', 'missing', 'world.sprout:2:13'],
        ['sprout.Ward', 'kind-in-composition', 'missing', 'world.sprout:3:13'],
      ],
    );
    expect(warnings(loaded.diagnostics)[0]!.message).toBe(
      'Nothing here is a `Crate`. The object is absent: not in range, not listed, not addressable; what it holds is unreachable until the kind returns.',
    );
    // At publish the same is a refusal: a world is not published with a piece missing.
    const published = compileBundle(world({ files }));
    expect(published.bundle).toBeNull();
    expect(refusals(published.diagnostics).map((d) => d.message)).toEqual([
      'Nothing here is a `Crate`.',
      'Nothing here is a `sprout.Ward`.',
    ]);
  });

  it('runs a world with an object whose container is not there, and that object is absent', () => {
    const files = [
      file(
        'world.sprout',
        `${ROOT}\nkind Crate { contains }\nobject box: Crate in hal\nobject tin: Crate in hall.box`,
      ),
    ];
    const loaded = compileBundle(world({ files }), load);
    expect(refusals(loaded.diagnostics)).toEqual([]);
    expect(loaded.bundle!.objects.map((o) => o.name)).toEqual(['hall']);
    expect(loaded.bundle!.absent.map((a) => [a.what, a.kind, a.reason, locationOf(a.at!)])).toEqual(
      [['hal', 'container', 'missing', 'world.sprout:3:22']],
    );
    expect(warnings(loaded.diagnostics).map((d) => d.message)).toEqual([
      'Nothing here is called `hal`. Did you mean `hall`? The object is absent: not in range, not listed, not addressable; what it holds is unreachable until its container returns.',
    ]);
    const published = compileBundle(world({ files }));
    expect(published.bundle).toBeNull();
    expect(refusals(published.diagnostics).map((d) => d.message)).toEqual([
      'Nothing here is called `hal`. Did you mean `hall`?',
    ]);
  });

  it('runs a world with a kind in a role that is not there, and the role fills nothing', () => {
    const files = [
      file('world.sprout', `${ROOT}\nverb unlock { role target: Lockabel  "unlock [target]" }`),
    ];
    const loaded = compileBundle(world({ files }), load);
    expect(refusals(loaded.diagnostics)).toEqual([]);
    expect(loaded.bundle!.absent.map((a) => [a.what, a.kind, a.reason, locationOf(a.at!)])).toEqual(
      [['Lockabel', 'kind-in-role', 'missing', 'world.sprout:2:28']],
    );
    expect(warnings(loaded.diagnostics).map((d) => d.message)).toEqual([
      'Nothing here is a `Lockabel`. Nothing fills the role; the verb’s phrases do not match.',
    ]);
    // At publish the same is a refusal, with what to write instead.
    const published = compileBundle(world({ files }));
    expect(published.bundle).toBeNull();
    expect(refusals(published.diagnostics).map((d) => [d.message, d.remedy])).toEqual([
      [
        'Nothing here is a `Lockabel`.',
        'Declare it with `kind Lockabel { … }`, or check the spelling of a kind this world or a library it uses declares.',
      ],
    ]);
  });

  it('says a role’s kind is absent only once where its library did not travel', () => {
    const files = [
      file(
        'world.sprout',
        `${ROOT}\nverb give { role item  role recipient: sprout.Actor  "give [item] to [recipient]" }`,
      ),
    ];
    // At publish the library's absence is the one problem, said at the manifest.
    const published = compileBundle(world({ files, libraries: [] }));
    expect(published.bundle).toBeNull();
    expect(refusals(published.diagnostics).map((d) => d.message)).not.toContainEqual(
      expect.stringContaining('`sprout.Actor`'),
    );
    // At load the role is one more gap, recorded under its own row.
    const loaded = compileBundle(world({ files, libraries: [] }), load);
    expect(
      loaded.bundle!.absent.filter((a) => a.kind === 'kind-in-role').map((a) => a.what),
    ).toEqual(['sprout.Actor']);
  });

  it('refuses objects that hold each other at load as at publish, since nothing is missing', () => {
    const files = [
      file(
        'world.sprout',
        `${ROOT}\nkind Crate { contains }\nobject a: Crate in b\nobject b: Crate in a`,
      ),
    ];
    for (const mode of ['load', 'publish'] as const) {
      const { bundle, diagnostics } = compileBundle(world({ files }), { mode });
      expect(bundle, mode).toBeNull();
      expect(
        refusals(diagnostics).map((d) => d.message),
        mode,
      ).toEqual(['`a` is in `b`, which is in `a`.']);
    }
  });

  it('runs a world whose library is not the source recorded, and does not use that library', () => {
    const fork: LibrarySource = {
      ...STANDARD_LIBRARY,
      files: [file('ward.sprout', 'enum Ward { oak }')],
    };
    const { bundle } = compileBundle(world({ libraries: [fork] }), load);
    expect(bundle).not.toBeNull();
    expect(bundle!.absent[0]).toMatchObject({ what: 'sprout', reason: 'mismatched' });
    expect(bundle!.libraries).toEqual([]);
    expect(bundle!.size.sourceBytes).toBe(WORLD_TEXT.length);
  });

  it('says so, so the gap is visible rather than swallowed', () => {
    const { diagnostics } = compileBundle(world({ libraries: [] }), load);
    expect(diagnostics.every((d) => d.severity === 'warning')).toBe(true);
    expect(diagnostics.filter((d) => d.message.includes('reads as absent'))).toHaveLength(1);
    // And what that leaves the world without, in words that name the library.
    expect(diagnostics.map((d) => d.message)).toContain(
      '`sprout.World` is not here, because the library `sprout` is not. The world does not admit anyone, and the host says so outside it.',
    );
  });

  it('runs a world with a file withheld, and keeps the objects’ state', () => {
    const files = [file('world.sprout', WORLD_TEXT), file('kiln.sprout', 'enum Kiln { cold }')];
    const { bundle } = compileBundle(world({ files, withheld: ['kiln.sprout'] }), load);
    expect(bundle).not.toBeNull();
    expect(bundle!.absent[0]).toMatchObject({ what: 'kiln.sprout', reason: 'withheld' });
    expect(bundle!.absent[0]!.consequence).toContain('keep their state');
  });

  it('does not call a withheld file missing as well, since it is one gap and not two', () => {
    const files = [file('world.sprout', WORLD_TEXT), file('kiln.sprout', 'enum Kiln { cold }')];
    const { bundle } = compileBundle(world({ files, withheld: ['kiln.sprout'] }), load);
    expect(bundle!.absent.map((a) => a.reason)).toEqual(['withheld']);
  });

  it('runs a world a file of which the manifest names and did not arrive', () => {
    const { bundle } = compileBundle(
      world({ manifest: { files: ['world.sprout', 'kiln.prose'] } }),
      load,
    );
    expect(bundle).not.toBeNull();
    expect(bundle!.absent[0]).toMatchObject({ what: 'kiln.prose', reason: 'missing' });
  });

  it('runs a world one of whose files does not compile, and names the file', () => {
    const files = [file('world.sprout', WORLD_TEXT), file('b.sprout', '%')];
    const { bundle, diagnostics } = compileBundle(world({ files }), load);
    expect(bundle).not.toBeNull();
    expect(bundle!.absent).toHaveLength(1);
    expect(bundle!.absent[0]).toMatchObject({ what: 'b.sprout', kind: 'file', reason: 'broken' });
    expect(locationOf(bundle!.absent[0]!.at!)).toBe('b.sprout:1:1');
    expect(refusals(diagnostics)).toEqual([]);
  });

  it('keeps what a broken file had to say, as warnings, so a moderator sees why', () => {
    const files = [file('b.sprout', '% ; %'), file('world.sprout', ROOT)];
    const { diagnostics } = compileBundle(world({ files }), load);
    expect(warnings(diagnostics)).toHaveLength(3);
    expect(diagnostics.every((d) => d.severity === 'warning')).toBe(true);
  });

  it('leaves the files that do compile alone', () => {
    const files = [file('good.sprout', `${ROOT}\nenum Good { yes }`), file('bad.sprout', '%')];
    const { bundle } = compileBundle(world({ files }), load);
    expect(bundle!.absent.map((a) => a.what)).toEqual(['bad.sprout']);
  });

  it('still refuses a world past the host’s source cap, since no exception is recorded for it', () => {
    const limits = limitsFrom({ caps: { sourceBytes: OWN_BYTES } });
    const { bundle, diagnostics } = compileBundle(world(), { ...load, limits });
    expect(bundle).toBeNull();
    expect(locationOf(refusals(diagnostics)[0]!.at)).toBe('sprout.json:2:3');
    expect(refusals(diagnostics)[0]!.message).toContain('bytes of source');
  });

  it('still refuses a world past the host’s file cap, since no exception is recorded for it', () => {
    const limits = limitsFrom({ caps: { files: 2 } });
    const { bundle, diagnostics } = compileBundle(world(), { ...load, limits });
    expect(bundle).toBeNull();
    expect(locationOf(refusals(diagnostics)[0]!.at)).toBe('sprout.json:2:3');
    expect(refusals(diagnostics)[0]!.message).toContain('files');
  });

  it('warns rather than refuses about a file the manifest does not name', () => {
    const files = [file('world.sprout', WORLD_TEXT), file('kiln.sprout', 'enum Kiln { cold }')];
    const { bundle } = compileBundle(world({ files, manifest: { files: ['world.sprout'] } }), load);
    expect(bundle).not.toBeNull();
  });

  it('still refuses text newer than the compiler, because it cannot read it', () => {
    const { bundle } = compileBundle(world({ manifest: { level: 4 } }), {
      ...load,
      compilerLevel: 2,
    });
    expect(bundle).toBeNull();
  });

  it('still refuses what was never allowable, such as a world with no name', () => {
    expect(compileBundle(world({ manifest: { name: 'Shop' } }), load).bundle).toBeNull();
    expect(compileBundle(world({ manifest: { license: '' } }), load).bundle).toBeNull();
  });

  it('hashes the source that actually arrived, a withheld file not among it', () => {
    const files = [file('world.sprout', WORLD_TEXT), file('kiln.sprout', 'enum Kiln { cold }')];
    const whole = compileBundle(world({ files }), load).bundle!;
    const held = compileBundle(world({ files, withheld: ['kiln.sprout'] }), load).bundle!;
    expect(held.hash).not.toBe(whole.hash);
  });

  it('has nothing to soften yet, since no policy has been tightened since level 1', () => {
    // `softenPolicy` is wired into the load path; the first refusal
    // carrying a `since` will be the first to exercise it end to end.
    const { diagnostics } = compileBundle(world(), load);
    expect(diagnostics.filter((d) => d.since !== undefined)).toEqual([]);
  });
});

describe('a gap is said in whole sentences, and still says what to do about it', () => {
  it('starts the consequence with a capital, since it is a sentence and not a table cell', () => {
    const { diagnostics } = compileBundle(world({ libraries: [] }), { mode: 'load' });
    expect(diagnostics[0]!.message).toBe(
      'This world uses the library "sprout", and its source did not travel with it. ' +
        'Every kind, enum, verb and message it holds reads as absent.',
    );
  });

  it('keeps the remedy, which a moderator reading a withheld world still needs', () => {
    const files = [file('world.sprout', WORLD_TEXT), file('kiln.sprout', 'enum Kiln { cold }')];
    const { diagnostics } = compileBundle(world({ files, withheld: ['kiln.sprout'] }), {
      mode: 'load',
    });
    expect(diagnostics[0]!.remedy).toContain('Restore it');
  });
});
