import { describe, expect, it } from 'vitest';

import type { EnumDeclaration } from '../syntax/ast.js';
import { Diagnostics } from '../source/diagnostics.js';
import {
  checkEnumDeclaration,
  checkOption,
  EnumTable,
  humanisedOption,
  nearestOption,
  optionFromWords,
  qualifiedName,
  shownName,
  SPROUT,
  type DeclaredEnum,
} from './enums.js';
import { parseDeclarations } from '../syntax/parse.js';
import { locationOf, SourceFile } from '../source/source.js';
import { DEFAULT_LIMITS, limitsFrom } from '../bundle/limits.js';

/** The host’s figure, so no suite here writes the number itself. */
const OPTIONS_PER_ENUM = DEFAULT_LIMITS.caps.optionsPerEnum;

/** An enum as the parser builds it, so the suite tests the real node. */
function declared(text: string): EnumDeclaration {
  const diagnostics = new Diagnostics();
  const [first] = parseDeclarations(new SourceFile('ward.sprout', text), diagnostics);
  expect(diagnostics.refusals, text).toEqual([]);
  return first as EnumDeclaration;
}

const WARD = declared('enum Ward { oak, silver }');
const DRYING = declared('enum Drying { raw, leather, dry, bisque, glazed }');

describe('an enum’s identity is its library and its name', () => {
  it('writes as one', () => expect(qualifiedName('sprout', 'Ward')).toBe('sprout.Ward'));

  it('is shown bare only to the library that declared it', () => {
    expect(shownName('printers_shop.Ward', 'printers_shop')).toBe('Ward');
    expect(shownName('sprout.Ward', 'printers_shop')).toBe('sprout.Ward');
    // A prefix of another library's name is not that library.
    expect(shownName('printers_shop2.Ward', 'printers_shop')).toBe('printers_shop2.Ward');
  });

  it('keeps two libraries’ enums of one name apart', () => {
    const table = new EnumTable();
    const diagnostics = new Diagnostics();
    table.add('sprout', [WARD], diagnostics);
    table.add('ericworld', [declared('enum Ward { brass, iron }')], diagnostics);
    expect(diagnostics.all).toEqual([]);
    expect(table.qualified('sprout', 'Ward')!.options).toEqual(['oak', 'silver']);
    expect(table.qualified('ericworld', 'Ward')!.options).toEqual(['brass', 'iron']);
  });

  it('refuses two of one name in one library, naming the second', () => {
    const table = new EnumTable();
    const diagnostics = new Diagnostics();
    const second = declared('enum Ward { brass }');
    table.add('printers_shop', [WARD, second], diagnostics);
    expect(diagnostics.refusals).toHaveLength(1);
    expect(diagnostics.refusals[0]!.at).toBe(second.name.at);
    expect(table.qualified('printers_shop', 'Ward')!.options).toEqual(['oak', 'silver']);
  });

  it('knows nothing about an enum nobody declared', () => {
    expect(new EnumTable().qualified('sprout', 'Nothing')).toBeNull();
  });

  it('lists what it holds, in the order it was given', () => {
    const table = new EnumTable();
    table.add('sprout', [WARD, DRYING], new Diagnostics());
    expect(table.all().map((e) => e.name)).toEqual(['Ward', 'Drying']);
  });
});

describe('an unqualified enum is the world’s own, then the standard library’s', () => {
  const table = new EnumTable();
  table.add(SPROUT, [declared('enum Ward { oak, silver }')], new Diagnostics());
  table.add('printers_shop', [declared('enum Season { spring, autumn }')], new Diagnostics());

  it('finds the world’s own', () => {
    expect(table.unqualified('Season', 'printers_shop')!.library).toBe('printers_shop');
  });

  it('finds the standard library’s from anywhere, since `sprout` is always in scope', () => {
    expect(table.unqualified('Ward', 'printers_shop')!.library).toBe(SPROUT);
  });

  it('prefers the world’s own where both declare the name', () => {
    // The warning for shadowing a library name is `bundle/declarations.ts`'s; this is only the order.
    table.add('printers_shop', [declared('enum Ward { brass }')], new Diagnostics());
    expect(table.unqualified('Ward', 'printers_shop')!.library).toBe('printers_shop');
    expect(table.qualified(SPROUT, 'Ward')!.options).toEqual(['oak', 'silver']);
  });

  it('does not find another world’s', () => {
    expect(table.unqualified('Season', 'ericworld')).toBeNull();
  });
});

describe('an option is typed and rendered in its humanised form', () => {
  it('reads an underscore as a space', () => {
    expect(humanisedOption('the_press')).toBe('the press');
    expect(humanisedOption('touch_dry')).toBe('touch dry');
  });

  it('leaves a single word alone', () => expect(humanisedOption('oak')).toBe('oak'));

  it('takes a visitor’s words back to the option', () => {
    expect(optionFromWords('the press')).toBe('the_press');
    expect(optionFromWords('  the   press  ')).toBe('the_press');
  });

  it('round-trips', () => {
    for (const option of ['oak', 'the_press', 'touch_dry', 'a_b_c']) {
      expect(optionFromWords(humanisedOption(option))).toBe(option);
    }
  });
});

