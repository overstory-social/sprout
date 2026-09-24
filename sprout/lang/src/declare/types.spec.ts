import { describe, expect, it } from 'vitest';

import type { PropertyDeclaration } from '../syntax/ast.js';
import { Diagnostics } from '../source/diagnostics.js';
import { EnumTable } from './enums.js';
import { parseDeclarations, parseProperty } from '../syntax/parse.js';
import { locationOf, SourceFile } from '../source/source.js';
import {
  BOOLEAN,
  checkLiteral,
  describeLiteral,
  describeType,
  identicalType,
  remedyFor,
  INTEGER_MAX,
  INTEGER_MIN,
  integer,
  resolveType,
  sameType,
  showType,
  STRING,
  typeOfLiteral,
  type ValueType,
  parameterType,
} from './types.js';
import { pinExtensions } from './extensions.js';
import { IMAGE, MEDIA, SHOW } from '../fixtures/extensions.js';

/** The enums this suite resolves against, declared the way a world declares them. */
function table(): EnumTable {
  const enums = new EnumTable();
  const diagnostics = new Diagnostics();
  const source = new SourceFile(
    'enums.sprout',
    'enum Ward { oak, silver }\nenum Drying { wet, touch_dry, cured }\n',
  );
  const declared = parseDeclarations(source, diagnostics).filter((d) => d.kind === 'enum');
  enums.add('sprout', [declared[0]!], diagnostics);
  enums.add('printers_shop', [declared[1]!], diagnostics);
  expect(diagnostics.all).toEqual([]);
  return enums;
}

const ENUMS = table();
const WARD: ValueType = { type: 'symbol', of: ENUMS.qualified('sprout', 'Ward')! };
const DRYING: ValueType = { type: 'symbol', of: ENUMS.qualified('printers_shop', 'Drying')! };

/** A property declaration, for the written type and the literal inside it. */
function property(text: string): { declared: PropertyDeclaration; diagnostics: Diagnostics } {
  const diagnostics = new Diagnostics();
  const declared = parseProperty(new SourceFile('kiln.sprout', text), diagnostics);
  expect(declared, text).not.toBeNull();
  return { declared: declared!, diagnostics };
}

function resolved(text: string, from = 'printers_shop') {
  const { declared } = property(text);
  const diagnostics = new Diagnostics();
  const type = resolveType(declared.type!, ENUMS, from, diagnostics);
  return { type, diagnostics };
}

describe('the integer range a declaration without min or max gets', () => {
  it('is the spec’s, which is also the range of elapsed', () => {
    expect(INTEGER_MIN).toBe(-2_147_483_648);
    expect(INTEGER_MAX).toBe(2_147_483_647);
    expect(integer()).toEqual({ type: 'integer', min: INTEGER_MIN, max: INTEGER_MAX });
  });
});

describe('a type resolves from what was written', () => {
  it('reads the three the language names itself', () => {
    expect(resolved(':a boolean default true').type).toEqual(BOOLEAN);
    expect(resolved(':a integer default 0').type).toEqual(integer());
    expect(resolved(':a string default ""').type).toEqual(STRING);
  });

  it('reads an enum in scope, the world’s own and the standard library’s alike', () => {
    expect(resolved(':a Drying default wet').type).toEqual(DRYING);
    expect(resolved(':a Ward default oak').type).toEqual(WARD);
  });

  it('reads an enum named with its library', () => {
    expect(resolved(':a sprout.Ward default oak').type).toEqual(WARD);
  });

  it('does not find another world’s enum unqualified', () => {
    const { type, diagnostics } = resolved(':a Drying default wet', 'ericworld');
    expect(type).toBeNull();
    expect(diagnostics.refusals[0]!.message).toBe('`Drying` is not a type.');
  });

  it('reads a list of a type', () => {
    expect(resolved(':a [Ward] default [oak]').type).toEqual({ type: 'list', element: WARD });
    expect(resolved(':a [integer] default [1]').type).toEqual({
      type: 'list',
      element: integer(),
    });
  });

  it('reads a list whose element type is itself a list', () => {
    expect(resolved(':a [[Ward]] default [[oak]]').type).toEqual({
      type: 'list',
      element: { type: 'list', element: WARD },
    });
    expect(resolved(':a [[[Ward]]] default [[[oak]]]').type).toEqual({
      type: 'list',
      element: { type: 'list', element: { type: 'list', element: WARD } },
    });
  });

  it('refuses the object type, which is never written', () => {
    const { type, diagnostics } = resolved(':a object default 0');
    expect(type).toBeNull();
    expect(diagnostics.refusals[0]!.message).toBe('The object type is never written.');
  });

  it('refuses a name that is not a type, and says what one looks like', () => {
    const { type, diagnostics } = resolved(':a Nonsense default 0');
    expect(type).toBeNull();
    expect(diagnostics.refusals[0]!.message).toBe('`Nonsense` is not a type.');
    expect(diagnostics.refusals[0]!.remedy).toContain('`boolean`');
  });
});

