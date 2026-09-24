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
  WORLD_LINE,
  WORLD_TEXT,
  world,
  worldFiles,
  worldLine,
} from '../../fixtures/compile.js';
import { locationOf, textOf } from '../../source/source.js';

describe('what a compiled bundle carries', () => {
  const { bundle } = compileBundle(world());

  it('holds each slot of prose that renders an option, wherever the slot is written', () => {
    const files = [
      file(
        'printers_shop.sprout',
        worldLine(
          'passage season { {self.get(:season)} and {self.get(:note)}. } :season Season default autumn :note "x"',
        ),
      ),
      ...worldFiles(WORLD_TEXT).slice(1),
    ];
    const withEnum = files.map((one) =>
      one.name === 'printers_shop.sprout'
        ? file(
            'printers_shop.sprout',
            `${one.text}\nenum Season { spring, summer, autumn, winter }`,
          )
        : one,
    );
    const compiled = compileBundle(world({ files: withEnum }));
    expect(refusals(compiled.diagnostics)).toEqual([]);
    expect([...compiled.bundle!.optionSlots].map((slot) => textOf(slot.at))).toEqual([
      '{self.get(:season)}',
    ]);
  });

  it('reads a passage its kind lacks at load as a gap where its `.prose` file is gone, and refuses it at publish once', () => {
    const files = [
      file('printers_shop.sprout', `${WORLD_LINE}\nverb peer { role target  "peer at [target]" }`),
      ...worldFiles(WORLD_TEXT).slice(1),
      file(
        'mirror.sprout',
        'kind Mirror {\n  prose "mirror.prose"\n  as target for peer { do { say greeting } }\n}\n',
      ),
      file('mirror.prose', 'passage greeting { Hi. }\n'),
    ];
    const load = compileBundle(world({ files, withheld: ['mirror.prose'] }), { mode: 'load' });
    expect(refusals(load.diagnostics)).toEqual([]);
    expect(load.bundle!.absent.map((gap) => [gap.what, gap.kind])).toEqual([
      ['mirror.prose', 'file'],
      ['greeting', 'passage'],
    ]);
    const publish = compileBundle(world({ files, withheld: ['mirror.prose'] }));
    expect(refusals(publish.diagnostics).map((d) => d.message)).toEqual([
      'The file "mirror.prose" is being withheld.',
    ]);
  });

  it('refuses at publish a description its gone `.prose` file leaves empty, and loads it with its gaps', () => {
    const files = [
      file('printers_shop.sprout', `${WORLD_LINE.replace(' }', ' object mirror is Mirror }')}`),
      ...worldFiles(WORLD_TEXT).slice(1),
      file(
        'mirror.sprout',
        'kind Mirror {\n  prose "mirror.prose"\n  describe { text greeting }\n}\n',
      ),
      file('mirror.prose', 'passage greeting { Hi. }\n'),
    ];
    const publish = compileBundle(world({ files, withheld: ['mirror.prose'] }));
    expect(refusals(publish.diagnostics).map((d) => [locationOf(d.at), d.message])).toEqual([
      [
        'mirror.sprout:3:3',
        "This `describe` says nothing while `Mirror`'s `.prose` file is absent: every `text` in it names a passage that file holds.",
      ],
      ['sprout.json:9:3', 'The file "mirror.prose" is being withheld.'],
    ]);
    const load = compileBundle(world({ files, withheld: ['mirror.prose'] }), { mode: 'load' });
    expect(refusals(load.diagnostics)).toEqual([]);
    expect(load.bundle!.absent.map((gap) => [gap.what, gap.kind])).toEqual([
      ['mirror.prose', 'file'],
      ['greeting', 'passage'],
    ]);
  });

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
      files: worldFiles(`${WORLD_LINE}\nenum Season { spring }`),
    });
    expect(compileBundle(changed).bundle!.hash).not.toBe(bundle!.hash);
  });

  it('carries every kind composed, the world’s objects and the tree they sit in', () => {
    const files = worldFiles(
      worldLine('object crate is Crate { object box is Crate }'),
      'kind Crate { contains }',
    );
    const { bundle: carried, diagnostics } = compileBundle(world({ files }));
    expect(refusals(diagnostics)).toEqual([]);
    expect(carried!.kinds.map((k) => [k.library, k.name, k.order])).toEqual([
      ['printers_shop', 'Person', ['sprout.Actor', 'sprout.Visitor', 'printers_shop.Person']],
      ['printers_shop', 'Crate', ['printers_shop.Crate']],
      ['sprout', 'World', ['sprout.World']],
      ['sprout', 'Place', ['sprout.Place']],
      ['sprout', 'Actor', ['sprout.Actor']],
      ['sprout', 'Visitor', ['sprout.Actor', 'sprout.Visitor']],
      ['sprout', 'Fixture', ['sprout.Fixture']],
      ['sprout', 'Container', ['sprout.Container']],
      ['sprout', 'Lockable', ['sprout.Lockable']],
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
    const files = worldFiles(WORLD_LINE, 'kind Place is Nowhere { contains actors }');
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
    const files = worldFiles(
      `${WORLD_LINE}\nverb take { role target "grab [target]" }\nverb poke { role target "poke [target]" }`,
    );
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
    const files = worldFiles(worldLine('object crate is Crate'), 'kind Crate { contains }');
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
    // The union grows as the syntax lands. An object is not among them:
    // it is in the world's body.
    expect(bundle!.definitions.map((d) => d.name.text)).toEqual([
      'printers_shop',
      'Season',
      'Person',
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
      'put',
      'give',
      'Actor',
      'Visitor',
      'Fixture',
      'open',
      'close',
      'Container',
      'unlock',
      'Lockable',
      'ask',
    ]);
    // The word set holds what the grammar reads: here, the hall and the
    // phrases, directions and articles, and no kind the world or a
    // person is made of, since nothing spawns one.
    expect(bundle!.words).toContain('hall');
    expect(bundle!.words).toContain('take');
    expect(bundle!.words).not.toContain('world');
    expect(bundle!.words).not.toContain('person');
  });
});

