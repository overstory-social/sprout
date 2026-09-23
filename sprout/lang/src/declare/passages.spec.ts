import { describe, expect, it } from 'vitest';

import type { KindDeclaration } from '../syntax/ast.js';
import { Diagnostics } from '../source/diagnostics.js';
import { parseDeclarations } from '../syntax/parse.js';
import { locationOf, SourceFile } from '../source/source.js';
import { shownName } from './enums.js';
import {
  ownPassages,
  passageArrivals,
  resolvePassages,
  type PassageArrival,
  type ResolvedPassage,
} from './passages.js';

/**
 * Resolve the passages of the last kind in `text`, every kind in the
 * library `shop`. The kinds it composes are resolved the same way first,
 * each after what it composes; what they say is the fixture's business,
 * and only what the last kind's own resolution says is reported.
 */
function resolve(text: string) {
  const read = new Diagnostics();
  const declared = parseDeclarations(new SourceFile('shop.sprout', text), read).filter(
    (d): d is KindDeclaration => d.kind === 'kind',
  );
  expect(
    read.refusals.map((d) => d.message),
    'the fixture parses',
  ).toEqual([]);
  const byName = new Map(declared.map((d) => [d.name.text, d]));
  const settled = new Map<string, ReadonlyMap<string, ResolvedPassage>>();

  const passagesOf = (
    declaration: KindDeclaration,
    diagnostics: Diagnostics,
  ): ReadonlyMap<string, ResolvedPassage> => {
    const name = declaration.name.text;
    const done = settled.get(name);
    if (done !== undefined) return done;
    const composed = declaration.composes.map((written) => ({
      passages: passagesOf(byName.get(written.name.text)!, new Diagnostics()),
      written,
    }));
    const resolved = resolvePassages(
      { name, world: 'shop', shown: (identity) => shownName(identity, 'shop') },
      ownPassages(name, declaration.members, `shop.${name}`, diagnostics),
      passageArrivals(composed),
      diagnostics,
    );
    settled.set(name, resolved);
    return resolved;
  };

  const diagnostics = new Diagnostics();
  const passages = passagesOf(declared.at(-1)!, diagnostics);
  const applies = (name: string) => {
    const one = passages.get(name)!;
    return { origin: one.origin, yields: one.yields, words: one.body.text };
  };
  return {
    passages,
    applies,
    said: diagnostics.refusals.map((d) => [locationOf(d.at), d.message, d.remedy] as const),
  };
}

describe('the composer’s own passage always applies', () => {
  it('replaces a composed default, with the composer as its origin', () => {
    const { applies, said } = resolve(
      'kind Plain { passage taken default { You take it. } }\nkind Bold is Plain { passage taken { You seize it. } }',
    );
    expect(said).toEqual([]);
    expect(applies('taken')).toEqual({
      origin: 'shop.Bold',
      yields: false,
      words: ' You seize it. ',
    });
  });

  it('replaces a composed passage that is not a default, since the composer is no second source', () => {
    const { applies, said } = resolve(
      'kind Mirror { passage greeting { Old glass. } }\nkind Clouded is Mirror { passage greeting { Nothing shows. } }',
    );
    expect(said).toEqual([]);
    expect(applies('greeting').origin).toBe('shop.Clouded');
  });

  it('settles what would otherwise collide: two sources and the composer’s own is the composer’s', () => {
    const { applies, said } = resolve(
      'kind Plain { passage taken { A. } }\nkind Terse { passage taken { B. } }\nkind Porter is Plain, Terse { passage taken { C. } }',
    );
    expect(said).toEqual([]);
    expect(applies('taken').origin).toBe('shop.Porter');
  });

  it('keeps its own `default` over a composed line that is not one, and still yields further up', () => {
    const { applies, said } = resolve(
      'kind Loud { passage shrug { A shrug. } }\nkind Quiet is Loud { passage shrug default { Nothing. } }',
    );
    expect(said).toEqual([]);
    expect(applies('shrug')).toMatchObject({ origin: 'shop.Quiet', yields: true });
  });

  it('carries what it writes that nothing it composes does', () => {
    const { passages } = resolve('kind A { passage one { 1 } }\nkind B is A { passage two { 2 } }');
    expect([...passages.keys()].sort()).toEqual(['one', 'two']);
    expect(passages.get('two')!.origin).toBe('shop.B');
    expect(passages.get('one')!.origin).toBe('shop.A');
  });

  it('refuses one name written twice in one body, at the second, and keeps the first', () => {
    const { applies, said } = resolve(
      'kind Mirror {\n  passage greeting { First. }\n  passage greeting { Second. }\n}',
    );
    expect(said).toEqual([
      [
        'shop.sprout:3:11',
        '`Mirror` writes the passage `greeting` twice.',
        'A thing speaks each line in one voice. Keep one of them, or give the other another name.',
      ],
    ]);
    expect(applies('greeting').words).toBe(' First. ');
  });
});

