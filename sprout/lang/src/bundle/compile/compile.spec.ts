// `compileBundle` itself, directly: the whole `Bundle` it assembles from
// the steps of this folder, and the two modes — strict at publish,
// lenient at load — that decide how a problem is told. Each stage's own
// rules are `bundle/compile/*.spec.ts`, beside the file that makes them;
// `bundle/compile/compile/*.spec.ts` holds the cross-stage concerns:
// the manifest, files and vendoring, libraries, the world and arrival,
// caps, and absence.

import { describe, expect, it } from 'vitest';

import { compileBundle } from './compile.js';
import { limitsFrom } from '../limits.js';
import { file, refusals, ROOT, WORLD_LINE, WORLD_TEXT, world } from '../../fixtures/compile.js';
import { locationOf } from '../../source/source.js';

describe('what a compiled bundle carries', () => {
  const { bundle } = compileBundle(world());

  it('records the caps it was checked against, for a host that loads it later to decide', () => {
    const limits = limitsFrom({ caps: { optionsPerEnum: 12, places: 40 } });
    expect(compileBundle(world(), { limits }).bundle!.caps).toEqual(limits.caps);
    // And nothing about nesting: the parser's bound is its own, and a
    // host loading this has nothing to decide about it.
    expect(bundle!.caps).not.toHaveProperty('nesting');
  });

  it('carries a hash, which is what the log records beside a publish', () => {
    expect(bundle!.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(compileBundle(world()).bundle!.hash).toBe(bundle!.hash);
  });

  it('hashes differently once anything about the world changes', () => {
    const changed = world({
      files: [file('world.sprout', `${ROOT}\nenum Season { spring }`)],
    });
    expect(compileBundle(changed).bundle!.hash).not.toBe(bundle!.hash);
  });

  it('carries every kind composed, the world’s objects and the tree they sit in', () => {
    const files = [
      file(
        'world.sprout',
        `${ROOT}\nkind Crate { contains }\nobject hall: Crate in printers_shop\nobject box: Crate in hall`,
      ),
    ];
    const { bundle: carried, diagnostics } = compileBundle(world({ files }));
    expect(refusals(diagnostics)).toEqual([]);
    expect(carried!.kinds.map((k) => [k.library, k.name, k.order])).toEqual([
      ['printers_shop', 'Visitor', ['sprout.Actor', 'printers_shop.Visitor']],
      ['printers_shop', 'Crate', ['printers_shop.Crate']],
      ['sprout', 'World', ['sprout.World']],
      ['sprout', 'Place', ['sprout.Place']],
      ['sprout', 'Actor', ['sprout.Actor']],
    ]);
    expect(carried!.objects.map((o) => [o.name, o.kind.order, o.container])).toEqual([
      ['hall', ['printers_shop.Crate', 'printers_shop.hall'], []],
      ['box', ['printers_shop.Crate', 'printers_shop.box'], ['hall']],
    ]);
    expect(carried!.tree.world).toBe('printers_shop');
    expect([...carried!.tree.placed.keys()]).toEqual(['hall', 'hall.box']);
  });

  it('carries the kinds by name as the checker found them, a failed kind of its own included', () => {
    const files = [file('world.sprout', `${ROOT}\nkind Place: Nowhere { contains actors }`)];
    const { bundle: loaded } = compileBundle(world({ files }), { mode: 'load' });
    const found = (name: string) => loaded!.kindLookup.unqualified(name, 'printers_shop');
    expect([found('Visitor')!.library, found('Actor')!.library]).toEqual([
      'printers_shop',
      'sprout',
    ]);
    // Its own `Place` did not compose, and is not read as the library's.
    expect(found('Place')).toBeNull();
    expect(loaded!.kindLookup.qualified('sprout', 'Place')!.name).toBe('Place');
  });

  it('carries the world composed, named for itself, and the kind its visitors are made of', () => {
    expect(bundle!.world!.order).toEqual(['sprout.World', 'printers_shop.printers_shop']);
    expect(bundle!.world!.containsActors).toBe(true);
    expect(bundle!.visitor!.order).toEqual(['sprout.Actor', 'printers_shop.Visitor']);
    // `sprout.Actor`'s hands arrive with it, by the ordinary property rules.
    expect([...bundle!.visitor!.properties.keys()]).toEqual(['capacity']);
  });

  it('roots the tree at the manifest’s name, not its namespace', () => {
    const files = [
      file('world.sprout', `${ROOT}\nkind Crate { contains }\nobject hall: Crate in printers_shop`),
    ];
    const { bundle: carried, diagnostics } = compileBundle(
      world({ files, manifest: { namespace: 'ink' } }),
    );
    expect(refusals(diagnostics)).toEqual([]);
    expect(carried!.tree.world).toBe('printers_shop');
    expect(carried!.objects.map((o) => [o.library, o.path])).toEqual([['ink', ['hall']]]);
  });

  it('carries the declarations it read, the world’s and its libraries’ alike', () => {
    // The union grows as the syntax lands; B27 fills the word set.
    expect(bundle!.definitions.map((d) => d.name.text)).toEqual([
      'printers_shop',
      'Visitor',
      'Season',
      'World',
      'Place',
      'Actor',
    ]);
    expect(bundle!.words).toEqual([]);
  });
});

describe('publishing is strict: any problem is a refusal', () => {
  it('is what a compile does when nothing says otherwise', () => {
    expect(compileBundle(world({ libraries: [] })).bundle).toBeNull();
    expect(compileBundle(world({ libraries: [] }), { mode: 'publish' }).bundle).toBeNull();
  });

  it('refuses a world with a file held back, because a world is not published in pieces', () => {
    const files = [file('world.sprout', WORLD_TEXT), file('kiln.sprout', 'enum Kiln { cold }')];
    const { bundle, diagnostics } = compileBundle(world({ files, withheld: ['kiln.sprout'] }), {
      mode: 'publish',
    });
    expect(bundle).toBeNull();
    expect(refusals(diagnostics)[0]!.message).toContain('withheld');
  });

  it('records no gaps, since a published world has none', () => {
    expect(compileBundle(world()).bundle!.absent).toEqual([]);
  });
});

describe('a compile checks the bodies of kinds, objects and the world', () => {
  it('refuses what an object’s and the world’s own guards get wrong', () => {
    const text = [
      WORLD_LINE.replace('}', 'depart (to) { destroy self } }'),
      'kind Visitor: sprout.Actor { }',
      'kind Crate { contains }',
      'object crate: Crate in printers_shop { accept (item, from) { refuse gone } }',
    ].join('\n');
    const { bundle, diagnostics } = compileBundle(world({ files: [file('world.sprout', text)] }));
    expect(bundle).toBeNull();
    expect(refusals(diagnostics).map((d) => [locationOf(d.at), d.message])).toEqual([
      [
        'world.sprout:1:121',
        '`destroy self` removes something, and a guard only reads and decides.',
      ],
      ['world.sprout:4:69', '`crate` has no passage `gone`.'],
    ]);
  });

  it('compiles a world whose guards read and decide', () => {
    const text = [
      WORLD_LINE,
      'kind Visitor: sprout.Actor { }',
      'kind Crate { contains :capacity 4 accept (item, from) { if (self.count >= self.get(:capacity)) { refuse full } } passage full { No room. } }',
      'object crate: Crate in printers_shop { depart (to) { if (mover != self) { refuse "Nailed down." } } }',
    ].join('\n');
    const { bundle, diagnostics } = compileBundle(world({ files: [file('world.sprout', text)] }));
    expect(refusals(diagnostics)).toEqual([]);
    const crate = bundle!.objects.find((object) => object.name === 'crate')!;
    expect(crate.kind.guards.accept.map((guard) => guard.origin)).toEqual(['printers_shop.Crate']);
    expect(crate.kind.guards.depart.map((guard) => guard.origin)).toEqual(['printers_shop.crate']);
  });
});
