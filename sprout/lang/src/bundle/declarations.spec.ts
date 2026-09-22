import { describe, expect, it } from 'vitest';

import type { Declaration } from '../syntax/ast.js';
import { Diagnostics } from '../source/diagnostics.js';
import { parseDeclarations } from '../syntax/parse.js';
import { locationOf, SourceFile } from '../source/source.js';
import { kindName } from '../declare/kinds.js';
import type { Absent } from './absent.js';
import { resolveDeclarations, type DeclarationReport } from './declarations.js';

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
      'shop',
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

  it('resolves the world’s own objects against every library’s kinds', () => {
    const report = loading();
    const { objects } = resolveDeclarations(
      byLibrary({
        sprout: 'kind Container { contains }',
        shop: 'object box: sprout.Container in hall',
      }),
      'shop',
      report,
    );
    expect(objects.map((o) => [o.name, o.kind.order])).toEqual([
      ['box', ['sprout.Container', 'shop.box']],
    ]);
  });

  it('leaves a library’s objects to the refusal that says a library declares none', () => {
    const { objects } = resolveDeclarations(
      byLibrary({ sprout: 'kind Box { }\nobject box: Box in hall', shop: '' }),
      'shop',
      loading(),
    );
    expect(objects).toEqual([]);
  });
});

describe('a kind nothing declares, named in a composition, is the absent table’s row', () => {
  it('is a gap under `kind-in-composition`, at the kind as written, and its object is absent', () => {
    const report = loading();
    const { objects, kinds } = resolveDeclarations(
      byLibrary({
        shop: 'kind Crate: victorian.Box { }\nobject crate: Crate in hall\nobject tea: Tin in hall',
      }),
      'shop',
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
  });
});