describe('a type taken from the literal', () => {
  const infer = (text: string) => {
    const { declared } = property(text);
    const diagnostics = new Diagnostics();
    return { type: typeOfLiteral(declared.default!, diagnostics), diagnostics };
  };

  it('is the literal’s own type, for the three that name themselves', () => {
    expect(infer(':lit false').type).toEqual(BOOLEAN);
    expect(infer(':wear 0').type).toEqual(integer());
    expect(infer(':note "a line"').type).toEqual(STRING);
  });

  it('cannot be taken from a bare option, which names no enum', () => {
    const { type, diagnostics } = infer(':ward iron');
    expect(type).toBeNull();
    expect(diagnostics.refusals[0]!.message).toBe('`iron` does not say which enum it belongs to.');
    expect(diagnostics.refusals[0]!.remedy).toContain(':state Drying.iron');
    expect(diagnostics.refusals[0]!.remedy).toContain(':state Drying default iron');
  });

  it('cannot be taken from a list, which does not say what it holds', () => {
    expect(infer(':opens [oak]').type).toBeNull();
  });
});

describe('two types are the same one, or they are not', () => {
  it('matches a type with itself', () => {
    for (const type of [BOOLEAN, STRING, integer(), WARD]) {
      expect(sameType(type, type)).toBe(true);
    }
  });

  it('does not match two different ones', () => {
    expect(sameType(BOOLEAN, STRING)).toBe(false);
    expect(sameType(integer(), STRING)).toBe(false);
  });

  it('matches two integers whatever their ranges, since a range bounds values not types', () => {
    expect(sameType(integer(0, 9), integer(0, 99))).toBe(true);
  });

  it('matches two symbols only when they are the same enum, library included', () => {
    expect(sameType(WARD, WARD)).toBe(true);
    expect(sameType(WARD, DRYING)).toBe(false);
  });

  it('matches two lists only when their elements match', () => {
    expect(sameType({ type: 'list', element: WARD }, { type: 'list', element: WARD })).toBe(true);
    expect(sameType({ type: 'list', element: WARD }, { type: 'list', element: DRYING })).toBe(
      false,
    );
  });
});

describe('a restatement keeps the type, range and all', () => {
  it('holds an integer to its range, which `sameType` does not', () => {
    expect(identicalType(integer(0, 99), integer(0, 99))).toBe(true);
    expect(identicalType(integer(0, 99), integer(0, 9))).toBe(false);
    expect(identicalType(integer(0, 99), integer())).toBe(false);
  });

  it('holds a list of integers to its element’s range', () => {
    const list = (element: ValueType): ValueType => ({ type: 'list', element });
    expect(identicalType(list(integer(0, 9)), list(integer(0, 9)))).toBe(true);
    expect(identicalType(list(integer(0, 9)), list(integer()))).toBe(false);
  });

  it('is `sameType` for everything with no range', () => {
    expect(identicalType(WARD, WARD)).toBe(true);
    expect(identicalType(WARD, DRYING)).toBe(false);
    expect(identicalType(BOOLEAN, STRING)).toBe(false);
  });
});

describe('a type says what it is, in words a message uses', () => {
  it('names itself plainly', () => {
    expect(showType(BOOLEAN)).toBe('boolean');
    expect(showType(STRING)).toBe('string');
    expect(showType(integer())).toBe('integer');
    expect(showType(integer(0, 99))).toBe('integer 0 to 99');
    expect(showType(WARD)).toBe('Ward');
    expect(showType({ type: 'list', element: WARD })).toBe('[Ward]');
    expect(showType({ type: 'list', element: { type: 'list', element: WARD } })).toBe('[[Ward]]');
  });
});

