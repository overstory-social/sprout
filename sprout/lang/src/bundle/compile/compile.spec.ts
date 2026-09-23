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
import {
  file,
  HALL,
  refusals,
  ROOT,
  rootWith,
  VISITOR,
  WORLD_TEXT,
  world,
} from '../../fixtures/compile.js';
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
        `${rootWith('object crate is Crate { object box is Crate }')}\nkind Crate { contains }`,
      ),
    ];
    const { bundle: carried, diagnostics } = compileBundle(world({ files }));
    expect(refusals(diagnostics)).toEqual([]);
    expect(carried!.kinds.map((k) => [k.library, k.name, k.order])).toEqual([
      ['printers_shop', 'Person', ['sprout.Actor', 'sprout.Visitor', 'printers_shop.Person']],
      ['printers_shop', 'Crate', ['printers_shop.Crate']],
      ['sprout', 'World', ['sprout.World']],
      ['sprout', 'Place', ['sprout.Place']],
      ['sprout', 'Actor', ['sprout.Actor']],
      ['sprout', 'Visitor', ['sprout.Actor', 'sprout.Visitor']],
    ]);
    expect(carried!.objects.map((o) => [o.name, o.kind.order, o.container])).toEqual([
      ['hall', ['sprout.Place', 'printers_shop.hall'], []],
      ['crate', ['printers_shop.Crate', 'printers_shop.crate'], []],
      ['box', ['printers_shop.Crate', 'printers_shop.box'], ['crate']],
    ]);
    expect(carried!.tree.world).toBe('printers_shop');
    expect([...carried!.tree.placed.keys()]).toEqual(['hall', 'crate', 'crate.box']);
  });

  it('carries the kinds by name as the checker found them, a failed kind of its own included', () => {
    const files = [file('world.sprout', `${ROOT}\nkind Place is Nowhere { contains actors }`)];
    const { bundle: loaded } = compileBundle(world({ files }), { mode: 'load' });
    const found = (name: string) => loaded!.kindLookup.unqualified(name, 'printers_shop');
    expect([found('Person')!.library, found('Actor')!.library]).toEqual([
      'printers_shop',
      'sprout',
    ]);
    // Its own `Place` did not compose, and is not read as the library's.
    expect(found('Place')).toBeNull();
    expect(loaded!.kindLookup.qualified('sprout', 'Place')!.name).toBe('Place');
  });

  it('carries the verbs resolved, found by name as a body names one, its own before the library’s', () => {
    const files = [
      file(
        'world.sprout',
        `${ROOT}\nverb take { role target "grab [target]" }\nverb poke { role target "poke [target]" }`,
      ),
    ];
    const { bundle: carried, diagnostics } = compileBundle(world({ files }));
    expect(refusals(diagnostics)).toEqual([]);
    const verbs = carried!.verbs;
    expect(verbs.unqualified('poke', 'printers_shop')!.roles.map((r) => r.name)).toEqual([
      'target',
    ]);
    // The world's own `take` shadows the library's for a bare name, and both are there by identity.
    expect(verbs.unqualified('take', 'printers_shop')!.library).toBe('printers_shop');
    expect(verbs.qualified('sprout', 'take')!.phrases.map((p) => p.text)).toContain(
      'pick up [target]',
    );
    expect(verbs.unqualified('ask', 'printers_shop')!.library).toBe('sprout');
    expect(verbs.qualified('printers_shop', 'dance')).toBeNull();
  });

  it('carries the world composed, named for itself, and the kind its visitors are made of', () => {
    expect(bundle!.world!.order).toEqual(['sprout.World', 'printers_shop.printers_shop']);
    // `sprout.World` holds things and not people; visitors arrive in `hall`.
    expect([bundle!.world!.contains, bundle!.world!.containsActors]).toEqual([true, false]);
    expect(bundle!.visitor!.order).toEqual([
      'sprout.Actor',
      'sprout.Visitor',
      'printers_shop.Person',
    ]);
    // `sprout.Actor`'s hands arrive with it, by the ordinary property rules.
    expect([...bundle!.visitor!.properties.keys()]).toEqual(['capacity']);
  });

  it('roots the tree at the manifest’s name, not its namespace', () => {
    const files = [
      file('world.sprout', `${rootWith('object crate is Crate')}\nkind Crate { contains }`),
    ];
    const { bundle: carried, diagnostics } = compileBundle(
      world({ files, manifest: { namespace: 'ink' } }),
    );
    expect(refusals(diagnostics)).toEqual([]);
    expect(carried!.tree.world).toBe('printers_shop');
    expect(carried!.objects.map((o) => [o.library, o.path])).toEqual([
      ['ink', ['hall']],
      ['ink', ['crate']],
    ]);
  });

  it('carries the declarations it read, the world’s and its libraries’ alike', () => {
    // The union grows as the syntax lands; B27 fills the word set. An
    // object is not among them: it is in the world's body.
    expect(bundle!.definitions.map((d) => d.name.text)).toEqual([
      'printers_shop',
      'Person',
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
      'Visitor',
      'ask',
    ]);
    expect(bundle!.words).toEqual([]);
  });
});

