// The warning for a passage on an object or the world that nothing
// invokes and nothing it composes declares (the spec's What it warns about).

import { describe, expect, it } from 'vitest';

import type { KindDeclaration } from '../../syntax/ast.js';
import { Diagnostics } from '../../source/diagnostics.js';
import { parseDeclarations } from '../../syntax/parse.js';
import { locationOf, SourceFile } from '../../source/source.js';
import { EnumTable } from '../../declare/enums.js';
import { kindName, KindTable, type KindRef } from '../../declare/kinds.js';
import type { ResolvedPassage } from '../../declare/passages.js';
import type { Vantage } from '../../declare/names.js';
import { warnUnheard } from './unheard.js';

const KINDS = `kind Plain { passage greeting { Hello. } }
kind Mirror is Plain {
  passage greetin { Hi. }
  passage greeting { Well met. }
  passage aside { Psst. }
}`;

/** The kinds of `KINDS`, composed in `shop`. */
function composed(): KindTable {
  const setup = new Diagnostics();
  const declared = parseDeclarations(new SourceFile('shop.sprout', KINDS), setup);
  const kinds = new KindTable();
  kinds.add(
    'shop',
    declared.filter((d): d is KindDeclaration => d.kind === 'kind'),
    setup,
  );
  kinds.resolve('shop', new EnumTable(), setup);
  expect(
    setup.refusals.map((d) => d.message),
    'the fixture composes',
  ).toEqual([]);
  return kinds;
}

/** What the warning says of `Mirror` written from `vantage`, with `heard` the passages something says. */
function warned(vantage: Vantage, heard: readonly string[] = [], namespace = 'shop'): string[] {
  const kinds = composed();
  const mirror: KindRef = kinds.qualified('shop', 'Mirror')!;
  const unheard = new Set<ResolvedPassage>(
    [...mirror.passages.values()].filter((passage) => !heard.includes(passage.name)),
  );
  const diagnostics = new Diagnostics();
  warnUnheard({ written: [{ kind: mirror, vantage }], unheard, kinds, namespace, diagnostics });
  expect(diagnostics.refusals).toEqual([]);
  return diagnostics.all.map((d) => `${locationOf(d.at)} ${d.message} ${d.remedy}`);
}

const OBJECT: Vantage = { in: 'tree', path: ['hall', 'mirror'] };

describe('a passage on an object that nothing says', () => {
  it('is warned about at its name, with the line it most likely meant to replace', () => {
    expect(warned(OBJECT)).toEqual([
      "shop.sprout:3:11 Nothing says `greetin`, and nothing `hall.mirror` is made of has a passage of that name for it to replace. Did you mean `greeting`? Write `passage greeting { … }` to replace that line, or say this one by name where it should be heard, as in `say greetin` in a role's `do`.",
      "shop.sprout:5:11 Nothing says `aside`, and nothing `hall.mirror` is made of has a passage of that name for it to replace. Say it by name where it should be heard, as in `say aside` in a role's `do`, or take it out.",
    ]);
  });

  it('is not warned about where something says it, or where it replaces what the object is made of', () => {
    expect(warned(OBJECT, ['greetin', 'aside'])).toEqual([]);
  });

  it('is warned about on the world, and on what a kind gives its instances, by its path', () => {
    expect(warned({ in: 'tree', path: [] }, ['greetin'])[0]).toContain(
      'nothing `Mirror` is made of',
    );
    const lantern = composed().qualified('shop', 'Plain')!;
    const given: Vantage = { in: 'kind', giver: 'shop.Plain', path: ['glass'], self: lantern };
    expect(warned(given, ['greetin'])[0]).toContain('nothing `glass` is made of');
  });

  it('leaves a named kind’s passages, which what composes it may say, and a library’s objects', () => {
    const kinds = composed();
    const mirror = kinds.qualified('shop', 'Mirror')!;
    expect(warned({ in: 'kind', giver: kindName(mirror), path: [], self: mirror })).toEqual([]);
    expect(warned(OBJECT, [], 'elsewhere')).toEqual([]);
  });
});
