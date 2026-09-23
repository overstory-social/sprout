import { describe, expect, it } from 'vitest';

import type { Declaration } from '../syntax/ast.js';
import { Diagnostics } from '../source/diagnostics.js';
import { parseDeclarations } from '../syntax/parse.js';
import { locationOf, SourceFile } from '../source/source.js';
import { kindName } from '../declare/kinds.js';
import type { Absent } from './absent.js';
import { resolveDeclarations, type DeclarationReport } from './declarations.js';

/** The world these tables are built for: its namespace and its name. */
const SHOP = { namespace: 'shop', name: 'shop' };

/** Every library's text, parsed, as a compile holds it. */
function byLibrary(libraries: Record<string, string>): Map<string, Declaration[]> {
  const parsing = new Diagnostics();
  const read = new Map(
    Object.entries(libraries).map(([library, text]) => [
      library,
      parseDeclarations(new SourceFile(`${library}.sprout`, text), parsing),
    ]),
  );
  expect(parsing.refusals, 'the fixture parses').toEqual([]);
  return read;
}

/** A report that records gaps as a load does. */
function loading(): DeclarationReport & { gaps: { absent: Absent; message: string }[] } {
  const gaps: { absent: Absent; message: string }[] = [];
  return {
    diagnostics: new Diagnostics(),
    gaps,
    gap: (absent, message) => gaps.push({ absent, message }),
  };
}

describe('every table is built over every library, in the order they depend on one another', () => {
  it('resolves a kind’s property against an enum another library declares', () => {
    const report = loading();
    const tables = resolveDeclarations(
      byLibrary({
        sprout: 'enum Ward { oak, silver }\nkind Warded { :ward Ward default oak }',
        shop: 'kind Gate: sprout.Warded { :ward silver }\nmessage :opened with sprout.Ward',
      }),
      SHOP,
      report,
    );
    expect(report.diagnostics.all).toEqual([]);
    expect(tables.enums.qualified('sprout', 'Ward')).not.toBeNull();
    expect(tables.messages.qualified('shop', 'opened')).not.toBeNull();
    expect(tables.kinds.all().map(kindName)).toEqual(['sprout.Warded', 'shop.Gate']);
    expect(tables.kinds.qualified('shop', 'Gate')!.properties.get('ward')!.origin).toBe(
      'shop.Gate',
    );
  });

  it('resolves the world’s own objects against every library’s kinds, and places them', () => {
    const report = loading();
    const { objects, tree } = resolveDeclarations(
      byLibrary({
        sprout: 'kind Container { contains }',
        shop: 'object hall: sprout.Container in shop\nobject box: sprout.Container in hall',
      }),
      SHOP,
      report,
    );
    expect(report.diagnostics.all).toEqual([]);
    expect(objects.map((o) => [o.name, o.kind.order, o.path])).toEqual([
      ['hall', ['sprout.Container', 'shop.hall'], ['hall']],
      ['box', ['sprout.Container', 'shop.box'], ['hall', 'box']],
    ]);
    expect([tree.world, [...tree.placed.keys()]]).toEqual(['shop', ['hall', 'hall.box']]);
  });

  it('roots the tree at the world’s name, which need not be its namespace', () => {
    const { objects, tree } = resolveDeclarations(
      byLibrary({ ink: 'kind Room { contains actors }\nobject hall: Room in printers_shop' }),
      { namespace: 'ink', name: 'printers_shop' },
      loading(),
    );
    expect(tree.world).toBe('printers_shop');
    expect(objects.map((o) => [o.library, o.name, o.container])).toEqual([['ink', 'hall', []]]);
  });

  it('resolves every library’s verbs after the kinds their roles name', () => {
    const report = loading();
    const { verbs } = resolveDeclarations(
      byLibrary({
        sprout:
          'verb give { role item  role recipient: Actor  "give [item] to [recipient]" }\nkind Actor { contains }',
        shop: 'verb unlock { role target: Lock  "unlock [target]" }\nkind Lock: sprout.Actor { }',
      }),
      SHOP,
      report,
    );
    expect(report.diagnostics.all).toEqual([]);
    const kindOf = (library: string, verb: string): string | null => {
      const filler = verbs.qualified(library, verb)!.roles.at(-1)!.filler;
      return filler?.fills === 'kind' ? kindName(filler.kind) : null;
    };
    expect(kindOf('sprout', 'give')).toBe('sprout.Actor');
    expect(kindOf('shop', 'unlock')).toBe('shop.Lock');
    expect(verbs.unqualified('give', 'shop')!.library).toBe('sprout');
  });

  it('leaves a library’s objects to the refusal that says a library declares none', () => {
    const { objects } = resolveDeclarations(
      byLibrary({ sprout: 'kind Box { }\nobject box: Box in hall', shop: '' }),
      SHOP,
      loading(),
    );
    expect(objects).toEqual([]);
  });
});

