import { describe, expect, it } from 'vitest';

import type { KindDeclaration } from '../syntax/ast.js';
import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { Diagnostics } from '../source/diagnostics.js';
import { locationOf, SourceFile } from '../source/source.js';
import { parseDeclarations } from '../syntax/parse.js';
import { EnumTable } from './enums.js';
import { checkExitLines, composeExits, isDirection, ownExits, type ResolvedExit } from './exits.js';
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

/** Every kind in `text`, composed: each one's exits by direction, label and origin. */
function composed(text: string) {
  const { kinds: declared, diagnostics } = parsed(text);
  const kinds = new KindTable();
  kinds.add('shop', declared, diagnostics);
  kinds.resolve('shop', new EnumTable(), diagnostics);
  return {
    exits: (name: string) =>
      kinds
        .qualified('shop', name)!
        .exits.map((exit) => [exit.direction, exit.line.label.text, exit.origin]),
    said: diagnostics.refusals.map((d) => [locationOf(d.at), d.message, d.remedy]),
  };
}

describe('one body’s exits and links, in the first tier', () => {
  it('say nothing of ways out written well, several sharing a direction', () => {
    expect(
      checked(
        'kind Hall { grammar { exit north "dark" -> a when (true)  exit north "light" -> b  link south "back"  exit in "in" -> c } }',
      ),
    ).toEqual([]);
  });

  it('refuse a word outside the closed set, the spec’s own `through` among them', () => {
    expect(
      checked('kind Wardrobe { grammar { exit through "through the fur coats" -> narnia } }'),
    ).toEqual([
      [
        'k.sprout:1:32',
        '`through` is not a direction. A way out leads `north`, `south`, `east`, `west`, `northeast`, `northwest`, `southeast`, `southwest`, `up`, `down`, `in` or `out`.',
        'Write one of those, and say the rest in the label, as in `exit in "through the fur coats" -> narnia`.',
      ],
    ]);
    expect(checked('kind Cell { grammar { link onward "deeper" } }')[0]![2]).toBe(
      'Write one of those, and say the rest in the label, as in `link in "deeper"`.',
    );
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

  it('refuse an empty label, and two links of one body in one direction', () => {
    expect(checked('kind Cell { grammar { link north " "  link north "on" } }')).toEqual([
      [
        'k.sprout:1:34',
        "This link's label is empty, and it is what a visitor reads and types for the way out.",
        'Write where it goes, as in `link north "out to the yard"`.',
      ],
      [
        'k.sprout:1:44',
        '`Cell` writes two links `north`, and `connect north` could not say which it means.',
        'Give each link a direction of its own.',
      ],
    ]);
  });

  it('refuse the first way out past the host’s cap, exits and links alike', () => {
    const caps = { ...DEFAULT_LIMITS.caps, exitsPerPlace: 2 };
    expect(
      checked('kind Hall { grammar { exit in "a" -> a  link out "b"  exit up "c" -> c } }', caps),
    ).toEqual([
      [
        'k.sprout:1:55',
        '`Hall` writes more than 2 exits and links, and 2 is as many as a place may have.',
        'Keep the ways out a visitor needs here: several guarded exits in one direction each count.',
      ],
    ]);
    expect(checked('kind Hall { grammar { exit in "a" -> a  link out "b" } }', caps)).toEqual([]);
  });

  it('knows the closed set, and nothing else, as a direction', () => {
    expect(['north', 'southwest', 'in', 'out', 'up'].every(isDirection)).toBe(true);
    expect(['n', 'through', 'onward', 'North'].some(isDirection)).toBe(false);
  });
});

describe('exits and links, composed one direction at a time', () => {
  it('give a composer its own exits in a direction, replacing a composed one there', () => {
    const { exits, said } = composed(
      'kind Cell { grammar { exit up "to the yard" -> yard  link north "on" } }\nkind Mouth is Cell { grammar { exit up "into the daylight" -> yard } }',
    );
    expect(said).toEqual([]);
    expect(exits('Mouth')).toEqual([
      ['up', 'into the daylight', 'shop.Mouth'],
      ['north', 'on', 'shop.Cell'],
    ]);
  });

  it('keep one source’s exits in a direction in the order written', () => {
    const { exits } = composed(
      'kind Maze { grammar { exit north "dark" -> a when (true)  exit north "light" -> b } }\nkind Hall is Maze { }',
    );
    expect(exits('Hall')).toEqual([
      ['north', 'dark', 'shop.Maze'],
      ['north', 'light', 'shop.Maze'],
    ]);
  });

  it('take one origin reached by two paths once', () => {
    const { exits, said } = composed(
      'kind Door { grammar { exit out "out" -> yard } }\nkind A is Door { }\nkind B is Door { }\nkind Both is A, B { }',
    );
    expect(said).toEqual([]);
    expect(exits('Both')).toEqual([['out', 'out', 'shop.Door']]);
  });

  it('refuse two sources of one direction at the kind that brought the second', () => {
    const { said, exits } = composed(
      'kind A { grammar { exit out "a" -> yard } }\nkind B { grammar { exit out "b" -> yard } }\nkind Both is A, B { }',
    );
    expect(said).toEqual([
      [
        'k.sprout:3:17',
        '`Both` gets its ways `out` from both `A` and `B`, and one place says where `out` leads.',
        "Write `Both`'s own exits `out` to say which apply.",
      ],
    ]);
    expect(exits('Both')).toEqual([['out', 'a', 'shop.A']]);
  });

  it('are read from a body by `ownExits`, and combined by `composeExits`', () => {
    const { kinds } = parsed('kind Hall { grammar { exit in "in" -> a  exit through "x" -> b } }');
    const own: ResolvedExit[] = ownExits(kinds[0]!.members, 'shop.Hall');
    expect(own.map((exit) => exit.direction)).toEqual(['in']);
    expect(composeExits('Hall', [], own, (origin) => origin, new Diagnostics())).toEqual(own);
  });
});
