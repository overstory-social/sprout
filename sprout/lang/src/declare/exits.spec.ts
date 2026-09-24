import { describe, expect, it } from 'vitest';

import type { KindDeclaration } from '../syntax/ast.js';
import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { Diagnostics } from '../source/diagnostics.js';
import { locationOf, SourceFile } from '../source/source.js';
import { parseDeclarations } from '../syntax/parse.js';
import { EnumTable } from './enums.js';
import {
  checkExitLines,
  composeExits,
  isDirection,
  isLinkName,
  ownExits,
  type ResolvedExit,
} from './exits.js';
import { KindTable } from './kinds.js';

function parsed(text: string) {
  const diagnostics = new Diagnostics();
  const declared = parseDeclarations(new SourceFile('k.sprout', text), diagnostics);
  return {
    kinds: declared.filter((d): d is KindDeclaration => d.kind === 'kind'),
    diagnostics,
  };
}

/** What the first tier says of each kind's exits and links, under `caps`. */
function checked(text: string, caps = DEFAULT_LIMITS.caps) {
  const { kinds, diagnostics } = parsed(text);
  for (const kind of kinds) checkExitLines(kind.name.text, kind.members, caps, diagnostics);
  return diagnostics.refusals.map((d) => [locationOf(d.at), d.message, d.remedy]);
}

/** An exit by its direction, a link by its name, then its label and origin. */
const shown = (way: ResolvedExit) => [
  way.kind === 'exit' ? way.direction : `link ${way.name}`,
  way.line.label.text,
  way.origin,
];

/** Every kind in `text`, composed: each one's exits and links. */
function composed(text: string) {
  const { kinds: declared, diagnostics } = parsed(text);
  const kinds = new KindTable();
  kinds.add('shop', declared, diagnostics);
  kinds.resolve('shop', new EnumTable(), diagnostics);
  return {
    exits: (name: string) => kinds.qualified('shop', name)!.exits.map(shown),
    ways: (name: string) => kinds.qualified('shop', name)!.exits,
    said: diagnostics.refusals.map((d) => [locationOf(d.at), d.message, d.remedy]),
  };
}

/**
 * An object's ways out, as `composeExits` gives them: its own body, `own`,
 * over the kinds in `text` its `is` names, `names`.
 */
function objectWays(text: string, names: readonly string[], own: string) {
  const { ways } = composed(text);
  const body = parsed(`kind Own { ${own} }`).kinds[0]!.members;
  const diagnostics = new Diagnostics();
  const named = names.map((name) => ({
    exits: ways(name),
    written: parsed(`kind X is ${name} { }`).kinds[0]!.composes[0]!,
  }));
  const answered = composeExits(
    'hall',
    named,
    ownExits(body, 'shop.hall'),
    (origin) => origin.replace('shop.', ''),
    diagnostics,
  );
  return {
    ways: answered.map(shown),
    said: diagnostics.refusals.map((d) => [d.message, d.remedy]),
  };
}

describe('one body’s exits and links, in the first tier', () => {
  it('say nothing of ways out written well, several exits sharing a direction', () => {
    expect(
      checked(
        'kind Hall { grammar { exit north "dark" -> a when (true)  exit north "light" -> b  link back "back"  link way_2 "on"  exit in "in" -> c } }',
      ),
    ).toEqual([]);
  });

  it('refuse a word outside the closed set as an exit’s direction, the spec’s own `through` among them', () => {
    expect(
      checked('kind Wardrobe { grammar { exit through "through the fur coats" -> narnia } }'),
    ).toEqual([
      [
        'k.sprout:1:32',
        '`through` is not a direction. A way out leads `north`, `south`, `east`, `west`, `northeast`, `northwest`, `southeast`, `southwest`, `up`, `down`, `in` or `out`.',
        'Write one of those, and say the rest in the label, as in `exit in "through the fur coats" -> narnia`.',
      ],
    ]);
  });

  it('refuse an abbreviation, which is what a visitor types, naming the direction', () => {
    expect(checked('kind Hall { grammar { exit n "north" -> yard } }')).toEqual([
      [
        'k.sprout:1:28',
        '`n` is how a visitor types `north`, and source writes the direction out.',
        'Write `exit north "north" -> yard`.',
      ],
    ]);
  });

  it('refuse a link named by a direction, so `go north` never means a link', () => {
    expect(checked('kind Cell { grammar { link north "deeper" } }')).toEqual([
      [
        'k.sprout:1:28',
        '`north` is a direction, and a link is named by a word of your own, so `go north` never means a link.',
        'Name it for where it goes, as in `link onward "deeper"`; a way `north` to a place written in source is an `exit`.',
      ],
    ]);
  });

  it('refuse a link named by a reserved word, or by a word that starts with no letter', () => {
    expect(checked('kind Cell { grammar { link when "deeper" } }')).toEqual([
      [
        'k.sprout:1:28',
        '`when` is a word of the language, so it cannot name a link.',
        'Choose another name for it, as in `link onward "deeper"`.',
      ],
    ]);
    expect(checked('kind Cell { grammar { link _ "deeper" } }')).toEqual([
      [
        'k.sprout:1:28',
        "`_` does not start with a letter, and a link's name does.",
        'Choose another name for it, as in `link onward "deeper"`.',
      ],
    ]);
  });

  it('refuse an empty label, and two links of one name in one body', () => {
    expect(checked('kind Cell { grammar { link onward " "  link onward "on" } }')).toEqual([
      [
        'k.sprout:1:35',
        "This link's label is empty, and it is what a visitor reads and types for the way out.",
        'Write where it goes, as in `link onward "out to the yard"`.',
      ],
      [
        'k.sprout:1:45',
        '`Cell` writes two links `onward`, and `connect onward` could not say which it means.',
        'Give each link a name of its own.',
      ],
    ]);
  });

  it('refuse the first way out past the host’s cap, exits and links alike', () => {
    const caps = { ...DEFAULT_LIMITS.caps, exitsPerPlace: 2 };
    expect(
      checked('kind Hall { grammar { exit in "a" -> a  link way "b"  exit up "c" -> c } }', caps),
    ).toEqual([
      [
        'k.sprout:1:55',
        '`Hall` writes more than 2 exits and links, and 2 is as many as a place may have.',
        'Keep the ways out a visitor needs here: several guarded exits in one direction each count.',
      ],
    ]);
    expect(checked('kind Hall { grammar { exit in "a" -> a  link way "b" } }', caps)).toEqual([]);
  });

  it('know the closed set, and nothing else, as a direction', () => {
    expect(['north', 'southwest', 'in', 'out', 'up'].every(isDirection)).toBe(true);
    expect(['n', 'through', 'onward', 'North'].some(isDirection)).toBe(false);
  });

  it('know a link’s name: the spec’s shape, and neither a direction nor a reserved word', () => {
    expect(['onward', 'back', 'way_2', 'n'].every(isLinkName)).toBe(true);
    expect(['north', 'in', 'when', 'link', '_', '2nd', 'Onward'].some(isLinkName)).toBe(false);
  });
});