describe('a world declaration shadowing a standard library name warns once, at its own name', () => {
  it('warns for a kind, an enum and a message the standard library also declares', () => {
    const report = loading();
    const tables = resolveDeclarations(
      byLibrary({
        sprout: 'kind Container { contains }\nenum Ward { oak, silver }\nmessage :opened',
        shop: 'kind Container { }\nenum Ward { brass }\nmessage :opened',
      }),
      SHOP,
      report,
    );
    expect(report.diagnostics.warnings.map((d) => [locationOf(d.at), d.message, d.remedy])).toEqual(
      [
        [
          'shop.sprout:1:6',
          '`Container` hides `sprout.Container`: a bare `Container` in this world is now yours.',
          "Write `sprout.Container` where the library's is meant, or give yours another name.",
        ],
        [
          'shop.sprout:2:6',
          '`Ward` hides `sprout.Ward`: a bare `Ward` in this world is now yours.',
          "Write `sprout.Ward` where the library's is meant, or give yours another name.",
        ],
        [
          'shop.sprout:3:9',
          '`opened` hides `sprout.opened`: a bare `opened` in this world is now yours.',
          "Write `sprout.opened` where the library's is meant, or give yours another name.",
        ],
      ],
    );
    // The qualified name still reaches the library's kind after the shadow.
    expect(tables.kinds.qualified('sprout', 'Container')!.library).toBe('sprout');
  });

  it('warns for a verb the standard library also declares, and says how the library’s is kept', () => {
    const report = loading();
    const { verbs } = resolveDeclarations(
      byLibrary({
        sprout: 'verb take { role target  "take [target]" }',
        shop: 'verb take { role target  "nab [target]" }',
      }),
      SHOP,
      report,
    );
    expect(report.diagnostics.warnings.map((d) => [locationOf(d.at), d.message, d.remedy])).toEqual(
      [
        [
          'shop.sprout:1:6',
          '`take` hides `sprout.take`: a bare `take` in this world is now yours.',
          "Where the library's `take` is still meant, give yours another name.",
        ],
      ],
    );
    expect(verbs.unqualified('take', 'shop')!.library).toBe('shop');
    expect(verbs.qualified('sprout', 'take')).not.toBeNull();
  });

  it('does not warn for an engine verb’s name, which is refused and hides nothing', () => {
    const report = loading();
    resolveDeclarations(
      byLibrary({ sprout: 'verb look { "look" }', shop: 'verb look { "peer" }' }),
      SHOP,
      report,
    );
    expect(report.diagnostics.warnings).toEqual([]);
    expect(report.diagnostics.refusals.map((d) => locationOf(d.at))).toEqual(['shop.sprout:1:6']);
  });

  it('does not warn for a name only a second library declares: it is reachable only qualified', () => {
    const report = loading();
    resolveDeclarations(
      byLibrary({ textiles: 'kind Bolt { }', shop: 'kind Bolt { }' }),
      SHOP,
      report,
    );
    expect(report.diagnostics.warnings).toEqual([]);
  });

  it('does not warn on the standard library’s own declarations of themselves', () => {
    const report = loading();
    resolveDeclarations(
      byLibrary({ sprout: 'kind Container { contains }' }),
      { namespace: 'sprout', name: 'sprout' },
      report,
    );
    expect(report.diagnostics.warnings).toEqual([]);
  });
});

