import { describe, expect, it } from 'vitest';

import type { KindDeclaration, ObjectDeclaration } from '../syntax/ast.js';
import { Diagnostics } from '../source/diagnostics.js';
import { parseDeclarations } from '../syntax/parse.js';
import { locationOf, SourceFile } from '../source/source.js';
import { EnumTable } from './enums.js';
import { NO_GUARDS } from './guards.js';
import {
  checkKindDeclaration,
  composesKind,
  KindTable,
  kindName,
  type KindLookup,
  type KindRef,
} from './kinds.js';

function kind(library: string, name: string, ...composes: string[]): KindRef {
  const order = [...composes, `${library}.${name}`];
  return {
    library,
    name,
    order,
    composes: new Set(order),
    properties: new Map(),
    passages: new Map(),
    guards: NO_GUARDS,
    contains: false,
    containsActors: false,
    suppressed: [],
  };
}

const CONTAINER = kind('sprout', 'Container');
const VESSEL = kind('printers_shop', 'Vessel', 'sprout.Container');

describe('a kind is matched nominally, and by composition', () => {
  it('names itself by its library and its name', () => {
    expect(kindName(CONTAINER)).toBe('sprout.Container');
    expect(kindName(VESSEL)).toBe('printers_shop.Vessel');
  });

  it('composes itself, so a kind fills a role declaring it', () => {
    expect(composesKind(VESSEL, VESSEL)).toBe(true);
    expect(composesKind(CONTAINER, CONTAINER)).toBe(true);
  });

  it('admits anything that composes the kind, whatever else it composes', () => {
    expect(composesKind(VESSEL, CONTAINER)).toBe(true);
    expect(composesKind(CONTAINER, VESSEL)).toBe(false);
  });

  it('does not match structurally: two kinds are not one for looking alike', () => {
    const elsewhere = kind('other_world', 'Vessel', 'sprout.Container');
    expect(kindName(elsewhere)).not.toBe(kindName(VESSEL));
    expect(composesKind(elsewhere, VESSEL)).toBe(false);
    expect(composesKind(VESSEL, elsewhere)).toBe(false);
  });
});

describe('a lookup answers by full identity, and unqualified from a namespace first', () => {
  const all = [CONTAINER, VESSEL, kind('printers_shop', 'Container')];
  const kinds: KindLookup = {
    qualified: (library, name) => all.find((k) => k.library === library && k.name === name) ?? null,
    unqualified: (name, from) => kinds.qualified(from, name) ?? kinds.qualified('sprout', name),
  };

  it('keeps two kinds of one name in two libraries apart', () => {
    expect(kinds.qualified('sprout', 'Container')).toBe(CONTAINER);
    expect(kinds.qualified('printers_shop', 'Container')).not.toBe(CONTAINER);
    expect(kinds.qualified('elsewhere', 'Container')).toBeNull();
  });

  it("reads an unqualified name as the asker's own before the standard library's", () => {
    expect(kinds.unqualified('Container', 'printers_shop')?.library).toBe('printers_shop');
    expect(kinds.unqualified('Container', 'other_world')).toBe(CONTAINER);
    expect(kinds.unqualified('Vessel', 'other_world')).toBeNull();
  });
});

describe('what one kind or object declaration is refused for on its own', () => {
  /** What the shape tier says about the one kind or object in some text, nothing resolved. */
  function shape(text: string) {
    const parsed = new Diagnostics();
    const declared = parseDeclarations(new SourceFile('k.sprout', text), parsed).find(
      (d): d is KindDeclaration | ObjectDeclaration => d.kind === 'kind' || d.kind === 'object',
    );
    expect(parsed.refusals, `\`${text}\` did not parse`).toEqual([]);
    const said = new Diagnostics();
    checkKindDeclaration(declared!, said);
    return said.refusals.map((d) => [locationOf(d.at), d.message, d.remedy]);
  }

  it('refuses `sprout.World` on a kind, at the kind as written', () => {
    expect(shape('kind Crate: Heavy, sprout.World { }')).toEqual([
      [
        'k.sprout:1:20',
        '`Crate` composes `sprout.World`, which only a world may.',
        'Take it out of what `Crate` composes: it would make a thing into a world, and a bundle has one world, written `world <name>: sprout.World { … }`.',
      ],
    ]);
  });

  it('refuses it on an object too, whatever else it composes', () => {
    const said = shape('object bench: sprout.World, Bench in hall');
    expect(said.map(([at, message]) => [at, message])).toEqual([
      ['k.sprout:1:15', '`bench` composes `sprout.World`, which only a world may.'],
    ]);
  });

  it('refuses each time it is written, since each is a word to take out', () => {
    expect(shape('kind Crate: sprout.World, sprout.World { }')).toHaveLength(2);
  });

  it('refuses only the written `sprout.World`: another library’s `World`, or a bare one, is some other kind', () => {
    // Which kind a bare `World` names is the second tier's to resolve.
    expect(shape('kind Crate: World { }')).toEqual([]);
    expect(shape('kind Crate: victorian.World { }')).toEqual([]);
  });

  it('refuses an object that names no kind, at its name', () => {
    // The spec's Objects: "An object names its kinds and its container."
    expect(shape('object bench in hall { :worn 0 }')).toEqual([
      [
        'k.sprout:1:8',
        '`bench` does not say what kind of thing it is.',
        'An object names the kinds it is made of: `object bench: <Kind> in hall { … }`.',
      ],
    ]);
  });

  it('takes a kind that composes nothing, which the spec allows', () => {
    expect(shape('kind Crate { contains }')).toEqual([]);
    expect(shape('kind Crate: sprout.Container { }')).toEqual([]);
    expect(shape('object bench: Bench in hall')).toEqual([]);
  });
});