describe('a kind’s exits and links, which are not composed', () => {
  it('are its own, and none of a kind it composes', () => {
    const { exits, said } = composed(
      'kind Cell { contains actors  grammar { exit up "to the yard" -> yard  link onward "on" } }\nkind Deep is Cell { grammar { exit down "deeper" -> pit } }\nkind Bare is Cell { }',
    );
    expect(said).toEqual([]);
    expect(exits('Cell')).toEqual([
      ['up', 'to the yard', 'shop.Cell'],
      ['link onward', 'on', 'shop.Cell'],
    ]);
    expect(exits('Deep')).toEqual([['down', 'deeper', 'shop.Deep']]);
    expect(exits('Bare')).toEqual([]);
  });

  it('are not refused where two kinds it composes write one direction, since neither reaches it', () => {
    const { exits, said } = composed(
      'kind A { grammar { exit out "a" -> yard } }\nkind B { grammar { exit out "b" -> yard } }\nkind Both is A, B { }',
    );
    expect(said).toEqual([]);
    expect(exits('Both')).toEqual([]);
  });

  it('keep one body’s exits in a direction in the order written', () => {
    const { exits } = composed(
      'kind Maze { grammar { exit north "dark" -> a when (true)  exit north "light" -> b } }',
    );
    expect(exits('Maze')).toEqual([
      ['north', 'dark', 'shop.Maze'],
      ['north', 'light', 'shop.Maze'],
    ]);
  });

  it('are read from a body by `ownExits`, only what the first tier accepts', () => {
    const { kinds } = parsed(
      'kind Hall { grammar { exit in "in" -> a  exit through "x" -> b  link way "on"  link north "n" } }',
    );
    const own = ownExits(kinds[0]!.members, 'shop.Hall');
    expect(own.map(shown)).toEqual([
      ['in', 'in', 'shop.Hall'],
      ['link way', 'on', 'shop.Hall'],
    ]);
    expect(composeExits('Hall', [], own, (origin) => origin, new Diagnostics())).toEqual(own);
  });
});

describe('an object’s exits and links: its own, and those of the kinds its `is` names', () => {
  const KINDS =
    'kind Cell { grammar { exit up "to the yard" -> yard  link onward "on"  link back "back" } }\nkind Door { grammar { exit out "to the lane" -> lane } }\nkind Front { grammar { exit out "to the street" -> street  link onward "further" } }';

  it('take a named kind’s, its own exit in a direction and its own link of a name replacing them', () => {
    expect(objectWays(KINDS, ['Cell'], '')).toEqual({
      ways: [
        ['up', 'to the yard', 'shop.Cell'],
        ['link onward', 'on', 'shop.Cell'],
        ['link back', 'back', 'shop.Cell'],
      ],
      said: [],
    });
    expect(
      objectWays(
        KINDS,
        ['Cell'],
        'grammar { exit up "into the daylight" -> yard  link back "home" }',
      ),
    ).toEqual({
      ways: [
        ['up', 'into the daylight', 'shop.hall'],
        ['link onward', 'on', 'shop.Cell'],
        ['link back', 'home', 'shop.hall'],
      ],
      said: [],
    });
  });

  it('refuse two named kinds writing one direction, or one link, at the second, keeping the first', () => {
    expect(objectWays(KINDS, ['Door', 'Front'], '')).toEqual({
      ways: [
        ['out', 'to the lane', 'shop.Door'],
        ['link onward', 'further', 'shop.Front'],
      ],
      said: [
        [
          '`hall` gets its exits `out` from both `Door` and `Front`, and one place says where `out` leads.',
          "Write `hall`'s own exits `out` to say which apply.",
        ],
      ],
    });
    expect(objectWays(KINDS, ['Cell', 'Front'], '').said).toEqual([
      [
        '`hall` gets a link `onward` from both `Cell` and `Front`, and `connect onward` could not say which it means.',
        'Write `hall`\'s own `link onward "…"` to say which applies.',
      ],
    ]);
  });

  it('take nothing from two named kinds where its own body writes the direction', () => {
    expect(
      objectWays(KINDS, ['Door', 'Front'], 'grammar { exit out "to the yard" -> yard }'),
    ).toEqual({
      ways: [
        ['out', 'to the yard', 'shop.hall'],
        ['link onward', 'further', 'shop.Front'],
      ],
      said: [],
    });
  });
});