describe('what a compiled bundle knows of its bodies', () => {
  it('records what each name a body writes reaches, and the messages a send reaches them in', () => {
    const files = worldFiles(
      `${worldLine('object bell is Bell')}\nmessage :rang`,
      'kind Bell { on :rang { send hall :rang  send printers_shop.hall :rang } }',
    );
    const { bundle, diagnostics } = compileBundle(world({ files }));
    expect(refusals(diagnostics)).toEqual([]);
    expect(bundle!.messages.qualified('printers_shop', 'rang')).not.toBeNull();
    const names = [...bundle!.names.values()];
    // From a kind's body, a bare name is the run's to resolve; the world's name fixes one.
    expect(names).toContainEqual(
      expect.objectContaining({
        names: 'placed',
        candidates: [expect.objectContaining({ steps: [{ in: 'tree', path: ['hall'] }] })],
      }),
    );
    expect(names).toContainEqual(expect.objectContaining({ names: 'declared', path: ['hall'] }));
  });
});

describe('publishing is strict: any problem is a refusal', () => {
  it('is what a compile does when nothing says otherwise', () => {
    expect(compileBundle(world({ libraries: [] })).bundle).toBeNull();
    expect(compileBundle(world({ libraries: [] }), { mode: 'publish' }).bundle).toBeNull();
  });

  it('refuses a world with a file held back, because a world is not published in pieces', () => {
    const files = [...worldFiles(WORLD_TEXT), file('kiln.sprout', 'enum Kiln { cold }')];
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

describe('a default of another type is refused once, in either mode', () => {
  const files = worldFiles(
    WORLD_LINE,
    'kind Kiln is sprout.Place {\n  :hatch Season default "autumn"\n  on :entered (item, from) { self.set(:hatch, :winter) if (self.get(:hatch) == :spring) { tell "Spring." } }\n}',
  ).map((one) =>
    one.name === 'printers_shop.sprout'
      ? file('printers_shop.sprout', `${one.text}\nenum Season { spring, summer, autumn, winter }`)
      : one,
  );

  it('says it at the default and nowhere the property is used', () => {
    const { diagnostics } = compileBundle(world({ files }));
    expect(refusals(diagnostics).map((one) => locationOf(one.at))).toEqual(['kiln.sprout:2:25']);
  });

  it('refuses at load too, so no instance ever starts at a value its property does not hold', () => {
    const { bundle, diagnostics } = compileBundle(world({ files }), { mode: 'load' });
    expect(bundle).toBeNull();
    expect(refusals(diagnostics).map((one) => locationOf(one.at))).toEqual(['kiln.sprout:2:25']);
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
    ].join('\n');
    const files = worldFiles(text, 'kind Crate { contains }');
    const { bundle, diagnostics } = compileBundle(world({ files }));
    expect(bundle).toBeNull();
    expect(refusals(diagnostics).map((d) => [locationOf(d.at), d.message])).toEqual([
      [
        'printers_shop.sprout:4:17',
        '`destroy self` removes something, and a guard only reads and decides.',
      ],
      ['printers_shop.sprout:6:56', '`crate` has no passage `gone`.'],
    ]);
  });

  it('checks what a kind’s body holds once, however many instances are given it', () => {
    const files = worldFiles(
      worldLine('object red is Chest object blue is Chest'),
      'kind Chest { contains object lid is Lid { accept (item, from) { refuse gone } } }',
      'kind Lid { contains }',
      'kind Unused { contains object latch is Lid { accept (item, from) { refuse stuck } } }',
    );
    const { bundle, diagnostics } = compileBundle(world({ files }));
    expect(bundle).toBeNull();
    expect(refusals(diagnostics).map((d) => d.message)).toEqual([
      '`lid` has no passage `gone`.',
      '`latch` has no passage `stuck`.',
    ]);
  });

  it('carries what each kind’s body gives, and places a copy in every declared instance', () => {
    const files = worldFiles(
      worldLine('object red is Chest'),
      'kind Chest { contains object lid is Lid }',
      'kind Lid { }',
    );
    const { bundle, diagnostics } = compileBundle(world({ files }));
    expect(refusals(diagnostics)).toEqual([]);
    expect(bundle!.contents.get('printers_shop.Chest')!.map((one) => one.path)).toEqual([['lid']]);
    expect(bundle!.tree.placed.has('red.lid')).toBe(true);
    expect(bundle!.objects.map((object) => object.name)).toEqual(['hall', 'red']);
  });

  it('compiles a world whose guards read and decide', () => {
    const files = worldFiles(
      worldLine(
        'object crate is Crate { depart (to) { if (mover != self) { refuse "Nailed down." } } }',
      ),
      'kind Crate { contains :capacity 4 accept (item, from) { if (self.count >= self.get(:capacity)) { refuse full } } passage full { No room. } }',
    );
    const { bundle, diagnostics } = compileBundle(world({ files }));
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
  ].join('\n');
  const files = worldFiles(text, 'kind Porter is sprout.Actor { }', 'kind Basket { contains }');

  it('refuses, in either mode, a declared visitor and an NPC where no actors stand', () => {
    for (const mode of ['publish', 'load'] as const) {
      const { bundle, diagnostics } = compileBundle(world({ files }), { mode });
      expect(bundle, mode).toBeNull();
      expect(
        refusals(diagnostics).map((d) => [locationOf(d.at), d.message]),
        mode,
      ).toEqual([
        ['printers_shop.sprout:5:38', '`basket` holds no actors, so `cat` cannot stand in it.'],
        [
          'printers_shop.sprout:6:12',
          '`guest` composes `sprout.Visitor`, what a person is made of, and nothing declares a visitor: each one is a person who arrives.',
        ],
        [
          'printers_shop.sprout:9:10',
          '`printers_shop` is the world, which holds no actors, so `ghost` cannot stand directly in it.',
        ],
      ]);
    }
  });

  it('refuses a spawn of what visitors are made of, and takes an NPC’s kind', () => {
    const files = worldFiles(
      `${worldLine('object horn is Horn')}\nverb whistle { role target  "whistle at [target]" }`,
      'kind Porter is sprout.Actor { }',
      'kind Horn { as target for whistle { do { spawn Porter in here  spawn Person in here } } }',
    );
    const { diagnostics } = compileBundle(world({ files }));
    expect(refusals(diagnostics).map((d) => [locationOf(d.at), d.message])).toEqual([
      [
        'horn.sprout:1:70',
        '`Person` composes `sprout.Visitor`, what a person is made of, and nothing spawns a visitor: each one is a person who arrives.',
      ],
    ]);
  });
});

describe('the warning for a verb nobody speaks for', () => {
  const PULL = 'verb pull { role target  "pull [target]" }';
  const unsaid = (lever: string) =>
    compileBundle(
      world({ files: worldFiles(`${worldLine('object lever is Lever')}\n${PULL}`, lever) }),
    ).diagnostics.map((d) => [d.severity, d.message]);

  it('is said of a bundle that checks', () => {
    expect(unsaid('kind Lever { as target for pull { do { tell "It gives." } } }')).toEqual([
      [
        'warning',
        "Nothing that takes part in `pull` ever `say`s anything, so typing it is answered with the world's `nothing_happens`.",
      ],
    ]);
  });

  it('is not said of a refused one, which is missing what was refused', () => {
    // The lever's file does not read, so nothing is a `Lever` and nothing plays `pull`.
    expect(unsaid('kind Lever { as target for pull { do { say 4 } } }')).toEqual([
      ['refusal', '`say` says something.'],
      ['refusal', 'Nothing here is a `Lever`.'],
    ]);
  });
});
