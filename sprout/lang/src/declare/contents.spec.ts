import { describe, expect, it } from 'vitest';

import type { KindDeclaration } from '../syntax/ast.js';
import { Diagnostics } from '../source/diagnostics.js';
import { parseDeclarations } from '../syntax/parse.js';
import { locationOf, SourceFile } from '../source/source.js';
import { chooser } from '../fixtures/parse.js';
import { EnumTable } from './enums.js';
import { KindTable } from './kinds.js';
import {
  contentAt,
  everyContent,
  givenBy,
  resolveContents,
  type KindContent,
  type KindContents,
} from './contents.js';

/** The kinds `text` declares in the library `shop`, composed, and what their bodies give. */
function contentsOf(text: string) {
  const diagnostics = new Diagnostics();
  const declared = parseDeclarations(new SourceFile('shop.sprout', text), diagnostics);
  expect(diagnostics.refusals, 'the fixture parses').toEqual([]);
  const kinds = new KindTable();
  const own = declared.filter((d): d is KindDeclaration => d.kind === 'kind');
  kinds.add('shop', own, diagnostics);
  const enums = new EnumTable();
  kinds.resolve('shop', enums, diagnostics);
  const contents = resolveContents(new Map([['shop', own]]), {
    enums,
    kinds,
    world: 'shop',
    diagnostics,
    onUnknown: () => {},
  });
  return {
    contents,
    kinds,
    said: diagnostics.refusals.map((d) => [locationOf(d.at), d.message] as const),
  };
}

const names = (given: readonly KindContent[]) => given.map((one) => one.declaration.name.text);

describe('what a kind’s body gives', () => {
  const { contents, kinds, said } = contentsOf(
    [
      'kind Wick { :trimmed true }',
      'kind Lantern { contains',
      '  object wick is Wick { contains object flame is Wick }',
      '  object hook is Wick',
      '}',
      'kind Case { contains object glass is Wick }',
      'kind Storm is Case, Lantern { }',
    ].join('\n'),
  );

  it('composes each object once, with the kind that wrote it and its path in that body', () => {
    expect(said).toEqual([]);
    const wick = contentAt(contents, 'shop.Lantern', ['wick'])!;
    expect(wick.giver).toBe('shop.Lantern');
    expect(wick.path).toEqual(['wick']);
    expect(wick.kind?.properties.has('trimmed')).toBe(true);
    expect(names(wick.holds)).toEqual(['flame']);
    expect(contentAt(contents, 'shop.Lantern', ['wick', 'flame'])?.path).toEqual(['wick', 'flame']);
  });

  it('finds nothing at a path the body does not write', () => {
    expect(contentAt(contents, 'shop.Lantern', ['flame'])).toBeNull();
    expect(contentAt(contents, 'shop.Wick', ['wick'])).toBeNull();
  });

  it('gives an instance what every kind in its closure writes, in closure order', () => {
    expect(names(givenBy(contents, kinds.qualified('shop', 'Storm')!))).toEqual([
      'glass',
      'wick',
      'hook',
    ]);
    expect(givenBy(contents, kinds.qualified('shop', 'Wick')!)).toEqual([]);
  });

  it('lists every content before what it holds', () => {
    expect(everyContent(contents).map((one) => one.path.join('.'))).toEqual([
      'wick',
      'wick.flame',
      'hook',
      'glass',
    ]);
  });
});