describe('among composed sources, a default yields to any other', () => {
  it('applies a lone default as it came, origin and `default` kept', () => {
    const { applies, said } = resolve(
      'kind Plain { passage taken default { You take it. } }\nkind Porter is Plain { }',
    );
    expect(said).toEqual([]);
    expect(applies('taken')).toMatchObject({ origin: 'shop.Plain', yields: true });
  });

  it('passes a default through a kind that says nothing, so it still yields further up', () => {
    const { applies, said } = resolve(
      'kind Plain { passage taken default { Stock. } }\nkind Middle is Plain { }\nkind Terse { passage taken { Mine. } }\nkind Porter is Middle, Terse { }',
    );
    expect(said).toEqual([]);
    expect(applies('taken').origin).toBe('shop.Terse');
  });

  it('lets one line that is not a default beat any number of defaults, wherever it is written', () => {
    for (const order of ['A, B, Loud', 'Loud, A, B', 'A, Loud, B']) {
      const { applies, said } = resolve(
        `kind A { passage shrug default { a } }\nkind B { passage shrug default { b } }\nkind Loud { passage shrug { loud } }\nkind Mirror is ${order} { }`,
      );
      expect(said, order).toEqual([]);
      expect(applies('shrug'), order).toMatchObject({ origin: 'shop.Loud', yields: false });
    }
  });

  it('counts one origin reached through a diamond once, so its default does not collide with itself', () => {
    const { applies, said } = resolve(
      'kind Voice { passage shrug default { Nothing. } }\nkind Left is Voice { }\nkind Right is Voice { }\nkind Both is Left, Right { }',
    );
    expect(said).toEqual([]);
    expect(applies('shrug').origin).toBe('shop.Voice');
  });

  it('counts a line that is not a default, reached through a diamond, once too', () => {
    const { applies, said } = resolve(
      'kind Voice { passage shrug { Nothing. } }\nkind Left is Voice { }\nkind Right is Voice { }\nkind Both is Left, Right { }',
    );
    expect(said).toEqual([]);
    expect(applies('shrug').origin).toBe('shop.Voice');
  });

  it('takes a side of the diamond that wrote its own line over the default the other side passes on', () => {
    const { applies, said } = resolve(
      'kind Voice { passage shrug default { Stock. } }\nkind Left is Voice { passage shrug { Left’s. } }\nkind Right is Voice { }\nkind Both is Left, Right { }',
    );
    expect(said).toEqual([]);
    expect(applies('shrug').origin).toBe('shop.Left');
  });
});

describe('two sources that neither yields are refused', () => {
  const REMEDY =
    'Write its own `passage taken { … }` in `Porter`, which is then the one that applies, or compose only one of them.';

  it('refuses two lines that are not defaults at the kind, as written, that brought the second, naming both', () => {
    const { said } = resolve(
      'kind Plain { passage taken { A. } }\nkind Terse { passage taken { B. } }\nkind Porter is Plain, Terse { }',
    );
    expect(said).toEqual([
      [
        'shop.sprout:3:23',
        '`Porter` gets the passage `taken` from both `Plain` and `Terse`, and a thing speaks each line in one voice.',
        REMEDY,
      ],
    ]);
  });

  it('names only the sources that collide, not the defaults that yield to them', () => {
    const { said } = resolve(
      'kind Stock { passage taken default { S. } }\nkind Plain { passage taken { A. } }\nkind Terse { passage taken { B. } }\nkind Porter is Stock, Plain, Terse { }',
    );
    expect(said.map(([at, message]) => [at, message])).toEqual([
      [
        'shop.sprout:4:30',
        '`Porter` gets the passage `taken` from both `Plain` and `Terse`, and a thing speaks each line in one voice.',
      ],
    ]);
  });

  it('names every source when there are more than two', () => {
    const { said } = resolve(
      'kind A { passage taken { a } }\nkind B { passage taken { b } }\nkind C { passage taken { c } }\nkind Porter is A, B, C { }',
    );
    expect(said.map(([, message]) => message)).toEqual([
      '`Porter` gets the passage `taken` from `A`, `B` and `C`, and a thing speaks each line in one voice.',
    ]);
  });

  it('refuses two defaults with nothing else beside them, as any two sources collide', () => {
    const { said } = resolve(
      'kind Plain { passage taken default { A. } }\nkind Terse { passage taken default { B. } }\nkind Porter is Plain, Terse { }',
    );
    expect(said).toEqual([
      [
        'shop.sprout:3:23',
        '`Porter` gets a default passage `taken` from both `Plain` and `Terse`, and a thing speaks each line in one voice: a default gives way only to a passage that is not one.',
        REMEDY,
      ],
    ]);
  });

  it('refuses a default restated over another origin’s default when both arrive: two origins are two sources', () => {
    const { said } = resolve(
      'kind Voice { passage shrug default { Stock. } }\nkind Quiet is Voice { passage shrug default { Hush. } }\nkind Mirror is Quiet, Voice { }',
    );
    expect(said.map(([at, message]) => [at, message])).toEqual([
      [
        'shop.sprout:3:23',
        '`Mirror` gets a default passage `shrug` from both `Quiet` and `Voice`, and a thing speaks each line in one voice: a default gives way only to a passage that is not one.',
      ],
    ]);
  });

  it('keeps the first of a refused collision, so a kind composing this one hears nothing more of it', () => {
    const { passages } = resolve(
      'kind Plain { passage taken { A. } }\nkind Terse { passage taken { B. } }\nkind Porter is Plain, Terse { }',
    );
    expect(passages.get('taken')!.origin).toBe('shop.Plain');
    const above = resolve(
      'kind Plain { passage taken { A. } }\nkind Terse { passage taken { B. } }\nkind Porter is Plain, Terse { }\nkind Crowd is Porter { }',
    );
    expect(above.said).toEqual([]);
  });

  it('never decides by order: `A, B` and `B, A` refuse alike', () => {
    for (const order of ['Plain, Terse', 'Terse, Plain']) {
      const { said } = resolve(
        `kind Plain { passage taken { A. } }\nkind Terse { passage taken { B. } }\nkind Porter is ${order} { }`,
      );
      expect(said, order).toHaveLength(1);
    }
  });
});

