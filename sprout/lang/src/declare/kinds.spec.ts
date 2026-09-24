import { describe, expect, it } from 'vitest';

import type { KindDeclaration, ObjectDeclaration, WorldDeclaration } from '../syntax/ast.js';
import { Diagnostics } from '../source/diagnostics.js';
import { parseDeclarations } from '../syntax/parse.js';
import { locationOf, SourceFile } from '../source/source.js';
import { EnumTable } from './enums.js';
import { NO_GRAMMAR } from './grammar.js';
import { NO_PASS_RULES } from './passes.js';
import { NO_GUARDS } from './guards.js';
import { NO_PLAYS } from './roles.js';
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
    plays: NO_PLAYS,
    handlers: new Map(),
    hooks: new Map(),
    passes: NO_PASS_RULES,
    grammar: NO_GRAMMAR,
    exits: [],
    describe: null,
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
    all: () => all,
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
  /**
   * What the shape tier says about the one kind in some text, or the one
   * object, which is written in a world's body from line 2, nothing resolved.
   */
  function shape(text: string) {
    const parsed = new Diagnostics();
    const object = text.startsWith('object');
    const source = object ? `world w is sprout.World {\n${text}\n}` : text;
    const top = parseDeclarations(new SourceFile('k.sprout', source), parsed).find(
      (d): d is KindDeclaration | WorldDeclaration => d.kind === 'kind' || d.kind === 'world',
    );
    const declared: KindDeclaration | ObjectDeclaration | undefined =
      top?.kind === 'world' ? top.objects[0] : top;
    expect(parsed.refusals, `\`${text}\` did not parse`).toEqual([]);
    const said = new Diagnostics();
    checkKindDeclaration(declared!, said);
    return said.refusals.map((d) => [locationOf(d.at), d.message, d.remedy]);
  }

  it('refuses `sprout.World` on a kind, at the kind as written', () => {
    expect(shape('kind Crate is Heavy, sprout.World { }')).toEqual([
      [
        'k.sprout:1:22',
        '`Crate` composes `sprout.World`, which only a world may.',
        'Take it out of what `Crate` composes: it would make a thing into a world, and a bundle has one world, written `world <name> is sprout.World { … }`.',
      ],
    ]);
  });

  it('refuses it on an object too, whatever else it composes', () => {
    const said = shape('object bench is sprout.World, Bench');
    expect(said.map(([at, message]) => [at, message])).toEqual([
      ['k.sprout:2:17', '`bench` composes `sprout.World`, which only a world may.'],
    ]);
  });

  it('refuses each time it is written, since each is a word to take out', () => {
    expect(shape('kind Crate is sprout.World, sprout.World { }')).toHaveLength(2);
  });

  it('refuses only the written `sprout.World`: another library’s `World`, or a bare one, is some other kind', () => {
    // Which kind a bare `World` names is the second tier's to resolve.
    expect(shape('kind Crate is World { }')).toEqual([]);
    expect(shape('kind Crate is victorian.World { }')).toEqual([]);
  });

  it('refuses an object that names no kind, at its name', () => {
    // The spec's Objects: "An object names its kinds after `is`".
    expect(shape('object bench { :worn 0 }')).toEqual([
      [
        'k.sprout:2:8',
        '`bench` does not say what kind of thing it is.',
        'An object names the kinds it is made of after `is`: `object bench is <Kind> { … }`.',
      ],
    ]);
  });

  it('asks nothing of the objects a kind’s body holds, each of which is asked on its own', () => {
    expect(shape('kind Lantern {\n  contains\n  object wick\n  object flame is Flame\n}')).toEqual(
      [],
    );
  });

  it('takes a kind that composes nothing, which the spec allows', () => {
    expect(shape('kind Crate { contains }')).toEqual([]);
    expect(shape('kind Crate is sprout.Container { }')).toEqual([]);
    expect(shape('object bench is Bench')).toEqual([]);
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
    kinds.resolve('shop', new EnumTable(), diagnostics, (written) =>
      missing.push(written.name.text),
    );
    return {
      kinds,
      missing,
      said: diagnostics.refusals.map((d) => [locationOf(d.at), d.message] as const),
    };
  }

  it('composes a kind after what it composes, whatever order they were declared in', () => {
    const { kinds, said } = table({ shop: 'kind C is B { }\nkind B is A { }\nkind A { }' });
    expect(said).toEqual([]);
    expect(kinds.qualified('shop', 'C')!.order).toEqual(['shop.A', 'shop.B', 'shop.C']);
    expect(kinds.all().map(kindName)).toEqual(['shop.C', 'shop.B', 'shop.A']);
  });

  it('composes across libraries, reading a bare name from its own library first', () => {
    const { kinds } = table({
      sprout: 'kind Container { contains }\nkind Actor { }',
      shop: 'kind Container { }\nkind Crate is Container, Actor { }',
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

  it('leaves an unqualified name null when the asker’s own of that name failed to compose, never falling through to the library’s', () => {
    const { kinds } = table({
      sprout: 'kind Container { contains }',
      shop: 'kind Container is Missing { }',
    });
    expect(kinds.qualified('shop', 'Container')).toBeNull();
    expect(kinds.unqualified('Container', 'shop')).toBeNull();
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
    const { said, kinds } = table({ shop: 'kind A is B { }\nkind B is A { }' });
    expect(said).toEqual([['shop.sprout:2:11', '`A` composes itself, through `B`.']]);
    expect(kinds.qualified('shop', 'A')).toBeNull();
    expect(kinds.qualified('shop', 'B')).toBeNull();
  });

  it('names every kind a longer loop runs through, and a kind composing itself outright', () => {
    expect(table({ shop: 'kind A is B { }\nkind B is C { }\nkind C is A { }' }).said).toEqual([
      ['shop.sprout:3:11', '`A` composes itself, through `B` and `C`.'],
    ]);
    expect(table({ shop: 'kind A is A { }' }).said).toEqual([
      ['shop.sprout:1:11', '`A` composes itself.'],
    ]);
  });

  it('says nothing more of a kind composing one in a loop: not unknown, not again', () => {
    const { said, missing, kinds } = table({
      shop: 'kind A is B { }\nkind B is A { }\nkind C is A { }\nkind D is C { }',
    });
    expect(said).toHaveLength(1);
    expect(missing).toEqual([]);
    expect(kinds.find('shop.D')).toEqual({ found: 'failed' });
  });

  it('tells of a kind nothing declares, and fails what composes it without telling again', () => {
    const { said, missing, kinds } = table({
      shop: 'kind Crate is Missing { }\nkind Tea_chest is Crate { }',
    });
    expect(said).toEqual([]);
    expect(missing).toEqual(['Missing']);
    expect(kinds.qualified('shop', 'Crate')).toBeNull();
    expect(kinds.find('shop.Tea_chest')).toEqual({ found: 'failed' });
    expect(kinds.find('shop.Nothing')).toEqual({ found: 'unknown' });
  });

  it('knows what is declared, composed or not, which is how a bare name is read', () => {
    const { kinds } = table({ shop: 'kind Crate is Missing { }' });
    expect(kinds.declares('shop.Crate')).toBe(true);
    expect(kinds.declares('shop.Missing')).toBe(false);
  });

  it('gives back the declaration a composed kind was made of, by its full identity', () => {
    const { kinds } = table({ shop: 'kind Crate { :lid true }', other: 'kind Crate { }' });
    const shops = kinds.declaration(kinds.qualified('shop', 'Crate')!);
    expect(shops?.members.map((m) => m.kind)).toEqual(['property']);
    expect(kinds.declaration(kinds.qualified('other', 'Crate')!)?.members).toEqual([]);
    // A kind no table declared has no declaration in this one.
    expect(kinds.declaration(CONTAINER)).toBeNull();
  });
});