describe('a literal is a value of a type, or it is refused at the literal', () => {
  const literalOf = (text: string) => property(text).declared.default!;
  const check = (type: ValueType, text: string) => {
    const diagnostics = new Diagnostics();
    const ok = checkLiteral(type, literalOf(text), diagnostics);
    return { ok, diagnostics };
  };

  it('accepts each type’s own values', () => {
    expect(check(BOOLEAN, ':a true').ok).toBe(true);
    expect(check(integer(), ':a 4').ok).toBe(true);
    expect(check(integer(), ':a -4').ok).toBe(true);
    expect(check(STRING, ':a "x"').ok).toBe(true);
    expect(check(WARD, ':a oak').ok).toBe(true);
    expect(check({ type: 'list', element: WARD }, ':a [oak, silver]').ok).toBe(true);
  });

  it('refuses a value of another type, naming both', () => {
    const { ok, diagnostics } = check(BOOLEAN, ':a 4');
    expect(ok).toBe(false);
    expect(diagnostics.refusals[0]!.message).toBe('This holds true or false, and 4 is a number.');
    expect(diagnostics.refusals[0]!.remedy).toBe('Write `true` or `false`.');
  });

  it('refuses an integer outside the declared range', () => {
    const { ok, diagnostics } = check(integer(0, 99), ':a 100');
    expect(ok).toBe(false);
    expect(diagnostics.refusals[0]!.message).toBe('100 is outside 0 to 99.');
  });

  it('refuses an option the enum does not have, and lists the ones it does', () => {
    const { ok, diagnostics } = check(WARD, ':a oka');
    expect(ok).toBe(false);
    expect(diagnostics.refusals[0]!.message).toBe(
      '`Ward` has no option `oka`. Did you mean `oak`?',
    );
  });

  it('refuses a list holding the same value twice', () => {
    const { ok, diagnostics } = check({ type: 'list', element: WARD }, ':a [oak, oak]');
    expect(ok).toBe(false);
    expect(diagnostics.refusals.some((d) => d.message.includes('twice'))).toBe(true);
  });

  it('accepts an empty list of a written element type', () => {
    expect(check({ type: 'list', element: WARD }, ':a []').ok).toBe(true);
  });

  it('refuses a list element of the wrong type, at the element', () => {
    const { ok, diagnostics } = check({ type: 'list', element: WARD }, ':a [oak, 4]');
    expect(ok).toBe(false);
    expect(diagnostics.refusals[0]!.message).toBe(
      'This holds one of oak, silver, and 4 is a number.',
    );
  });

  it('accepts a list of lists whose inner lists differ', () => {
    const grid: ValueType = { type: 'list', element: { type: 'list', element: WARD } };
    expect(check(grid, ':a [[oak], [silver]]').ok).toBe(true);
    expect(check(grid, ':a [[oak, silver], [silver, oak]]').ok).toBe(true);
  });

  it('refuses a list of lists holding the same inner list twice', () => {
    // Two inner lists are the same when they hold the same elements in
    // the same order, which is how the no-duplicates rule is kept there.
    const grid: ValueType = { type: 'list', element: { type: 'list', element: WARD } };
    const { ok, diagnostics } = check(grid, ':a [[oak], [oak]]');
    expect(ok).toBe(false);
    expect(diagnostics.refusals[0]!.message).toBe('This list holds [oak] twice.');
    // At the second element, not at the list.
    expect(locationOf(diagnostics.refusals[0]!.at)).toBe('kiln.sprout:1:12');
  });

  it('refuses a bare option where a list of lists wants a list', () => {
    const grid: ValueType = { type: 'list', element: { type: 'list', element: WARD } };
    const { ok, diagnostics } = check(grid, ':a [[oak], oak]');
    expect(ok).toBe(false);
    expect(diagnostics.refusals[0]!.message).toBe(
      'This holds a list of Ward, and `oak` is an option.',
    );
    expect(diagnostics.refusals[0]!.remedy).toBe(
      'Write a list in brackets, as in `[…]`, holding Ward.',
    );
  });
});

describe('a literal describes itself the way a person would', () => {
  const literalOf = (text: string) => property(text).declared.default!;
  it('says what it is', () => {
    expect(describeLiteral(literalOf(':a true'))).toBe('`true` is true or false');
    expect(describeLiteral(literalOf(':a 4'))).toBe('4 is a number');
    expect(describeLiteral(literalOf(':a "x"'))).toBe('"x" is text in quotes');
    expect(describeLiteral(literalOf(':a oak'))).toBe('`oak` is an option');
    expect(describeLiteral(literalOf(':a [oak]'))).toBe('this is a list');
  });

  it('says what a type holds in words, not in its declared name', () => {
    expect(describeType(BOOLEAN)).toBe('true or false');
    expect(describeType(integer())).toBe('a whole number');
    expect(describeType(integer(0, 9))).toBe('a whole number from 0 to 9');
    expect(describeType(STRING)).toBe('text');
    expect(describeType(WARD)).toBe('one of oak, silver');
    expect(describeType({ type: 'list', element: WARD })).toBe('a list of Ward');
  });
});

describe('a refusal says what to write instead', () => {
  it('answers quoted text that names an option, or nearly, with the option, bare or with its colon', () => {
    expect(remedyFor(WARD, 'silver', 'declared')).toBe('Write `silver`, without quotes.');
    expect(remedyFor(WARD, 'silvr', 'expression')).toBe('Write `:silver`, without quotes.');
    expect(remedyFor(WARD, 'brass', 'declared')).toBe('Write one of: oak, silver.');
    expect(remedyFor(WARD, null, 'expression')).toBe(
      'Write an option, as in `:oak`. Options: oak, silver.',
    );
  });

  it('offers a condition where an expression wants true or false, and a range where there is one', () => {
    expect(remedyFor(BOOLEAN, null, 'declared')).toBe('Write `true` or `false`.');
    expect(remedyFor(BOOLEAN, null, 'expression')).toContain('or a condition');
    expect(remedyFor(integer(0, 9), null, 'expression')).toBe('Write a whole number from 0 to 9.');
    expect(remedyFor(integer(), null, 'expression')).toBe('Write a whole number, as in `1`.');
  });
});