describe('a kind nothing declares, named in a composition, is the absent table’s row', () => {
  it('is a gap under `kind-in-composition`, at the kind as written, and its object is absent', () => {
    const report = loading();
    const { objects, kinds, tree } = resolveDeclarations(
      byLibrary({
        shop: 'kind Crate: victorian.Box { }\nobject crate: Crate in shop\nobject tea: Tin in crate',
      }),
      SHOP,
      report,
    );
    expect(
      report.gaps.map(({ absent, message }) => [
        absent.what,
        absent.kind,
        absent.reason,
        locationOf(absent.at!),
        message,
      ]),
    ).toEqual([
      [
        'victorian.Box',
        'kind-in-composition',
        'missing',
        'shop.sprout:1:13',
        'Nothing here is a `victorian.Box`.',
      ],
      ['Tin', 'kind-in-composition', 'missing', 'shop.sprout:3:13', 'Nothing here is a `Tin`.'],
    ]);
    expect(report.gaps[0]!.absent.consequence).toContain('the object is absent');
    expect(objects).toEqual([]);
    expect(kinds.all()).toEqual([]);
    expect(report.diagnostics.all).toEqual([]);
    // Still placed, so what it holds keeps its place for when the kind returns.
    expect([...tree.placed.keys()]).toEqual(['crate', 'crate.tea']);
  });
});

describe('a kind nothing declares, named in a role, is the absent table’s `kind-in-role` row', () => {
  it('is a gap at the kind as written, and the role fills nothing', () => {
    const report = loading();
    const { verbs } = resolveDeclarations(
      byLibrary({
        sprout: 'kind Lockable { }',
        shop: 'verb unlock { role target: Lockabel  role tool: victorian.Key  "unlock [target] with [tool]" }',
      }),
      SHOP,
      report,
    );
    expect(
      report.gaps.map(({ absent, message }) => [
        absent.what,
        absent.kind,
        absent.reason,
        locationOf(absent.at!),
        absent.consequence,
        message,
      ]),
    ).toEqual([
      [
        'Lockabel',
        'kind-in-role',
        'missing',
        'shop.sprout:1:28',
        'nothing fills the role; the verb’s phrases do not match',
        'Nothing here is a `Lockabel`. Did you mean `Lockable`?',
      ],
      [
        'victorian.Key',
        'kind-in-role',
        'missing',
        'shop.sprout:1:49',
        'nothing fills the role; the verb’s phrases do not match',
        'Nothing here is a `victorian.Key`.',
      ],
    ]);
    expect(report.diagnostics.all).toEqual([]);
    expect(verbs.qualified('shop', 'unlock')!.roles.map((r) => r.filler)).toEqual([null, null]);
  });
});

describe('a container nothing answers to is the absent table’s `container` row', () => {
  it('is a gap at the step, the object is absent, and what it holds goes unsaid', () => {
    const report = loading();
    const { objects, tree } = resolveDeclarations(
      byLibrary({
        shop: 'kind Room { contains actors }\nobject hall: Room in shop\nobject bench: Room in hal\nobject leg: Room in hall.bench',
      }),
      SHOP,
      report,
    );
    expect(
      report.gaps.map(({ absent, message }) => [
        absent.what,
        absent.kind,
        absent.reason,
        locationOf(absent.at!),
        absent.consequence,
        message,
      ]),
    ).toEqual([
      [
        'hal',
        'container',
        'missing',
        'shop.sprout:3:23',
        'the object is absent: not in range, not listed, not addressable; what it holds is unreachable until its container returns',
        'Nothing here is called `hal`. Did you mean `hall`?',
      ],
    ]);
    expect(objects.map((o) => o.name)).toEqual(['hall']);
    expect([...tree.placed.keys()]).toEqual(['hall']);
    expect(report.diagnostics.all).toEqual([]);
  });

  it('is not what a ring is: that is refused whatever the mode', () => {
    const report = loading();
    resolveDeclarations(
      byLibrary({ shop: 'kind Box { contains }\nobject a: Box in b\nobject b: Box in a' }),
      SHOP,
      report,
    );
    expect(report.gaps).toEqual([]);
    expect(report.diagnostics.refusals.map((d) => d.message)).toEqual([
      '`a` is in `b`, which is in `a`.',
    ]);
  });
});