describe('the standard library’s default yields to another library’s', () => {
  /** An `arrives` as `origin` wrote it, a default unless `yields` is false, arriving through one composed kind. */
  function arrival(origin: string, yields = true): PassageArrival {
    const [declared] = parseDeclarations(
      new SourceFile(
        `${origin}.sprout`,
        `kind K is Through { passage arrives${yields ? ' default' : ''} { From ${origin}. } }`,
      ),
      new Diagnostics(),
    ) as KindDeclaration[];
    const own = ownPassages('K', declared!.members, origin, new Diagnostics());
    return { passage: own.get('arrives')!, through: declared!.composes[0]! };
  }

  /** What `hall`, a thing of the world `shop` writing nothing itself, gets for `arrives` from these origins. */
  function settle(...origins: readonly (string | [string, false])[]) {
    const diagnostics = new Diagnostics();
    const came = origins.map((one) =>
      typeof one === 'string' ? arrival(one) : arrival(one[0], false),
    );
    const passages = resolvePassages(
      { name: 'hall', world: 'shop', shown: (identity) => shownName(identity, 'shop') },
      new Map(),
      new Map([['arrives', came]]),
      diagnostics,
    );
    const applies = passages.get('arrives')!;
    return {
      origin: applies.origin,
      yields: applies.yields,
      said: diagnostics.refusals.map((d) => d.message),
    };
  }

  it('lets another library’s default apply over the standard library’s, and it stays a default', () => {
    expect(settle('sprout.Place', 'victorian.Hushed')).toEqual({
      origin: 'victorian.Hushed',
      yields: true,
      said: [],
    });
  });

  it('gives way whichever was composed first', () => {
    expect(settle('victorian.Hushed', 'sprout.Place').origin).toBe('victorian.Hushed');
  });

  it('still refuses two defaults from two libraries other than the standard one, naming only them', () => {
    const { said } = settle('sprout.Place', 'victorian.Hushed', 'regency.Quiet');
    expect(said).toEqual([
      '`hall` gets a default passage `arrives` from both `victorian.Hushed` and `regency.Quiet`, and a thing speaks each line in one voice: a default gives way only to a passage that is not one.',
    ]);
  });

  it('does not read the world’s own kinds as another library: its default beside the standard library’s collides', () => {
    const { said, origin } = settle('sprout.Place', 'shop.Quiet');
    expect(said).toEqual([
      '`hall` gets a default passage `arrives` from both `sprout.Place` and `Quiet`, and a thing speaks each line in one voice: a default gives way only to a passage that is not one, or the standard library’s to another library’s.',
    ]);
    expect(origin).toBe('sprout.Place');
  });

  it('drops the standard library’s once another library’s is there, and the world’s own still collides with that', () => {
    const { said } = settle('sprout.Place', 'shop.Quiet', 'victorian.Hushed');
    expect(said).toEqual([
      '`hall` gets a default passage `arrives` from both `Quiet` and `victorian.Hushed`, and a thing speaks each line in one voice: a default gives way only to a passage that is not one.',
    ]);
  });

  it('is beside the point once any source does not yield: that one applies', () => {
    expect(settle('sprout.Place', 'victorian.Hushed', ['shop.Loud', false])).toEqual({
      origin: 'shop.Loud',
      yields: false,
      said: [],
    });
  });
});