// --- an extension's types --------------------------------------------------

/** A property written in a file that names `media` at its top where `named`, resolved against a host that has `media` or not. */
function extensionTyped(text: string, named = true, installed = [MEDIA]) {
  const source = new SourceFile('lamp.sprout', text);
  const diagnostics = new Diagnostics();
  const declared = parseProperty(source, diagnostics)!;
  const pinned = pinExtensions([{ name: 'media', major: 2 }], installed);
  const enums = new EnumTable({
    pinned,
    named: new Map(named ? [[source, new Set(['media'])]] : []),
  });
  const type = resolveType(declared.type!, enums, 'printers_shop', diagnostics);
  const accepted = type !== null && checkLiteral(type, declared.default!, diagnostics);
  return {
    type,
    accepted,
    said: diagnostics.refusals.map((d) => [locationOf(d.at), d.message, d.remedy]),
  };
}

describe('a type an extension adds', () => {
  it('resolves by the extension’s name and its own, and says so in words', () => {
    const { type, accepted, said } = extensionTyped(':image media.Image default "lamp.png"');
    expect(said).toEqual([]);
    expect(accepted).toBe(true);
    expect(type).toEqual({
      type: 'extension',
      extension: 'media',
      name: 'Image',
      definition: IMAGE,
    });
    expect(showType(type!)).toBe('media.Image');
    expect(sameType(type!, { ...type!, definition: null } as ValueType)).toBe(true);
    expect(sameType(type!, { ...type!, name: 'Sound' } as ValueType)).toBe(false);
  });

  it('is refused in a file that does not name its extension, saying what to write', () => {
    expect(extensionTyped(':image media.Image default "lamp.png"', false).said).toEqual([
      [
        'lamp.sprout:1:8',
        '`media.Image` is a type of the extension `media`, which this file does not name.',
        'Write `extension media 2` at the top of the file.',
      ],
    ]);
  });

  it('is refused where the extension adds no such type, naming the ones it does', () => {
    expect(extensionTyped(':image media.Picture default "lamp.png"').said).toEqual([
      [
        'lamp.sprout:1:8',
        'The extension `media` has no type `Picture`.',
        'Its types: `media.Image`, `media.Sound`.',
      ],
    ]);
  });

  it('is never a list’s element', () => {
    expect(extensionTyped(':images [media.Image] default []').said).toEqual([
      [
        'lamp.sprout:1:9',
        "A list does not hold `media.Image`, which is an extension's type.",
        'Declare one property of it for each value the kind holds.',
      ],
    ]);
  });

  it('takes as its literal text in quotes that the extension reads, refused in its words', () => {
    expect(extensionTyped(':image media.Image default "lamp.gif"').said).toEqual([
      [
        'lamp.sprout:1:28',
        '"lamp.gif" is not a picture: a picture\'s name ends in .png.',
        'Write the name of a picture, as in "cat.png".',
      ],
    ]);
    expect(extensionTyped(':image media.Image default 3').said).toEqual([
      [
        'lamp.sprout:1:28',
        'This holds `media.Image`, and 3 is a number.',
        'Write it as text in quotes, which the extension `media` reads.',
      ],
    ]);
  });

  it('resolves with no definition where the extension is absent, and holds its literal unread', () => {
    const { type, accepted, said } = extensionTyped(
      ':image media.Image default "anything"',
      true,
      [],
    );
    expect(said).toEqual([]);
    expect(accepted).toBe(true);
    expect(type).toEqual({
      type: 'extension',
      extension: 'media',
      name: 'Image',
      definition: null,
    });
  });
});

describe('an argument of an extension’s statement', () => {
  it('is typed as the language’s value, or as one of the extension’s own types', () => {
    const [image, caption] = SHOW.parameters;
    expect(parameterType(MEDIA, image!)).toEqual({
      type: 'extension',
      extension: 'media',
      name: 'Image',
      definition: IMAGE,
    });
    expect(parameterType(MEDIA, caption!)).toEqual(STRING);
    expect(parameterType(MEDIA, { name: 'on', type: 'boolean' })).toEqual(BOOLEAN);
    expect(parameterType(MEDIA, { name: 'n', type: 'integer' })).toEqual(integer());
    expect(parameterType(MEDIA, { name: 'x', type: { type: 'Map' } })).toBeNull();
  });
});