describe('the kind table composes every kind the bundle declares', () => {
  /** A table over some libraries' kinds, resolved, with what it said and what it was told was missing. */
  function table(libraries: Record<string, string>) {
    const diagnostics = new Diagnostics();
    const kinds = new KindTable();
    for (const [library, text] of Object.entries(libraries)) {
      const declared = parseDeclarations(new SourceFile(`${library}.sprout`, text), diagnostics);
      expect(diagnostics.refusals, `${library} parses`).toEqual([]);
      kinds.add(
        library,
        declared.filter((d): d is KindDeclaration => d.kind === 'kind'),
        diagnostics,
      );
    }
    const missing: string[] = [];
    kinds.resolve(new EnumTable(), diagnostics, (written) => missing.push(written.name.text));
    return {
      kinds,
      missing,
      said: diagnostics.refusals.map((d) => [locationOf(d.at), d.message] as const),
    };
  }

  it('composes a kind after what it composes, whatever order they were declared in', () => {
    const { kinds, said } = table({ shop: 'kind C: B { }\nkind B: A { }\nkind A { }' });
    expect(said).toEqual([]);
    expect(kinds.qualified('shop', 'C')!.order).toEqual(['shop.A', 'shop.B', 'shop.C']);
    expect(kinds.all().map(kindName)).toEqual(['shop.C', 'shop.B', 'shop.A']);
  });

  it('composes across libraries, reading a bare name from its own library first', () => {
    const { kinds } = table({
      sprout: 'kind Container { contains }\nkind Actor { }',
      shop: 'kind Container { }\nkind Crate: Container, Actor { }',
    });
    expect(kinds.qualified('shop', 'Crate')!.order).toEqual([
      'shop.Container',
      'sprout.Actor',
      'shop.Crate',
    ]);
    expect(kinds.unqualified('Container', 'shop')!.library).toBe('shop');
    expect(kinds.unqualified('Container', 'elsewhere')!.library).toBe('sprout');
    expect(kinds.unqualified('Actor', 'shop')!.library).toBe('sprout');
  });

  it('refuses two kinds of one name in one library at the second, and keeps two in two libraries', () => {
    const { said, kinds } = table({
      sprout: 'kind Box { }',
      shop: 'kind Box { contains }\nkind Box { }',
    });
    expect(said).toEqual([['shop.sprout:2:6', 'shop declares two kinds called `Box`.']]);
    expect(kinds.qualified('shop', 'Box')!.contains).toBe(true);
    expect(kinds.qualified('sprout', 'Box')).not.toBeNull();
  });

  it('refuses a loop once, at the kind as written that closes it', () => {
    const { said, kinds } = table({ shop: 'kind A: B { }\nkind B: A { }' });
    expect(said).toEqual([['shop.sprout:2:9', '`A` composes itself, through `B`.']]);
    expect(kinds.qualified('shop', 'A')).toBeNull();
    expect(kinds.qualified('shop', 'B')).toBeNull();
  });

  it('names every kind a longer loop runs through, and a kind composing itself outright', () => {
    expect(table({ shop: 'kind A: B { }\nkind B: C { }\nkind C: A { }' }).said).toEqual([
      ['shop.sprout:3:9', '`A` composes itself, through `B` and `C`.'],
    ]);
    expect(table({ shop: 'kind A: A { }' }).said).toEqual([
      ['shop.sprout:1:9', '`A` composes itself.'],
    ]);
  });

  it('says nothing more of a kind composing one in a loop: not unknown, not again', () => {
    const { said, missing, kinds } = table({
      shop: 'kind A: B { }\nkind B: A { }\nkind C: A { }\nkind D: C { }',
    });
    expect(said).toHaveLength(1);
    expect(missing).toEqual([]);
    expect(kinds.find('shop.D')).toEqual({ found: 'failed' });
  });

  it('tells of a kind nothing declares, and fails what composes it without telling again', () => {
    const { said, missing, kinds } = table({
      shop: 'kind Crate: Missing { }\nkind Tea_chest: Crate { }',
    });
    expect(said).toEqual([]);
    expect(missing).toEqual(['Missing']);
    expect(kinds.qualified('shop', 'Crate')).toBeNull();
    expect(kinds.find('shop.Tea_chest')).toEqual({ found: 'failed' });
    expect(kinds.find('shop.Nothing')).toEqual({ found: 'unknown' });
  });

  it('knows what is declared, composed or not, which is how a bare name is read', () => {
    const { kinds } = table({ shop: 'kind Crate: Missing { }' });
    expect(kinds.declares('shop.Crate')).toBe(true);
    expect(kinds.declares('shop.Missing')).toBe(false);
  });
});