describe('what a kind’s body may not give', () => {
  it('refuses an object in a kind that holds nothing, once, and gives nothing', () => {
    const { contents, said } = contentsOf('kind Wick { }\nkind Lantern { object wick is Wick }');
    expect(said).toEqual([
      ['shop.sprout:2:23', '`Lantern` holds nothing, so `wick` cannot be in it.'],
    ]);
    expect(contents.has('shop.Lantern')).toBe(false);
  });

  it('refuses an object inside a content that holds nothing, and keeps the content', () => {
    const { contents, said } = contentsOf(
      'kind Wick { }\nkind Lantern { contains object wick is Wick { object flame is Wick } }',
    );
    expect(said).toEqual([
      ['shop.sprout:2:54', '`wick` holds nothing, so `flame` cannot be in it.'],
    ]);
    expect(contentAt(contents, 'shop.Lantern', ['wick'])?.holds).toEqual([]);
  });

  it('refuses two of one name in one body at the second, and keeps the first', () => {
    const { contents, said } = contentsOf(
      'kind Wick { }\nkind Lantern { contains\n  object wick is Wick\n  object wick is Wick { :x 1 }\n}',
    );
    expect(said).toEqual([['shop.sprout:4:10', '`Lantern` holds two objects called `wick`.']]);
    expect(contents.get('shop.Lantern')).toHaveLength(1);
    expect(contentAt(contents, 'shop.Lantern', ['wick'])?.kind?.properties.has('x')).toBe(false);
  });

  it('gives nothing for a kind that could not be composed', () => {
    const { contents } = contentsOf('kind Lantern is Missing { contains object wick is Lantern }');
    expect(contents.size).toBe(0);
  });

  it('refuses and cuts a content made of a kind it is already inside', () => {
    const { contents, said } = contentsOf(
      [
        'kind Box { contains object inner is Box object lid is Lid }',
        'kind Lid { }',
        'kind Lantern { contains object wick is Wick }',
        'kind Wick { contains object spare is Lantern }',
      ].join('\n'),
    );
    expect(said).toEqual([
      [
        'shop.sprout:1:28',
        '`inner` is made of `Box`, which it is already inside, so every `Box` would hold another without end.',
      ],
      [
        'shop.sprout:4:29',
        '`spare` is made of `Lantern`, which it is already inside, so every `Lantern` would hold another without end.',
      ],
    ]);
    expect(names(contents.get('shop.Box')!)).toEqual(['lid']);
    expect(names(contents.get('shop.Lantern')!)).toEqual(['wick']);
    expect(contents.has('shop.Wick')).toBe(false);
  });

  it('cuts a loop that runs through a content’s own body', () => {
    const { contents, said } = contentsOf(
      'kind Box { contains object tray is Tray { contains object inner is Box } }\nkind Tray { }',
    );
    expect(said.map(([, message]) => message)).toEqual([
      '`inner` is made of `Box`, which it is already inside, so every `Box` would hold another without end.',
    ]);
    expect(contentAt(contents, 'shop.Box', ['tray'])?.holds).toEqual([]);
  });

  it('leaves every instance finitely many contents, whatever the kinds give one another', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const { below: choose } = chooser(seed);
      const count = 2 + choose(4);
      const kinds = Array.from({ length: count }, (_, i) => `K${i}`);
      const text = kinds
        .map((name) => {
          const composes = choose(3) === 0 ? ` is ${kinds[choose(count)]}` : '';
          const objects = Array.from(
            { length: choose(3) },
            (_, j) =>
              `object o${j} is ${kinds[choose(count)]}${choose(2) === 0 ? ` { contains object p${j} is ${kinds[choose(count)]} }` : ''}`,
          );
          return `kind ${name}${composes} { contains ${objects.join(' ')} }`;
        })
        .join('\n');
      const { contents, kinds: table } = contentsOf(text);
      for (const name of kinds) {
        const kind = table.qualified('shop', name);
        if (kind === null) continue;
        expect(expandedSize(contents, kind.order), `${text}\nexpanding ${name}`).toBeLessThan(
          100_000,
        );
      }
    }
  });
});

/**
 * How many objects an instance whose closure is `order` holds, all the
 * way down, stopping past a bound so that an endless one is seen.
 */
function expandedSize(contents: KindContents, order: readonly string[]): number {
  let size = 0;
  const pending: KindContent[] = order.flatMap((identity) => contents.get(identity) ?? []);
  for (let next = pending.pop(); next !== undefined && size < 100_000; next = pending.pop()) {
    size += 1;
    pending.push(...(next.kind === null ? [] : givenBy(contents, next.kind)), ...next.holds);
  }
  return size;
}