describe('a misspelling is answered with what it probably meant, or with nothing', () => {
  const options = ['raw', 'leather', 'dry', 'bisque', 'glazed'];

  it('offers the option one edit away', () => {
    expect(nearestOption('dyr', options)).toBe('dry');
    expect(nearestOption('bisqe', options)).toBe('bisque');
    expect(nearestOption('glazd', options)).toBe('glazed');
  });

  it('offers nothing for a word that is not a slip', () => {
    expect(nearestOption('wet', options)).toBeNull();
    expect(nearestOption('completely_different', options)).toBeNull();
  });

  it('offers nothing when two are equally close, since naming either would be a guess', () => {
    expect(nearestOption('oam', ['oak', 'oat'])).toBeNull();
  });

  it('offers the exact word when it is there, which the caller checks first anyway', () => {
    expect(nearestOption('dry', options)).toBe('dry');
  });

  it('is not fooled by an empty option set', () => expect(nearestOption('dry', [])).toBeNull());
});

describe('checking a symbol against the enum it is meant for', () => {
  const target: DeclaredEnum = {
    library: 'printers_shop',
    name: 'Drying',
    options: ['raw', 'leather', 'dry', 'bisque', 'glazed'],
    declaration: DRYING,
  };
  const where = new SourceFile('vessel.sprout', 'kind Vessel {\n  :state dyr\n}\n');
  const at = where.span(where.text.indexOf('dyr'), where.text.indexOf('dyr') + 3);

  it('accepts an option the enum holds', () => {
    const diagnostics = new Diagnostics();
    expect(checkOption(target, 'dry', at, diagnostics)).toBe(true);
    expect(diagnostics.all).toEqual([]);
  });

  it('refuses one it does not, at the symbol, and lists what it could be', () => {
    const diagnostics = new Diagnostics();
    expect(checkOption(target, 'dyr', at, diagnostics)).toBe(false);
    const [problem] = diagnostics.refusals;
    expect(locationOf(problem!.at)).toBe('vessel.sprout:2:10');
    expect(problem!.message).toBe('`Drying` has no option `dyr`. Did you mean `dry`?');
    expect(problem!.remedy).toBe('Options: raw, leather, dry, bisque, glazed.');
  });

  it('does not guess when it cannot', () => {
    const diagnostics = new Diagnostics();
    checkOption(target, 'sideways', at, diagnostics);
    expect(diagnostics.refusals[0]!.message).toBe('`Drying` has no option `sideways`.');
    expect(diagnostics.refusals[0]!.remedy).toContain('Options:');
  });
});

describe('a declaration has to agree with itself', () => {
  it('refuses an option listed twice, at the second one', () => {
    const diagnostics = new Diagnostics();
    const twice = declared('enum Ward { oak, silver, oak }');
    checkEnumDeclaration(twice, OPTIONS_PER_ENUM, diagnostics);
    expect(diagnostics.refusals).toHaveLength(1);
    expect(diagnostics.refusals[0]!.message).toContain('twice');
    expect(diagnostics.refusals[0]!.at).toBe(twice.options[2]!.at);
  });

  it('says nothing about a declaration that does', () => {
    const diagnostics = new Diagnostics();
    checkEnumDeclaration(WARD, OPTIONS_PER_ENUM, diagnostics);
    expect(diagnostics.all).toEqual([]);
  });
});

describe('an enum holds at most as many options as the host allows', () => {
  /** A host with a small cap, so the suite reads as the rule and not as a wall of options. */
  const small = limitsFrom({ caps: { optionsPerEnum: 3 } }).caps.optionsPerEnum;
  const three = declared('enum Ward { oak, silver, iron }');
  const four = declared('enum Ward { oak, silver, iron, ash }');

  it('says nothing about an enum that holds exactly as many as it may', () => {
    const diagnostics = new Diagnostics();
    checkEnumDeclaration(three, small, diagnostics);
    expect(diagnostics.all).toEqual([]);
  });

  it('refuses the option past the cap, at that option and once', () => {
    const diagnostics = new Diagnostics();
    checkEnumDeclaration(four, small, diagnostics);
    expect(diagnostics.refusals).toHaveLength(1);
    expect(diagnostics.refusals[0]!.at).toBe(four.options[3]!.at);
    expect(locationOf(diagnostics.refusals[0]!.at)).toBe('ward.sprout:1:32');
  });

  it('names the count and the cap, and says what to do about it', () => {
    const diagnostics = new Diagnostics();
    checkEnumDeclaration(four, small, diagnostics);
    expect(diagnostics.refusals[0]!.message).toBe(
      '`Ward` has 4 options, and 3 is as many as it may have.',
    );
    expect(diagnostics.refusals[0]!.remedy).toBe('Take some out, or split `Ward` into two enums.');
  });

  it('counts against the host’s figure, not one of its own', () => {
    const diagnostics = new Diagnostics();
    checkEnumDeclaration(four, OPTIONS_PER_ENUM, diagnostics);
    expect(diagnostics.all).toEqual([]);
  });

  it('still names the duplicate as well, because both are true of the enum', () => {
    const diagnostics = new Diagnostics();
    checkEnumDeclaration(declared('enum Ward { oak, silver, iron, oak }'), small, diagnostics);
    expect(diagnostics.refusals.map((d) => d.message)).toEqual([
      '`Ward` has 4 options, and 3 is as many as it may have.',
      '`Ward` lists `oak` twice.',
    ]);
  });
});