describe('what a compiled bundle knows of its bodies', () => {
  it('records what each name a body writes reaches, and the messages a send reaches them in', () => {
    const files = [
      file(
        'world.sprout',
        `${rootWith('object bell is Bell')}
message :rang
kind Bell { on :rang { send hall :rang } }`,
      ),
    ];
    const { bundle, diagnostics } = compileBundle(world({ files }));
    expect(refusals(diagnostics)).toEqual([]);
    expect(bundle!.messages.qualified('printers_shop', 'rang')).not.toBeNull();
    expect([...bundle!.names.values()]).toContainEqual(
      expect.objectContaining({ names: 'declared', path: ['hall'] }),
    );
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
      'world printers_shop is sprout.World {',
      '  visitors are Person',
      '  visitors arrive at hall',
      '  depart (to) { destroy self }',
      `  ${HALL}`,
      '  object crate is Crate { accept (item, from) { refuse gone } }',
      '}',
      'kind Person is sprout.Visitor { }',
      'kind Crate { contains }',
    ].join('\n');
    const { bundle, diagnostics } = compileBundle(world({ files: [file('world.sprout', text)] }));
    expect(bundle).toBeNull();
    expect(refusals(diagnostics).map((d) => [locationOf(d.at), d.message])).toEqual([
      [
        'world.sprout:4:17',
        '`destroy self` removes something, and a guard only reads and decides.',
      ],
      ['world.sprout:6:56', '`crate` has no passage `gone`.'],
    ]);
  });

  it('checks what a kind’s body holds once, however many instances are given it', () => {
    const text = [
      rootWith('object red is Chest object blue is Chest'),
      'kind Chest { contains object lid is Lid { accept (item, from) { refuse gone } } }',
      'kind Lid { contains }',
      'kind Unused { contains object latch is Lid { accept (item, from) { refuse stuck } } }',
    ].join('\n');
    const { bundle, diagnostics } = compileBundle(world({ files: [file('world.sprout', text)] }));
    expect(bundle).toBeNull();
    expect(refusals(diagnostics).map((d) => d.message)).toEqual([
      '`lid` has no passage `gone`.',
      '`latch` has no passage `stuck`.',
    ]);
  });

  it('carries what each kind’s body gives, and places a copy in every declared instance', () => {
    const text = [
      rootWith('object red is Chest'),
      'kind Chest { contains object lid is Lid }',
      'kind Lid { }',
    ].join('\n');
    const { bundle, diagnostics } = compileBundle(world({ files: [file('world.sprout', text)] }));
    expect(refusals(diagnostics)).toEqual([]);
    expect(bundle!.contents.get('printers_shop.Chest')!.map((one) => one.path)).toEqual([['lid']]);
    expect(bundle!.tree.placed.has('red.lid')).toBe(true);
    expect(bundle!.objects.map((object) => object.name)).toEqual(['hall', 'red']);
  });

  it('compiles a world whose guards read and decide', () => {
    const text = [
      rootWith(
        'object crate is Crate { depart (to) { if (mover != self) { refuse "Nailed down." } } }',
      ),
      'kind Crate { contains :capacity 4 accept (item, from) { if (self.count >= self.get(:capacity)) { refuse full } } passage full { No room. } }',
    ].join('\n');
    const { bundle, diagnostics } = compileBundle(world({ files: [file('world.sprout', text)] }));
    expect(refusals(diagnostics)).toEqual([]);
    const crate = bundle!.objects.find((object) => object.name === 'crate')!;
    expect(crate.kind.guards.accept.map((guard) => guard.origin)).toEqual(['printers_shop.Crate']);
    expect(crate.kind.guards.depart.map((guard) => guard.origin)).toEqual(['printers_shop.crate']);
  });
});

describe('a compile refuses actors where the spec has none', () => {
  const text = [
    'world printers_shop is sprout.World {',
    '  visitors are Person',
    '  visitors arrive at hall',
    '  object hall is sprout.Place {',
    '    object basket is Basket { object cat is Porter }',
    '    object guest is Person',
    '    object porter is Porter',
    '  }',
    '  object ghost is Porter',
    '}',
    VISITOR,
    'kind Porter is sprout.Actor { }',
    'kind Basket { contains }',
  ].join('\n');

  it('refuses, in either mode, a declared visitor and an NPC where no actors stand', () => {
    for (const mode of ['publish', 'load'] as const) {
      const { bundle, diagnostics } = compileBundle(
        world({ files: [file('world.sprout', text)] }),
        { mode },
      );
      expect(bundle, mode).toBeNull();
      expect(
        refusals(diagnostics).map((d) => [locationOf(d.at), d.message]),
        mode,
      ).toEqual([
        ['world.sprout:5:38', '`basket` holds no actors, so `cat` cannot stand in it.'],
        [
          'world.sprout:6:12',
          '`guest` composes `sprout.Visitor`, what a person is made of, and nothing declares a visitor: each one is a person who arrives.',
        ],
        [
          'world.sprout:9:10',
          '`printers_shop` is the world, which holds no actors, so `ghost` cannot stand directly in it.',
        ],
      ]);
    }
  });

  it('refuses a spawn of what visitors are made of, and takes an NPC’s kind', () => {
    const verbs = [
      rootWith('object horn is Horn'),
      'kind Porter is sprout.Actor { }',
      'verb whistle { role target  "whistle at [target]" }',
      'kind Horn { as target for whistle { do { spawn Porter in here  spawn Person in here } } }',
    ].join('\n');
    const { diagnostics } = compileBundle(world({ files: [file('world.sprout', verbs)] }));
    expect(refusals(diagnostics).map((d) => [locationOf(d.at), d.message])).toEqual([
      [
        'world.sprout:4:70',
        '`Person` composes `sprout.Visitor`, what a person is made of, and nothing spawns a visitor: each one is a person who arrives.',
      ],
    ]);
  });
});
