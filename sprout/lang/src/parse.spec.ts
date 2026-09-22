import { describe, expect, it } from 'vitest';

import type { EnumDeclaration, Expr } from './ast.js';
import { Diagnostics, type Diagnostic } from './diagnostics.js';
import { unspanned } from './nodes.js';
import {
  DECLARATIONS,
  parseDeclarations,
  parseExpression,
  parseLet,
  parseProperty,
  parseRemembers,
} from './parse.js';
import { locationOf, SourceFile, textOf } from './source.js';
import { DEFAULT_LIMITS } from './limits.js';

function read(text: string, name = 'ward.sprout') {
  const diagnostics = new Diagnostics();
  const declarations = parseDeclarations(new SourceFile(name, text), diagnostics);
  return { declarations, diagnostics, refusals: diagnostics.refusals as readonly Diagnostic[] };
}

/** An enum's options as plain words, for a suite that is not about nodes. */
const optionsOf = (declared: EnumDeclaration): string[] =>
  declared.options.map((option) => option.name.text);

describe('an enum declaration', () => {
  it('reads as its name and its options', () => {
    const { declarations, refusals } = read('enum Ward { oak, silver }');
    expect(refusals).toEqual([]);
    expect(declarations).toHaveLength(1);
    const [ward] = declarations as EnumDeclaration[];
    expect(ward!.kind).toBe('enum');
    expect(ward!.name.text).toBe('Ward');
    expect(optionsOf(ward!)).toEqual(['oak', 'silver']);
  });

  it('reads the spec’s own enums', () => {
    const { declarations, refusals } = read(
      [
        'enum Season { spring, summer, autumn, winter }',
        'enum Ward   { brass, iron }',
        'enum Drying { wet, touch_dry, cured }',
        'enum Topic  { the_press, the_cat, the_cellar }',
        'enum Cuff   { dry, damp }',
      ].join('\n'),
    );
    expect(refusals).toEqual([]);
    expect(declarations.map((d) => (d as EnumDeclaration).name.text)).toEqual([
      'Season',
      'Ward',
      'Drying',
      'Topic',
      'Cuff',
    ]);
    expect(optionsOf(declarations[3] as EnumDeclaration)).toEqual([
      'the_press',
      'the_cat',
      'the_cellar',
    ]);
  });

  it('takes one option as readily as many', () => {
    expect(optionsOf(read('enum Only { one }').declarations[0] as EnumDeclaration)).toEqual([
      'one',
    ]);
  });

  it('does not care how it is laid out', () => {
    const spread = read('enum Ward\n{\n  oak,\n  silver\n}\n');
    expect(spread.refusals).toEqual([]);
    expect(optionsOf(spread.declarations[0] as EnumDeclaration)).toEqual(['oak', 'silver']);
  });

  it('ignores a comment between its options', () => {
    const { declarations, refusals } = read('enum Ward { oak, // the cheap one\n silver }');
    expect(refusals).toEqual([]);
    expect(optionsOf(declarations[0] as EnumDeclaration)).toEqual(['oak', 'silver']);
  });

  it('reads several declarations from one file', () => {
    const { declarations, refusals } = read('enum A { a }\nenum B { b }\nenum C { c }');
    expect(refusals).toEqual([]);
    expect(declarations).toHaveLength(3);
  });

  it('reads an empty file as no declarations', () => {
    expect(read('').declarations).toEqual([]);
    expect(read('// nothing here yet\n').declarations).toEqual([]);
  });
});

describe('every node carries the span of what it was built from', () => {
  const source = new SourceFile('ward.sprout', 'enum Ward { oak, silver }\n');
  const declarations = parseDeclarations(source, new Diagnostics());
  const ward = declarations[0] as EnumDeclaration;

  it('keeps the rule every node keeps', () => expect(unspanned(declarations)).toEqual([]));

  it('spans the declaration from its keyword to its last option', () => {
    expect(textOf(ward.at)).toBe('enum Ward { oak, silver');
  });

  it('spans the name as the name', () => {
    expect(textOf(ward.name.at)).toBe('Ward');
    expect(locationOf(ward.name.at)).toBe('ward.sprout:1:6');
  });

  it('spans each option as itself, so a problem with one names it', () => {
    expect(ward.options.map((o) => textOf(o.at))).toEqual(['oak', 'silver']);
    expect(locationOf(ward.options[1]!.at)).toBe('ward.sprout:1:18');
  });

  it('gives the option’s name its own span too', () => {
    expect(textOf(ward.options[0]!.name.at)).toBe('oak');
  });
});

describe('what the parser refuses, and where it says so', () => {
  it('refuses an enum with no name, pointing where the name should be', () => {
    const { declarations, refusals } = read('enum { oak }');
    expect(declarations).toEqual([]);
    expect(refusals[0]!.message).toBe('An enum needs a name.');
    expect(locationOf(refusals[0]!.at)).toBe('ward.sprout:1:6');
    expect(refusals[0]!.remedy).toContain('starts with a capital');
  });

  it('refuses a name that does not start with a capital', () => {
    const { refusals } = read('enum ward { oak }');
    expect(refusals[0]!.message).toBe('An enum needs a name.');
    expect(locationOf(refusals[0]!.at)).toBe('ward.sprout:1:6');
  });

  it('refuses options that are not in braces, and shows what to write', () => {
    const { refusals } = read('enum Ward oak, silver');
    expect(refusals[0]!.message).toBe('The options of `Ward` go in braces.');
    expect(refusals[0]!.remedy).toBe(
      'Write `enum Ward { oak, silver }`, listing the values it can hold.',
    );
  });

  it('refuses an enum with no options at all', () => {
    const { declarations, refusals } = read('enum Ward { }');
    expect(declarations).toEqual([]);
    expect(refusals[0]!.message).toContain('no options');
    expect(refusals[0]!.at).toBeDefined();
  });

  it('refuses an option that starts with a capital, and says what an option looks like', () => {
    const { refusals } = read('enum Ward { Oak }');
    expect(refusals[0]!.message).toBe('`Ward` cannot hold `Oak`, which starts with a capital.');
    expect(refusals[0]!.remedy).toContain('lower-case word');
    expect(locationOf(refusals[0]!.at)).toBe('ward.sprout:1:13');
  });

  it('describes whatever wrong thing it found in words a person uses', () => {
    expect(read('enum Ward { "oak" }').refusals[0]!.message).toContain('text in quotes');
    expect(read('enum Ward { 4 }').refusals[0]!.message).toContain('the number 4');
    expect(read('enum Ward { :oak }').refusals[0]!.message).toContain('a property or a message');
  });

  it('refuses a missing comma, pointing where it should go', () => {
    const { refusals } = read('enum Ward { oak silver }');
    expect(refusals[0]!.message).toBe('`Ward` needs a comma between its options.');
    expect(locationOf(refusals[0]!.at)).toBe('ward.sprout:1:17');
  });

  it('refuses a comma after the last option', () => {
    const { refusals } = read('enum Ward { oak, silver, }');
    expect(refusals[0]!.message).toBe('`Ward` has a comma after its last option.');
    expect(refusals[0]!.remedy).toContain('separated by commas, not ended by them');
  });

  it('refuses an enum that is never closed, at the end of the file', () => {
    const { refusals } = read('enum Ward { oak, silver');
    expect(refusals[0]!.message).toBe('`Ward` is never closed.');
    expect(refusals[0]!.remedy).toBe('Add a } after its options.');
    expect(locationOf(refusals[0]!.at)).toBe('ward.sprout:1:24');
  });

  it('refuses a word it cannot read at the top of a file, and says what it can read', () => {
    const { refusals } = read('world printers_shop { }');
    expect(refusals[0]!.message).toBe('Sprout does not know what to do with "world" here.');
    expect(refusals[0]!.remedy).toBe(
      'A file holds declarations, and this compiler reads `enum` and `message`.',
    );
    expect(locationOf(refusals[0]!.at)).toBe('ward.sprout:1:1');
  });

  it('names every declaration it reads, so the message grows with the compiler', () => {
    for (const word of DECLARATIONS) {
      expect(read('nonsense').refusals[0]!.remedy).toContain(`\`${word}\``);
    }
  });
});

describe('a declaration it cannot read costs that declaration, not the file', () => {
  it('keeps reading after a bad one', () => {
    const { declarations, refusals } = read('enum { oak }\nenum Ward { silver }');
    expect(refusals).toHaveLength(1);
    expect(declarations).toHaveLength(1);
    expect((declarations[0] as EnumDeclaration).name.text).toBe('Ward');
  });

  it('keeps reading after an unknown word at the top of a file', () => {
    const { declarations, refusals } = read('kind Thing { }\nenum Ward { oak }');
    expect(refusals).toHaveLength(1);
    expect(declarations.map((d) => (d as EnumDeclaration).name.text)).toEqual(['Ward']);
  });

  it('keeps reading after a bad option, and does not swallow the next declaration', () => {
    const { declarations, refusals } = read('enum Ward { Oak, silver }\nenum Cuff { dry }');
    expect(refusals).toHaveLength(1);
    expect(declarations.map((d) => (d as EnumDeclaration).name.text)).toEqual(['Cuff']);
  });

  it('reports every bad declaration, not the first', () => {
    const { refusals } = read('enum { a }\nenum { b }\nenum { c }');
    expect(refusals).toHaveLength(3);
  });

  it('never throws, whatever it is given', () => {
    for (const text of [
      'enum',
      'enum Ward',
      'enum Ward {',
      'enum Ward { ',
      'enum Ward { ,',
      'enum Ward { oak',
      'enum Ward } oak {',
      '{ } , :',
      'enum enum enum',
      '}',
      ',,,',
      'enum Ward { oak } }',
    ]) {
      expect(() => read(text), text).not.toThrow();
    }
  });

  it('gives back only declarations it actually read', () => {
    for (const text of ['enum', 'enum Ward', 'enum Ward {', 'enum Ward { }']) {
      expect(read(text).declarations, text).toEqual([]);
    }
  });
});

describe('a lexical problem is reported once, and the parser reads around it', () => {
  it('reports the bad character and still reads the enums either side of it', () => {
    const { declarations, refusals } = read('enum Ward { oak, silver }\n% \nenum Cuff { dry }');
    // The lexer steps over the character it refused, so the parser never
    // sees one and does not report the same mistake a second time.
    expect(refusals.map((d) => d.message)).toEqual(['Sprout does not use the character "%".']);
    expect(declarations).toHaveLength(2);
  });

  it('reads an enum whose own name is misspelt into the lexer’s hands', () => {
    const { refusals } = read('enum Wa%rd { oak }');
    expect(refusals.map((d) => d.message)).toContain('Sprout does not use the character "%".');
  });
});

describe('a property declaration, as a kind or an object writes one', () => {
  const declare = (text: string) => {
    const diagnostics = new Diagnostics();
    const declared = parseProperty(new SourceFile('kiln.sprout', text), diagnostics);
    return { declared, diagnostics, refusals: diagnostics.refusals };
  };

  it('reads a literal with the type left out', () => {
    const { declared, refusals } = declare(':lit false');
    expect(refusals).toEqual([]);
    expect(declared!.name.text).toBe('lit');
    expect(declared!.type).toBeNull();
    expect(declared!.default).toMatchObject({ kind: 'boolean', value: false });
  });

  it('reads a written type and a default', () => {
    const { declared } = declare(':lit boolean default false');
    expect(declared!.type).toMatchObject({ kind: 'named-type', name: { text: 'boolean' } });
    expect(declared!.default).toMatchObject({ kind: 'boolean', value: false });
  });

  it('reads an integer with a range', () => {
    const { declared } = declare(':wear 0 min 0 max 99');
    expect(declared!.min).toMatchObject({ value: 0 });
    expect(declared!.max).toMatchObject({ value: 99 });
  });

  it('reads an enum and a bare option as its default', () => {
    const { declared } = declare(':state Drying default wet');
    expect(declared!.type).toMatchObject({ name: { text: 'Drying' } });
    expect(declared!.default).toMatchObject({ kind: 'option-literal', name: { text: 'wet' } });
  });

  it('reads a list type and a list default', () => {
    const { declared } = declare(':opens [Ward] default [oak, silver]');
    expect(declared!.type).toMatchObject({ kind: 'list-type' });
    const value = declared!.default!;
    expect(value.kind).toBe('list-literal');
    if (value.kind !== 'list-literal') expect.unreachable('just asserted it is one');
    else expect(value.elements.map((e) => e.kind)).toEqual(['option-literal', 'option-literal']);
  });

  it('reads an enum named with its library', () => {
    const { declared, refusals } = declare(':ward sprout.Ward default oak');
    expect(refusals).toEqual([]);
    expect(declared!.type).toMatchObject({ library: { text: 'sprout' }, name: { text: 'Ward' } });
  });

  it('tells `[Ward]` the type from `[oak]` the value by the capital', () => {
    expect(declare(':a [Ward] default [oak]').declared!.type!.kind).toBe('list-type');
    expect(declare(':a [oak]').declared!.type).toBeNull();
  });

  it('reads a negative number', () => {
    expect(declare(':below -5').declared!.default).toMatchObject({ kind: 'integer', value: -5 });
  });

  it('keeps a span on every node it built', () => {
    expect(unspanned(declare(':opens [Ward] default [oak, silver]').declared)).toEqual([]);
  });

  it('refuses a written type with nothing to start at', () => {
    const { declared, refusals } = declare(':lit boolean');
    expect(declared).toBeNull();
    expect(refusals[0]!.message).toBe('`:lit` has a type and no value to start at.');
    expect(refusals[0]!.remedy).toContain('default');
  });

  it('refuses a name with no colon before it', () => {
    const { refusals } = declare('lit false');
    expect(refusals[0]!.message).toContain('A property starts with its name');
  });

  it('refuses a min that is not a whole number', () => {
    expect(declare(':wear 0 min "x"').refusals[0]!.message).toBe('A min is a whole number.');
  });

  it('refuses the same bound twice', () => {
    expect(declare(':wear 0 min 0 min 1').refusals[0]!.message).toBe('`:wear` says min twice.');
  });

  it('refuses a list that is never closed, and one missing a comma', () => {
    expect(declare(':a [Ward] default [oak').refusals[0]!.message).toBe(
      'This list is never closed.',
    );
    expect(declare(':a [Ward] default [oak silver]').refusals[0]!.message).toBe(
      'A list needs a comma between its elements.',
    );
  });

  it('refuses a minus sign with no number after it', () => {
    expect(declare(':a -').refusals[0]!.message).toBe('A minus sign needs a number after it.');
  });

  it('never throws, whatever it is given', () => {
    for (const text of [
      ':a',
      ':a default',
      ':a [',
      ':a [Ward',
      ':a [] default',
      ':a min',
      ':',
      ':a sprout.',
      ':a boolean default',
    ]) {
      expect(() => declare(text), text).not.toThrow();
    }
  });
});

describe('a :remembers, as an object writes one', () => {
  const remember = (text: string) => {
    const diagnostics = new Diagnostics();
    const declared = parseRemembers(new SourceFile('kiln.sprout', text), diagnostics);
    return { declared, refusals: diagnostics.refusals };
  };

  it('reads the spec’s own example', () => {
    const { declared, refusals } = remember(
      ':remembers [handled: false, ward_seen: Ward default oak, visits: 0 min 0 max 99]',
    );
    expect(refusals).toEqual([]);
    expect(declared!.properties.map((p) => p.name.text)).toEqual([
      'handled',
      'ward_seen',
      'visits',
    ]);
    expect(declared!.properties[2]!.max).toMatchObject({ value: 99 });
  });

  it('reads one that remembers nothing', () => {
    expect(remember(':remembers []').declared!.properties).toEqual([]);
  });

  it('keeps a span on every node it built', () => {
    expect(unspanned(remember(':remembers [visits: 0]').declared)).toEqual([]);
  });

  it('refuses a name with a colon before it, which is the other syntax', () => {
    expect(remember(':remembers [:visits 0]').refusals[0]!.message).toContain(
      'A remembered property starts with its name',
    );
  });

  it('refuses a missing colon between a name and its value', () => {
    expect(remember(':remembers [visits 0]').refusals[0]!.message).toBe(
      '`visits` needs a colon between its name and its value.',
    );
  });

  it('refuses a missing comma, and one that is never closed', () => {
    expect(remember(':remembers [a: 0 b: 1]').refusals[0]!.message).toContain('needs a comma');
    expect(remember(':remembers [a: 0').refusals[0]!.message).toBe(
      'This `:remembers` is never closed.',
    );
  });

  it('refuses brackets left out altogether', () => {
    expect(remember(':remembers visits: 0').refusals[0]!.message).toBe(
      'What an object remembers goes in brackets.',
    );
  });

  it('never throws, whatever it is given', () => {
    for (const text of [':remembers', ':remembers [', ':remembers [a', ':remembers [a:', ':x []']) {
      expect(() => remember(text), text).not.toThrow();
    }
  });
});

describe('a forgotten brace does not eat the declaration after it', () => {
  it('names the unclosed enum and keeps the sibling that follows', () => {
    const { declarations, refusals } = read('enum Ward {\n  oak\nenum Two { a, b }\n');
    expect(refusals.map((d) => d.message)).toEqual(['`Ward` is never closed.']);
    expect(declarations.map((d) => (d as EnumDeclaration).name.text)).toEqual(['Ward', 'Two']);
    expect(optionsOf(declarations[0] as EnumDeclaration)).toEqual(['oak']);
  });

  it('does the same for a message after it', () => {
    const { declarations, refusals } = read('enum Ward {\n  oak\nmessage :stir\n');
    expect(refusals.map((d) => d.message)).toEqual(['`Ward` is never closed.']);
    expect(declarations.map((d) => d.kind)).toEqual(['enum', 'message']);
  });

  it('reads a declaration keyword as one wherever its own name follows it', () => {
    for (const word of DECLARATIONS) {
      const { declarations } = read(`enum Ward {\n  oak\n${word} Two { a }`);
      expect(optionsOf(declarations[0] as EnumDeclaration), word).toEqual(['oak']);
    }
  });

  it('reads one at the very end of the file as an option, not as a declaration', () => {
    // The file stops: the author's one mistake is the missing brace.
    // Treating the word as a declaration they started would refuse them
    // twice, once for the brace and once for a name they never wrote.
    const { declarations, refusals } = read('enum Ward { oak, message');
    expect(refusals.map((d) => d.message)).toEqual(['`Ward` is never closed.']);
    expect(optionsOf(declarations[0] as EnumDeclaration)).toEqual(['oak', 'message']);
  });

  it('points at the keyword, which is where the brace should have been', () => {
    const { refusals } = read('enum Ward {\n  oak\nenum Two { a }\n');
    expect(locationOf(refusals[0]!.at)).toBe('ward.sprout:3:1');
  });

  it('says it once, not once per option it had already read', () => {
    const { refusals } = read('enum Ward {\n  oak, silver, brass\nenum Two { a }\n');
    expect(refusals).toHaveLength(1);
  });
});

describe('a character the lexer stepped over is not reported again as a missing separator', () => {
  it('says only what the lexer said, inside an enum', () => {
    const { refusals } = read('enum Ward {\n  oak % silver\n}');
    expect(refusals.map((d) => d.message)).toEqual(['Sprout does not use the character "%".']);
  });

  it('says only what the lexer said, inside a list', () => {
    const diagnostics = new Diagnostics();
    parseProperty(new SourceFile('k.sprout', ':a [Ward] default [oak % silver]'), diagnostics);
    expect(diagnostics.refusals.map((d) => d.message)).toEqual([
      'Sprout does not use the character "%".',
    ]);
  });

  it('says only what the lexer said, inside a :remembers', () => {
    const diagnostics = new Diagnostics();
    parseRemembers(new SourceFile('k.sprout', ':remembers [a: 0 % b: 1]'), diagnostics);
    expect(diagnostics.refusals.map((d) => d.message)).toEqual([
      'Sprout does not use the character "%".',
    ]);
  });

  it('still reports a comma an author really did forget', () => {
    const { refusals } = read('enum Ward { oak silver }');
    expect(refusals.map((d) => d.message)).toEqual(['`Ward` needs a comma between its options.']);
  });
});

describe('a type that failed to parse is not mistaken for no type at all', () => {
  const declare = (text: string) => {
    const diagnostics = new Diagnostics();
    const declared = parseProperty(new SourceFile('kiln.sprout', text), diagnostics);
    return { declared, refusals: diagnostics.refusals };
  };

  it('gives back nothing, having already said what was wrong', () => {
    const { declared, refusals } = declare(':opens [Ward default oak');
    expect(declared).toBeNull();
    expect(refusals.map((d) => d.message)).toEqual(['A list type is never closed.']);
  });

  it('does not swallow the `default` keyword as a value', () => {
    const { declared, refusals } = declare(':x sprout.lower default true');
    expect(declared).toBeNull();
    expect(refusals.map((d) => d.message)).toEqual(['`sprout.` is not followed by a name.']);
  });

  it('still reads a property whose type is genuinely left out', () => {
    expect(declare(':lit false').declared!.type).toBeNull();
  });
});

// The two describes below are paired on purpose. Twice now, a fix to
// this file's recovery was specced only against the input that prompted
// it, and each time the adjacent input — the same shape, read the other
// way — was the one that broke. So each case is written as a table with
// both readings side by side, and neither can be changed without the
// other being looked at.

describe('`enum` and `message` inside a body: an option, or a forgotten brace', () => {
  const asOption: [string, string[]][] = [
    ['enum Ward { message, silver }', ['message', 'silver']],
    ['enum Ward { oak, message }', ['oak', 'message']],
    ['enum Ward { enum, silver }', ['enum', 'silver']],
    ['enum Ward { message }', ['message']],
  ];
  for (const [text, options] of asOption) {
    it(`reads it as an option in ${text}`, () => {
      // Nothing reserves these words as option names: the spec's
      // Reserved names covers message, verb and member names only.
      const { declarations, refusals } = read(text);
      expect(refusals).toEqual([]);
      expect(optionsOf(declarations[0] as EnumDeclaration)).toEqual(options);
    });
  }

  const asForgottenBrace: string[] = [
    'enum Ward {\n  oak\nenum Two { a, b }\n',
    'enum Ward {\n  oak\nmessage :stir\n',
    'enum Ward {\n  oak,\nenum Two { a }\n',
  ];
  for (const text of asForgottenBrace) {
    it(`reads it as a forgotten brace in ${JSON.stringify(text)}`, () => {
      const { declarations, refusals } = read(text);
      expect(refusals.map((d) => d.message)).toEqual(['`Ward` is never closed.']);
      expect(declarations).toHaveLength(2);
      expect(optionsOf(declarations[0] as EnumDeclaration)).toEqual(['oak']);
    });
  }

  it('is decided by what follows the word, not by the word', () => {
    // A comma or a brace after it means an option; its own name after
    // it means a declaration.
    expect(read('enum Ward { message, a }').refusals).toEqual([]);
    expect(read('enum Ward { message :stir }').refusals).not.toEqual([]);
  });
});

describe('a stepped-over character beside a separator that is, or is not, there', () => {
  const stillReported: [string, string][] = [
    ['enum Ward { oak silver }', '`Ward` needs a comma between its options.'],
  ];
  for (const [text, message] of stillReported) {
    it(`still reports the missing comma in ${text}`, () => {
      expect(read(text).refusals.map((d) => d.message)).toEqual([message]);
    });
  }

  const onlyTheLexer: string[] = [
    'enum Ward {\n  oak % silver\n}', // no comma written: the gap explains it
    'enum Ward { oak % , silver }', // a comma IS written, right after the character
    'enum Ward { oak, % silver }',
  ];
  for (const text of onlyTheLexer) {
    it(`says only what the lexer said for ${JSON.stringify(text)}`, () => {
      const { declarations, refusals } = read(text);
      expect(refusals.map((d) => d.message)).toEqual(['Sprout does not use the character "%".']);
      // The comma the author did write is never blamed, and nothing
      // after it is lost.
      expect(optionsOf(declarations[0] as EnumDeclaration)).toEqual(['oak', 'silver']);
    });
  }

  it('keeps every element of a list whose separator sits beside the character', () => {
    const diagnostics = new Diagnostics();
    const declared = parseProperty(
      new SourceFile('k.sprout', ':a [Ward] default [oak % , silver]'),
      diagnostics,
    );
    expect(diagnostics.refusals.map((d) => d.message)).toEqual([
      'Sprout does not use the character "%".',
    ]);
    const value = declared!.default!;
    expect(value.kind === 'list-literal' && value.elements).toHaveLength(2);
  });

  it('keeps every entry of a :remembers whose separator sits beside the character', () => {
    const diagnostics = new Diagnostics();
    const declared = parseRemembers(
      new SourceFile('k.sprout', ':remembers [a: 0 % , b: 1]'),
      diagnostics,
    );
    expect(diagnostics.refusals.map((d) => d.message)).toEqual([
      'Sprout does not use the character "%".',
    ]);
    expect(declared!.properties.map((p) => p.name.text)).toEqual(['a', 'b']);
  });
});

// #59: a structural pass over this file's recovery, after five bugs in
// three rounds on PR #58. Each case below is one finding from it, and
// each is an input where the parser used to say something that was not
// the author's mistake, eat a declaration, or throw.

describe('#59 — one mistake is said once, and said truly', () => {
  const only = (text: string): string[] => read(text).refusals.map((d) => d.message);

  it('does not stop recovery on a word that merely spells a keyword', () => {
    // `recover()` matched the word by spelling where every other stop
    // rule asked `atDeclarationKeyword()`, so it halted on an option.
    expect(only('enum { message, silver }')).toEqual(['An enum needs a name.']);
    expect(only('enum { enum, silver }')).toEqual(['An enum needs a name.']);
  });

  it('says a truncated enum is unclosed, and not that it has no options', () => {
    expect(only('enum Ward {')).toEqual(['`Ward` is never closed.']);
    expect(only('enum Ward {\n')).toEqual(['`Ward` is never closed.']);
  });

  it('does not charge a token that cannot be an option as a missing comma too', () => {
    expect(only('enum Ward { oak 4 }')).toEqual(['`Ward` cannot hold the number 4.']);
    expect(only('enum Ward { oak Silver }')).toEqual([
      '`Ward` cannot hold `Silver`, which starts with a capital.',
    ]);
  });

  it('says an enum is unclosed even when a bad option sent it into recovery', () => {
    expect(only('enum Ward { oak, 4')).toEqual([
      '`Ward` cannot hold the number 4.',
      '`Ward` is never closed.',
    ]);
  });

  it('does not read a built-in type word followed by a dot as a library', () => {
    const { declarations, refusals } = read('message :n2 with boolean\n. message :n3 with boolean');
    expect(refusals.map((d) => d.message)).toEqual([
      'Sprout does not know what to do with "." here.',
    ]);
    expect(declarations.map((d) => (d as { name: { text: string } }).name.text)).toEqual([
      'n2',
      'n3',
    ]);
  });

  it('does not promote what is nested inside an unmatched brace to the top of the file', () => {
    const { declarations, refusals } = read('enum Ward { 4 { message :x } }');
    expect(refusals).toHaveLength(1);
    expect(declarations).toEqual([]);
  });

  it('says a list type names one element type, rather than blaming the bracket', () => {
    const diagnostics = new Diagnostics();
    parseProperty(new SourceFile('k.sprout', ':x [Ward, oak]'), diagnostics);
    expect(diagnostics.refusals.map((d) => d.message)).toEqual([
      'A list type names one element type.',
    ]);
  });

  it('says Sprout has no fractions, rather than blaming the comma after one', () => {
    const diagnostics = new Diagnostics();
    const declared = parseRemembers(
      new SourceFile('k.sprout', ':remembers [a: 1.5, b: 2]'),
      diagnostics,
    );
    expect(diagnostics.refusals.map((d) => d.message)).toEqual(['Sprout has no fractions.']);
    // And the entry after the broken one is still read.
    expect(declared!.properties.map((p) => p.name.text)).toEqual(['b']);
  });

  it('reads a list past an element it could not read, as the enum does', () => {
    const diagnostics = new Diagnostics();
    parseProperty(new SourceFile('k.sprout', ':x [Ward] default [oak silver brass]'), diagnostics);
    expect(diagnostics.refusals.map((d) => d.message)).toEqual([
      'A list needs a comma between its elements.',
      'A list needs a comma between its elements.',
    ]);
  });

  it('reads a property’s bounds in either order without its span going short', () => {
    // The span ended at `max ?? min ?? value`, so `max 1 min 2` stopped
    // before the min — and the stale end then suppressed a real missing
    // comma one level up. The two readings have to agree.
    const read1 = new Diagnostics();
    const read2 = new Diagnostics();
    parseRemembers(new SourceFile('k.sprout', ':remembers [a: 0 max 1 min % 2 b: 3]'), read1);
    parseRemembers(new SourceFile('k.sprout', ':remembers [a: 0 min 1 max % 2 b: 3]'), read2);
    expect(read1.refusals.map((d) => d.message)).toEqual(read2.refusals.map((d) => d.message));
    expect(read1.refusals.map((d) => d.message)).toEqual([
      'Sprout does not use the character "%".',
      'A `:remembers` needs a comma between what it remembers.',
    ]);
  });

  it('spans a property to its last bound, whichever order they came in', () => {
    const diagnostics = new Diagnostics();
    const declared = parseProperty(new SourceFile('k.sprout', ':x 0 max 1 min 2'), diagnostics);
    expect(textOf(declared!.at)).toBe(':x 0 max 1 min 2');
  });
});

describe('#59 — the parser refuses rather than throwing, at the host’s cap', () => {
  const deep = (n: number) => `message :m with ${'['.repeat(n)}Ward`;

  it('refuses nesting past the cap instead of running out of stack', () => {
    const { refusals } = read(deep(7000));
    expect(refusals[0]!.message).toBe('Nothing here may be nested more than 8 deep.');
  });

  it('takes the cap from the host, since every limit is the host’s', () => {
    const diagnostics = new Diagnostics();
    parseDeclarations(new SourceFile('t.sprout', deep(4)), diagnostics, {
      ...DEFAULT_LIMITS.caps,
      nesting: 2,
    });
    expect(diagnostics.refusals[0]!.message).toBe('Nothing here may be nested more than 2 deep.');
  });

  it('allows nesting up to the cap', () => {
    expect(read(`message :m with ${'['.repeat(8)}Ward${']'.repeat(8)}`).refusals).toEqual([]);
  });

  it('never throws, however deep it is given', () => {
    for (const n of [100, 1_000, 20_000]) {
      expect(() => read(deep(n)), String(n)).not.toThrow();
      expect(() => read(`:x ${'['.repeat(n)}`), String(n)).not.toThrow();
    }
  });
});

describe('#59 — every place that asks where a declaration starts reads one table', () => {
  it('reads every word it says it reads', () => {
    const minimal: Record<string, string> = {
      enum: 'enum Ward { oak }',
      message: 'message :stir',
    };
    for (const word of DECLARATIONS) {
      expect(Object.keys(minimal), `${word} has no sample here`).toContain(word);
      const { declarations, refusals } = read(minimal[word]!);
      expect(refusals, word).toEqual([]);
      expect(declarations, word).toHaveLength(1);
    }
  });

  it('stops recovery at every word it reads, and at no other', () => {
    for (const word of DECLARATIONS) {
      const { declarations } = read(`nonsense\n${word === 'enum' ? 'enum A { a }' : 'message :a'}`);
      expect(declarations, word).toHaveLength(1);
    }
  });
});

describe('#60 — what the review of the #59 pass found', () => {
  it('names where recovery actually stopped, not the end of the file', () => {
    // `recoverInBraces` gives up for two reasons and the caller knew
    // only one of them, so it pointed past the file's own closing brace.
    const { refusals } = read('enum Ward { 4\nmessage :x\n}\n');
    const unclosed = refusals.find((d) => d.message === '`Ward` is never closed.')!;
    expect(locationOf(unclosed.at)).toBe('ward.sprout:2:1');
  });

  it('still names the end of the file when that is where it ran out', () => {
    const { refusals } = read('enum Ward { oak, 4');
    const unclosed = refusals.find((d) => d.message === '`Ward` is never closed.')!;
    expect(locationOf(unclosed.at)).toBe('ward.sprout:1:19');
  });

  it('keeps a well-formed element that follows one it could not read', () => {
    for (const text of [':x [oak, Zeta silver]', ':x [oak, Zeta, silver]']) {
      const diagnostics = new Diagnostics();
      const declared = parseProperty(new SourceFile('k.sprout', text), diagnostics);
      expect(diagnostics.refusals, text).toHaveLength(1);
      const value = declared!.default!;
      expect(value.kind === 'list-literal' && value.elements.length, text).toBe(2);
    }
  });

  it('keeps a well-formed :remembers entry that follows one it could not read', () => {
    const diagnostics = new Diagnostics();
    const declared = parseRemembers(
      new SourceFile('k.sprout', ':remembers [a: 0, b c: 1]'),
      diagnostics,
    );
    expect(diagnostics.refusals).toHaveLength(1);
    expect(declared!.properties.map((p) => p.name.text)).toEqual(['a', 'c']);
  });

  it('never loops on an item it cannot read and cannot step over', () => {
    for (const text of [':x [Zeta]', ':x [Zeta Zeta Zeta]', ':remembers [Zeta]', ':x [,,,]']) {
      expect(() => {
        const diagnostics = new Diagnostics();
        parseProperty(new SourceFile('k.sprout', text), diagnostics);
        parseRemembers(new SourceFile('k.sprout', text), new Diagnostics());
      }, text).not.toThrow();
    }
  });

  it('names in its message exactly the declarations it reads, both ways round', () => {
    // The message is built from the dispatch table, so a declaration
    // added to one and not the other cannot ship. This catches the
    // direction the earlier spec did not: a reader with no entry here.
    const { refusals } = read('nonsense');
    const named = [...refusals[0]!.remedy!.matchAll(/`([a-z]+)`/g)].map((m) => m[1]!);
    expect(named.sort()).toEqual([...DECLARATIONS].sort());
  });
});

describe('#60 — a file that runs out is explained once, not once per bracket', () => {
  const diagnose = (
    text: string,
    fn: (source: SourceFile, diagnostics: Diagnostics) => unknown = parseProperty,
  ): string[] => {
    const diagnostics = new Diagnostics();
    fn(new SourceFile('k.sprout', text), diagnostics);
    return diagnostics.all.map((d) => d.message);
  };

  it('says a nested unclosed list is unclosed once, however deep it is', () => {
    for (const text of [':x [oak,[Zeta', ':x [oak, [oak2, [Zeta', ':x [a, [b, [c, [Zeta']) {
      const said = diagnose(text);
      expect(
        said.filter((m) => m === 'This list is never closed.'),
        text,
      ).toHaveLength(1);
    }
  });

  it('does not add the outer construct’s own complaint on top of the inner one', () => {
    expect(diagnose(':remembers [a: [oak,[Zeta', parseRemembers)).toEqual([
      '`Zeta`, which starts with a capital is not a value.',
      'This list is never closed.',
    ]);
  });

  it('still says so once where the list itself is the one that ran out', () => {
    expect(diagnose(':x [oak')).toEqual(['This list is never closed.']);
    expect(diagnose(':x [oak, Zeta')).toEqual([
      '`Zeta`, which starts with a capital is not a value.',
      'This list is never closed.',
    ]);
    expect(diagnose(':remembers [a: 0', parseRemembers)).toEqual([
      'This `:remembers` is never closed.',
    ]);
  });
});

describe('#60 — invariants over generated input, brackets included', () => {
  // Two fuzzing setups in a row came back clean on this file because
  // their token pools held no brackets, so they never generated a
  // nested list — the shape every one of the four rounds of bugs here
  // has turned on. This keeps a small, deterministic generator in the
  // suite, with the brackets in it, checking the invariants the bugs
  // actually broke rather than any particular input.
  const POOL = [
    'enum',
    'message',
    'Ward',
    'oak',
    'boolean',
    'default',
    'min',
    'true',
    '4',
    '1.5',
    '"x"',
    ':a',
    '[',
    ']',
    '{',
    '}',
    ',',
    ':',
    '.',
    '%',
    '-',
  ];

  /** A fixed sequence, so a failure is reproducible and the suite is deterministic. */
  function* generated(count: number, seed = 20_260_921): Generator<string> {
    let state = seed;
    const next = (): number => (state = (state * 1_103_515_245 + 12_345) % 2_147_483_648);
    for (let i = 0; i < count; i++) {
      const length = 1 + (next() % 12);
      const words: string[] = [];
      for (let w = 0; w < length; w++) words.push(POOL[next() % POOL.length]!);
      yield words.join(' ');
    }
  }

  const readers: [string, (s: SourceFile, d: Diagnostics) => unknown][] = [
    ['parseDeclarations', parseDeclarations],
    ['parseProperty', parseProperty],
    ['parseRemembers', parseRemembers],
  ];

  for (const [name, read] of readers) {
    it(`${name} never throws, and never says one thing twice in one place`, () => {
      for (const text of generated(600)) {
        const diagnostics = new Diagnostics();
        const source = new SourceFile('fuzz.sprout', text);
        expect(() => read(source, diagnostics), text).not.toThrow();
        const seen = new Set<string>();
        for (const problem of diagnostics.all) {
          const key = `${problem.message}@${problem.at.start}-${problem.at.end}`;
          expect(seen.has(key), `${text}\n  repeated: ${problem.message}`).toBe(false);
          seen.add(key);
        }
      }
    });
  }

  it('gives the same answer for the same source, every time', () => {
    for (const text of generated(200, 7)) {
      const source = new SourceFile('fuzz.sprout', text);
      const once = new Diagnostics();
      const twice = new Diagnostics();
      parseDeclarations(source, once);
      parseDeclarations(new SourceFile('fuzz.sprout', text), twice);
      expect(
        twice.all.map((d) => d.message),
        text,
      ).toEqual(once.all.map((d) => d.message));
    }
  });
});

describe('#60 — the shape every round of bugs here has turned on, enumerated', () => {
  // The random generator above reaches nesting depth two in about one
  // input in forty, which is thin cover for the one shape that has
  // produced a bug in all four rounds on this file: brackets inside
  // brackets, something unreadable at the bottom, closed or not. So
  // that shape is enumerated rather than sampled.
  //
  // Every level opens with a lower-case element, which is not
  // decoration. `atType()` skips past every leading `[` before deciding
  // whether what is underneath looks like a type, so `:x [[[Zeta` is
  // read as an attempted list TYPE and never reaches the recovery this
  // suite is about. A lower-case element at the head of each level is
  // what makes the brackets values — and it is what the historical bugs
  // looked like: `:x [oak,[Zeta`, `:x [oak, [oak2, [Zeta`.
  //
  // `enum` is not among the unreadable tokens on purpose: nothing
  // reserves an option's name, so `[enum]` is a legal list holding one
  // option and says nothing.
  const BAD = ['Zeta', '{', '}', ':a', '1.5', '%'];

  /** The vocabulary of the type path, which these shapes must never reach. */
  const TYPE_PATH = 'list type';

  function* shapes(): Generator<{ text: string; what: string }> {
    for (let depth = 1; depth <= 6; depth++) {
      const open = Array.from({ length: depth }, (_, i) => `[oak${i}, `).join('');
      const close = ']'.repeat(depth);
      for (const bad of BAD) {
        for (const [tail, what] of [
          ['', 'unclosed'],
          [close, 'closed'],
          [`, last${close}`, 'closed with a good neighbour'],
        ] as const) {
          yield { text: `:x ${open}${bad}${tail}`, what: `depth ${depth}, ${bad}, ${what}` };
          yield {
            text: `:remembers [a: ${open}${bad}${tail}]`,
            what: `remembers depth ${depth}, ${bad}, ${what}`,
          };
        }
      }
    }
  }

  const readings = (text: string): { property: string[]; remembers: string[] } => {
    const property = new Diagnostics();
    const remembers = new Diagnostics();
    parseProperty(new SourceFile('k.sprout', text), property);
    parseRemembers(new SourceFile('k.sprout', text), remembers);
    return {
      property: property.all.map((d) => d.message),
      remembers: remembers.all.map((d) => d.message),
    };
  };

  it('actually reaches the recovery it is about, for every shape in it', () => {
    // The check that keeps this suite from passing while covering
    // nothing — which is what it did on its first draft, and what two
    // fuzzing setups did before it.
    let reached = 0;
    for (const { text, what } of shapes()) {
      const said = readings(text);
      const both = [...said.property, ...said.remembers];
      expect(
        both.some((m) => m.includes(TYPE_PATH)),
        `${what}: ${text} went to the type path`,
      ).toBe(false);
      expect(both.length, `${what}: ${text} said nothing`).toBeGreaterThan(0);
      reached += 1;
    }
    expect(reached).toBe(6 * BAD.length * 3 * 2);
  });

  it('says nothing twice in one place, at any depth', () => {
    for (const { text, what } of shapes()) {
      for (const read of [parseProperty, parseRemembers]) {
        const diagnostics = new Diagnostics();
        read(new SourceFile('k.sprout', text), diagnostics);
        const seen = new Set<string>();
        for (const problem of diagnostics.all) {
          const key = `${problem.message}@${problem.at.start}-${problem.at.end}`;
          expect(seen.has(key), `${what}: ${text}\n  repeated: ${problem.message}`).toBe(false);
          seen.add(key);
        }
      }
    }
  });

  it('says "never closed" at most once, however deep the brackets go', () => {
    for (const { text, what } of shapes()) {
      const said = readings(text).property;
      const unclosed = said.filter((m) => m.includes('never closed'));
      expect(unclosed.length, `${what}: ${text}`).toBeLessThanOrEqual(1);
    }
  });

  it('keeps the well-formed neighbour that follows the unreadable one', () => {
    for (let depth = 1; depth <= 4; depth++) {
      const open = Array.from({ length: depth }, (_, i) => `[oak${i}, `).join('');
      for (const bad of BAD) {
        const text = `:x ${open}${bad}, last${']'.repeat(depth)}`;
        const diagnostics = new Diagnostics();
        const declared = parseProperty(new SourceFile('k.sprout', text), diagnostics);
        expect(declared, `${text} gave back nothing`).not.toBeNull();
      }
    }
  });
});

// --- expressions (B09) ----------------------------------------------------

/** An expression as a shape, brackets showing what bound to what. */
function shape(expr: Expr | null): string {
  if (expr === null) return 'null';
  switch (expr.kind) {
    case 'binary':
      return `(${shape(expr.left)} ${expr.operator} ${shape(expr.right)})`;
    case 'unary':
      return `(${expr.operator}${shape(expr.operand)})`;
    case 'member':
      return `${shape(expr.receiver)}.${expr.member.text}`;
    case 'call':
      return `${shape(expr.receiver)}.${expr.method.text}(${expr.arguments.map(shape).join(', ')})`;
    case 'free-call':
      return `${expr.name.text}(${expr.arguments.map(shape).join(', ')})`;
    case 'binding':
      return expr.name.text;
    case 'symbol-expr':
      return `:${expr.name.text}`;
    case 'kind-expr':
      return expr.library === null ? expr.name.text : `${expr.library.text}.${expr.name.text}`;
    case 'string':
      return JSON.stringify(expr.value);
    default:
      return String(expr.value);
  }
}

/** A property, for the specs about depth that are written as one. */
function readExpressionOf(text: string) {
  const diagnostics = new Diagnostics();
  parseProperty(new SourceFile('k.sprout', text), diagnostics);
  return { refusals: diagnostics.refusals };
}

/** One property declaration, with whatever caps the host set. */
function readProperty(text: string, caps = DEFAULT_LIMITS.caps) {
  const diagnostics = new Diagnostics();
  const declared = parseProperty(new SourceFile('k.sprout', text), diagnostics, caps);
  return { declared, diagnostics, refusals: diagnostics.refusals };
}

function readExpression(text: string, caps = DEFAULT_LIMITS.caps) {
  const diagnostics = new Diagnostics();
  const expr = parseExpression(new SourceFile('body.sprout', text), diagnostics, caps);
  return { expr, shape: shape(expr), diagnostics, refusals: diagnostics.refusals };
}

describe('a list is bounded by what the host allows', () => {
  const allowed = DEFAULT_LIMITS.caps.listElements;
  const list = (many: number) =>
    `:x [Ward] default [${Array.from({ length: many }, (_, i) => `e${i}`).join(', ')}]`;

  it('reads a list up to the cap, and refuses one past it', () => {
    expect(readProperty(list(allowed)).declared).not.toBeNull();
    expect(readProperty(list(allowed + 1)).declared).toBeNull();
  });

  it('refuses rather than keeping the first few, because a silent drop is the one thing it must not be', () => {
    const { declared, refusals } = readProperty(list(allowed + 4));
    expect(declared).toBeNull();
    expect(refusals.map((d) => d.message)).toContain(`A list holds at most ${allowed} things.`);
  });

  it('points at the element that breaks it, not at the list', () => {
    // The span, not only the words: a report that moved to the opening
    // bracket used to pass every test here.
    const { refusals } = readProperty(list(allowed + 1));
    const cap = refusals.find((d) => d.message.startsWith('A list holds at most'))!;
    expect(textOf(cap.at)).toBe(`e${allowed}`);
  });

  it('is counted per list, so two over-cap lists are two reports', () => {
    // `overCap` is a local, where the nesting cap two lines above it is
    // a field reset once per declaration. Copying that shape here would
    // report the first list and drop the second in silence, which is
    // the one thing a full list must never do.
    const caps = { ...DEFAULT_LIMITS.caps, listElements: 3 };
    const diagnostics = new Diagnostics();
    parseRemembers(
      new SourceFile('k.sprout', ':remembers [a: [1, 2, 3, 4], b: [5, 6, 7, 8]]'),
      diagnostics,
      caps,
    );
    expect(
      diagnostics.refusals.filter((d) => d.message.startsWith('A list holds at most')),
    ).toHaveLength(2);
  });

  it('says it once, and still says what else is wrong inside', () => {
    const over = `:x [Ward] default [${Array.from({ length: allowed + 4 }, (_, i) => `e${i}`).join(', ')}, Zeta]`;
    const said = readProperty(over).refusals.map((d) => d.message);
    expect(said.filter((m) => m.startsWith('A list holds at most'))).toHaveLength(1);
    expect(said.join(' ')).toContain('`Zeta`, which starts with a capital is not a value.');
  });

  it('takes the bound from the host rather than a number of its own', () => {
    const caps = { ...DEFAULT_LIMITS.caps, listElements: 2 };
    expect(readProperty(list(2), caps).declared).not.toBeNull();
    const { declared, refusals } = readProperty(list(3), caps);
    expect(declared).toBeNull();
    expect(refusals.map((d) => d.message)).toContain('A list holds at most 2 things.');
  });
});

describe('a `min` and a `max` are whole numbers', () => {
  it('says so for anything written there that is not one', () => {
    for (const [text, said] of [
      [':x integer default 0 min [1, 2]', 'A min is a whole number.'],
      [':x integer default 0 max [1, 2]', 'A max is a whole number.'],
      [':x integer default 0 min oak', 'A min is a whole number.'],
      [':x integer default 0 max "9"', 'A max is a whole number.'],
      [':x integer default 0 min true', 'A min is a whole number.'],
    ] as const) {
      const { declared, refusals } = readProperty(text);
      expect(declared, text).toBeNull();
      expect(
        refusals.map((d) => d.message),
        text,
      ).toContain(said);
    }
  });

  it('still reads the bounds it should, including a negative one', () => {
    expect(readProperty(':x integer default 0 min -3 max 9').declared).toMatchObject({
      min: { value: -3 },
      max: { value: 9 },
    });
  });

  it('leaves what is wrong INSIDE a bound to whatever knows about it', () => {
    // A bound is read by reading a value and complaining about its
    // shape. That means a bound whose own contents are wrong reports
    // the contents rather than the bound — `min 1.5` says there are no
    // fractions, and a list too long for the cap says so. The first is
    // better than "a min is a whole number"; the second is worse, and
    // #67 carries it.
    //
    // Three attempts at deciding this by looking before reading each
    // broke an input beside the one they fixed, because a reader that
    // has not consumed anything cannot tell a stray closing bracket
    // from the one its own caller is waiting for. This is the shape
    // that loses nothing.
    expect(readProperty(':x integer default 0 min 1.5').refusals.map((d) => d.message)).toEqual([
      'Sprout has no fractions.',
    ]);
    expect(readProperty(':x integer default 0 min -').refusals.map((d) => d.message)).toEqual([
      'A minus sign needs a number after it.',
    ]);
  });

  it('never loses the entry written after a bad bound in silence', () => {
    // The whole reason the machinery that used to sit here is gone.
    // Every shape either keeps `walks` or names it; none drops it
    // without saying so.
    for (const bad of ['[1, 2]', '[[1]]', 'oak', '"9"', 'true', 'Ward', ':wet', 'max 9', '1.5']) {
      const diagnostics = new Diagnostics();
      const remembered = parseRemembers(
        new SourceFile('k.sprout', `:remembers [visits: 0 min ${bad}, walks: 1]`),
        diagnostics,
      );
      const kept = remembered?.properties.map((p) => p.name.text) ?? [];
      const said = diagnostics.refusals.map((d) => d.message).join(' ');
      expect(kept.includes('walks') || said.includes('walks'), `${bad}: walks vanished`).toBe(true);
      expect(diagnostics.refusals.length, bad).toBeGreaterThan(0);
    }
  });

  it('keeps what was read before a bad bound, whatever the bound was', () => {
    for (const bad of [']', 'oak', '[1, 2]', '}']) {
      const diagnostics = new Diagnostics();
      const remembered = parseRemembers(
        new SourceFile('k.sprout', `:remembers [handled: false, visits: 0 min ${bad}]`),
        diagnostics,
      );
      expect(
        remembered?.properties.map((p) => p.name.text),
        bad,
      ).toEqual(['handled']);
    }
  });
});

describe('#66 — a defect in one item never loses a well-formed neighbour in silence', () => {
  // Eight times across #58, #59/#60, #62 and #65, a change to this
  // parser lost an item the author wrote correctly, and said nothing
  // about it. Every one was found by a reviewer running the parser;
  // none by this suite, because none of its invariants was ABOUT that.
  // The generator asserts no-throw, no-repeat and determinism, and a
  // parser that drops an entry and says one true thing passes all
  // three.
  //
  // This is the missing one. It needs no knowledge of what the defect
  // was: the shapes are built here, so what was well formed is known.
  //
  // Every defect is SELF-CONTAINED — balanced brackets, and not a bare
  // closer. An unclosed bracket really does swallow what follows it,
  // and a bare `]` really does end the construct; in both cases what
  // comes after is not a sibling, and blaming the parser for it would
  // be the suite lying rather than the parser.
  const ENTRY_DEFECTS = [
    'Zeta: 0',
    '4: 0',
    'b 1',
    'b: Zeta',
    'b: 1.5',
    'b: %',
    'b: :wet',
    'b:',
    ': 0',
    'b: {}',
    'b: [oak silver]',
    'b: 0 min [1, 2]',
    'b: 0 min oak',
    'b: 0 min max 9',
    'b: 0 min 0 min 1',
    'b: 0 max 1.5',
    'b: 0 min',
    'b: [[[[[[[[[[oak]]]]]]]]]]',
    `b: [Ward] default [${Array.from({ length: 17 }, (_, i) => `e${i}`).join(',')}]`,
    // NOT here, and named rather than quietly left out: `b: 0 min -[1]`
    // loses the entry after it. That is #67, it is the behaviour on
    // main, and three attempts to fix it in #65 each broke something
    // else. It goes in when #67 does.
  ];

  // Not `enum`: nothing reserves an option's name, so `[oak, enum]`
  // is a list of two options and there is nothing wrong with it. The
  // check that every shape here really is a defect caught that, which
  // is the second time this suite has had to be told the same thing.
  const ELEMENT_DEFECTS = ['Zeta', '1.5', '%', ':a', '{', '}', '[[[[[[[[[[oak]]]]]]]]]]'];
  const DECLARATION_DEFECTS = [
    'enum',
    'enum {',
    'message',
    'enum Ward {',
    'message :a with [[[[[[[[[[Ward]]]]]]]]]]',
    '%',
    'enum Ward { oak oak }',
  ];

  /** Every well-formed thing is kept, or named in something said. */
  function nothingVanishes(what: string, kept: readonly string[], said: string, good: string[]) {
    for (const name of good) {
      expect(kept.includes(name) || said.includes(name), `${what}: \`${name}\` vanished`).toBe(
        true,
      );
    }
  }

  it('over a `:remembers`, whichever side of the defect the good entries are', () => {
    let checked = 0;
    for (const defect of ENTRY_DEFECTS) {
      for (const [text, good] of [
        [`:remembers [alpha: 0, ${defect}]`, ['alpha']],
        [`:remembers [${defect}, omega: 1]`, ['omega']],
        [`:remembers [alpha: 0, ${defect}, omega: 1]`, ['alpha', 'omega']],
      ] as const) {
        checked += 1;
        const diagnostics = new Diagnostics();
        const remembered = parseRemembers(new SourceFile('k.sprout', text), diagnostics);
        const said = diagnostics.all.map((d) => d.message).join(' ');
        nothingVanishes(text, remembered?.properties.map((p) => p.name.text) ?? [], said, [
          ...good,
        ]);
        // And it is a defect at all — the net is worth nothing if the
        // shapes it walks are well formed.
        expect(diagnostics.refusals.length, `${text}: nothing was wrong with it`).toBeGreaterThan(
          0,
        );
      }
    }
    expect(checked).toBe(ENTRY_DEFECTS.length * 3);
  });

  it('over a list literal', () => {
    for (const defect of ELEMENT_DEFECTS) {
      for (const [text, good] of [
        [`:x [Ward] default [oak, ${defect}]`, ['oak']],
        [`:x [Ward] default [${defect}, silver]`, ['silver']],
        [`:x [Ward] default [oak, ${defect}, silver]`, ['oak', 'silver']],
      ] as const) {
        const diagnostics = new Diagnostics();
        const declared = parseProperty(new SourceFile('k.sprout', text), diagnostics);
        const written =
          declared?.default?.kind === 'list-literal'
            ? declared.default.elements.map((e) =>
                e.kind === 'option-literal' ? e.name.text : String(e.kind),
              )
            : [];
        const said = diagnostics.all.map((d) => d.message).join(' ');
        nothingVanishes(text, written, said, [...good]);
        expect(diagnostics.refusals.length, `${text}: nothing was wrong with it`).toBeGreaterThan(
          0,
        );
      }
    }
  });

  it('over the declarations of a whole file', () => {
    for (const defect of DECLARATION_DEFECTS) {
      for (const [text, good] of [
        [`enum Alpha { x }\n${defect}\n`, ['Alpha']],
        [`${defect}\nenum Omega { y }\n`, ['Omega']],
        [`enum Alpha { x }\n${defect}\nenum Omega { y }\n`, ['Alpha', 'Omega']],
      ] as const) {
        const diagnostics = new Diagnostics();
        const declared = parseDeclarations(new SourceFile('k.sprout', text), diagnostics);
        const said = diagnostics.all.map((d) => d.message).join(' ');
        nothingVanishes(
          text,
          declared.map((d) => d.name.text),
          said,
          [...good],
        );
        expect(diagnostics.refusals.length, `${text}: nothing was wrong with it`).toBeGreaterThan(
          0,
        );
      }
    }
  });
});

describe('an expression', () => {
  it('reads every expression the spec writes', () => {
    // Taken from the spec's own bodies, so the suite fails if the
    // grammar drifts from what the language is written in.
    const written: [string, string][] = [
      ['self.get(:sealed)', 'self.get(:sealed)'],
      ['self.get(:wear) >= 99', '(self.get(:wear) >= 99)'],
      ['!self.get(:inked)', '(!self.get(:inked))'],
      ['tools.count(Rib) > 1', '(tools.count(Rib) > 1)'],
      ['self.get(:state) == :wet', '(self.get(:state) == :wet)'],
      ['elapsed > 7200', '(elapsed > 7200)'],
      ['p != self && chance(4)', '((p != self) && chance(4))'],
      ['self.count >= self.get(:capacity)', '(self.count >= self.get(:capacity))'],
      ['actor.recall(:visits) <= 1', '(actor.recall(:visits) <= 1)'],
      ['item.is(Creature)', 'item.is(Creature)'],
      ['from.get(:opens).includes(self.get(:ward))', 'from.get(:opens).includes(self.get(:ward))'],
      ['self.holds(target)', 'self.holds(target)'],
      ['self.adjust(:wear, 1)', 'self.adjust(:wear, 1)'],
      ['random(6)', 'random(6)'],
      ['to.is(sprout.Container)', 'to.is(sprout.Container)'],
    ];
    for (const [text, expected] of written) {
      const read = readExpression(text);
      expect(
        read.refusals.map((d) => d.message),
        text,
      ).toEqual([]);
      expect(read.shape, text).toBe(expected);
    }
  });

  it('binds operators as the spec’s own expressions assume', () => {
    const table: [string, string][] = [
      ['a || b && c', '(a || (b && c))'],
      ['a && b == c', '(a && (b == c))'],
      ['a == b < c', '(a == (b < c))'],
      ['a < b + c', '(a < (b + c))'],
      ['-a + b', '((-a) + b)'],
      ['!a && b', '((!a) && b)'],
      ['a - b - c', '((a - b) - c)'],
      ['(a || b) && c', '((a || b) && c)'],
      ['a.b.c', 'a.b.c'],
    ];
    for (const [text, expected] of table) expect(readExpression(text).shape, text).toBe(expected);
  });

  it('tells a library’s kind from a reading, by what follows the dot', () => {
    // `sprout.Container` is a kind and `actor.recall` is a reading, and
    // the only difference is the capital letter after the dot.
    expect(readExpression('sprout.Container').shape).toBe('sprout.Container');
    expect(readExpression('sprout.recall').shape).toBe('sprout.recall');
  });

  it('says what it could not read, and where', () => {
    const table: [string, string][] = [
      ['', 'the end of the file is not something to read'],
      ['&&', '`&&` is not something to read'],
      ['a +', 'the end of the file is not something to read'],
      ['(a + b', 'This bracket is never closed.'],
      ['self.get(:p', 'This bracket is never closed.'],
      ['self.', 'A dot needs the name of something to read after it.'],
      ['1.5', 'Sprout has no fractions.'],
    ];
    for (const [text, said] of table) {
      const read = readExpression(text);
      expect(read.expr, text).toBeNull();
      expect(read.refusals.map((d) => d.message).join(' '), text).toContain(said);
      for (const refusal of read.refusals) {
        expect(refusal.remedy ?? '', `${text}: no remedy`).not.toBe('');
      }
    }
  });

  it('keeps the well-formed neighbour of an argument it could not read', () => {
    const read = readExpression('self.set(:wear % , 1)');
    expect(read.shape).toBe('self.set(:wear, 1)');
  });

  it('asks for a comma only once the next thing reads', () => {
    const read = readExpression('self.set(:wear 1)');
    expect(read.refusals.map((d) => d.message)).toEqual([
      'A reading needs a comma between what it is given.',
    ]);
    expect(read.shape).toBe('self.set(:wear, 1)');
  });
});

describe('an expression counts against the host’s nesting cap', () => {
  const nesting = DEFAULT_LIMITS.caps.nesting;

  it('reads what is within it, and refuses what is past it', () => {
    expect(readExpression('('.repeat(nesting) + 'a' + ')'.repeat(nesting)).expr).not.toBeNull();
    expect(readExpression('('.repeat(nesting + 1) + 'a' + ')'.repeat(nesting + 1)).expr).toBeNull();
    expect(readExpression('!'.repeat(nesting) + 'a').expr).not.toBeNull();
    expect(readExpression('!'.repeat(nesting + 1) + 'a').expr).toBeNull();
  });

  it('says so ONCE, however far past it goes', () => {
    // The refusal used to multiply: reading on past an item that could
    // not be read is what an author owed three problems is owed all
    // three for, but every item past the cap sits at the same depth and
    // fails identically, so reading on said one true thing once per
    // level. `:x [[[[…` said it 1,992 times.
    for (const text of [
      '('.repeat(2000) + 'a' + ')'.repeat(2000),
      'a' + '.f(a'.repeat(2000) + ')'.repeat(2000),
      '!'.repeat(2000) + 'a',
    ]) {
      const said = readExpression(text).refusals.map((d) => d.message);
      expect(said, text.slice(0, 20)).toEqual([
        `Nothing here may be nested more than ${nesting} deep.`,
      ]);
    }
  });

  it('says so once for a list too, which is where the multiplying was', () => {
    const diagnostics = new Diagnostics();
    parseProperty(new SourceFile('k.sprout', ':x ' + '['.repeat(2000) + 'oak'), diagnostics);
    expect(
      diagnostics.refusals.filter((d) => d.message.startsWith('Nothing here may be nested')),
    ).toHaveLength(1);
  });

  it('says so once for a `:remembers` too, which has the same loop', () => {
    const diagnostics = new Diagnostics();
    parseRemembers(
      new SourceFile('k.sprout', ':remembers [a: ' + '['.repeat(2000) + 'oak]'),
      diagnostics,
    );
    expect(
      diagnostics.refusals.filter((d) => d.message.startsWith('Nothing here may be nested')),
    ).toHaveLength(1);
  });

  it('says it once, and takes the whole construct with it rather than half', () => {
    // Two things had to be told apart here. What is INSIDE a construct
    // the cap abandoned goes with it — the same way an enum's options
    // go with an enum that could not be read — and one message is the
    // whole account of it. What comes AFTER it is a sibling the author
    // is still owed, and the first fix lost those: stopping at the
    // first too-deep item said the depth once and dropped everything
    // else that was wrong.
    const deep = '['.repeat(12);
    const inside = readExpressionOf(`:x [${deep}oak, Zeta]`).refusals.map((d) => d.message);
    expect(inside.filter((m) => m.startsWith('Nothing here may be nested'))).toHaveLength(1);

    const diagnostics = new Diagnostics();
    const after = parseRemembers(
      new SourceFile('k.sprout', `:remembers [a: ${deep}oak${']'.repeat(12)}, b c: 1]`),
      diagnostics,
    );
    const said = diagnostics.refusals.map((d) => d.message);
    expect(said.filter((m) => m.startsWith('Nothing here may be nested'))).toHaveLength(1);
    expect(said.join(' ')).toContain('needs a colon between its name and its value');
    expect(after).not.toBeNull();
  });

  it('gives each declaration its own account of being too deep', () => {
    const diagnostics = new Diagnostics();
    const deep = '[[[[[[[[[[';
    parseDeclarations(
      new SourceFile(
        'k.sprout',
        `message :a with ${deep}Ward
message :b with ${deep}Ward
`,
      ),
      diagnostics,
    );
    expect(
      diagnostics.refusals.filter((d) => d.message.startsWith('Nothing here may be nested')),
    ).toHaveLength(2);
  });

  it('counts prefix signs against the same depth brackets do', () => {
    // A counter of its own would give every bracketed level a fresh
    // allowance of signs on top of the shared one: eight parentheses
    // each holding eight `!` nested sixty-four deep under a cap of
    // eight, with nothing said.
    expect(readExpression('(' + '!'.repeat(nesting - 1) + 'a)').expr).not.toBeNull();
    expect(readExpression('(' + '!'.repeat(nesting) + 'a)').expr).toBeNull();
    const stacked = ('(' + '!'.repeat(nesting)).repeat(nesting) + 'a' + ')'.repeat(nesting);
    expect(readExpression(stacked).refusals.map((d) => d.message)).toEqual([
      `Nothing here may be nested more than ${nesting} deep.`,
    ]);
  });

  it('steps over what it would not read, rather than leaving its closer behind', () => {
    // A bracket the cap refuses is consumed and never opens a level, so
    // its CLOSER is left in the stream — where the loop reading around
    // it takes the closer for its own and ends early, dropping
    // everything after it with nothing said.
    const deep = '('.repeat(nesting) + 'a' + ')'.repeat(nesting);
    const call = readExpression(`self.f(${deep}, b)`);
    expect(call.shape).toBe('self.f(b)');
    expect(call.refusals.map((d) => d.message)).toEqual([
      `Nothing here may be nested more than ${nesting} deep.`,
    ]);

    // The same shape in a `:remembers`, which is where it was found.
    const diagnostics = new Diagnostics();
    const remembered = parseRemembers(
      new SourceFile(
        'k.sprout',
        ':remembers [a: ' + '['.repeat(nesting + 1) + 'oak' + ']'.repeat(nesting + 1) + ', b: 3]',
      ),
      diagnostics,
    );
    expect(remembered!.properties.map((p) => p.name.text)).toEqual(['a', 'b']);
  });

  it('walks past a word that only looks like a declaration inside it', () => {
    // Nothing reserves `message` or `enum`, so `[message foo]` is a
    // list of two things. A skip that stopped at one left the real
    // closers behind — which is the stray-closer bug the skip exists
    // to prevent, reintroduced by its own guard.
    const trap = '['.repeat(nesting + 1) + 'message foo' + ']'.repeat(nesting + 1);
    const diagnostics = new Diagnostics();
    const remembered = parseRemembers(
      new SourceFile('k.sprout', `:remembers [a: ${trap}, c: 3]`),
      diagnostics,
    );
    expect(remembered!.properties.map((p) => p.name.text)).toEqual(['a', 'c']);
    expect(diagnostics.refusals.map((d) => d.message)).toEqual([
      `Nothing here may be nested more than ${nesting} deep.`,
    ]);

    // And at file scope it must not invent a declaration out of the
    // trapped word: `A message needs a name.` about content the author
    // never wrote as one is worse than saying nothing.
    const atFile = new Diagnostics();
    const declared = parseDeclarations(
      new SourceFile('k.sprout', `message :first with ${trap}\nmessage :second\n`),
      atFile,
    );
    expect(declared.map((d) => d.name.text)).toEqual(['second']);
    expect(atFile.refusals.map((d) => d.message)).toEqual([
      `Nothing here may be nested more than ${nesting} deep.`,
    ]);
  });

  it('takes nothing at all where the closer was never written', () => {
    // The skip looks for its closer before consuming anything, so a
    // bracket that was never closed does not take the rest of the file
    // with it — which is how a second declaration used to vanish.
    const diagnostics = new Diagnostics();
    const declared = parseDeclarations(
      new SourceFile(
        'k.sprout',
        `message :a with ${'['.repeat(nesting + 2)}Ward\nmessage :b with ${'['.repeat(nesting + 2)}Ward\n`,
      ),
      diagnostics,
    );
    expect(declared).toHaveLength(0);
    expect(
      diagnostics.refusals.filter((d) => d.message.startsWith('Nothing here may be nested')),
    ).toHaveLength(2);
  });

  it('names what the author actually wrote too much of', () => {
    const brackets = readExpression('('.repeat(nesting + 1) + 'a' + ')'.repeat(nesting + 1));
    expect(brackets.refusals[0]!.remedy).toContain('brackets');
    // A wall of signs has no bracket in it.
    const signs = readExpression('!'.repeat(nesting + 1) + 'a');
    expect(signs.refusals[0]!.remedy).toContain('signs');
  });

  it('never throws, however deep or however long', () => {
    // `parseExpression` directly, not `readExpression`: `shape()` above
    // walks the tree by recursion, and a chain of fifty thousand terms
    // overflows the SPEC rather than the parser. Which is its own small
    // lesson — the suite has to be the thing under test, not the thing
    // that fails first.
    //
    // This also guards SPEED, not only throwing, and the guard is the
    // test timeout rather than an assertion. Stepping over a construct
    // the cap refused looks ahead for its closing bracket, which fills
    // the lexer's buffer; draining that buffer one `shift()` at a time
    // was quadratic and took this test from a millisecond to fifty-two
    // seconds. Do not raise the timeout to make this pass.
    for (const text of [
      '('.repeat(50_000) + 'a' + ')'.repeat(50_000),
      Array(50_000).fill('a').join(' + '),
      'a' + '.count'.repeat(50_000),
      '!'.repeat(50_000) + 'a',
      'a' + '.f(a'.repeat(50_000) + ')'.repeat(50_000),
    ]) {
      expect(
        () => parseExpression(new SourceFile('body.sprout', text), new Diagnostics()),
        text.slice(0, 16),
      ).not.toThrow();
    }
  });
});

// --- `let` (B11) ----------------------------------------------------------

function readLet(text: string) {
  const diagnostics = new Diagnostics();
  const statement = parseLet(new SourceFile('body.sprout', text), diagnostics);
  return { statement, diagnostics, refusals: diagnostics.refusals };
}

describe('`let` names the result of an expression', () => {
  it('reads the spec’s own two', () => {
    const ribs = readLet('let ribs  = tools.count(Rib)');
    expect(ribs.refusals).toEqual([]);
    expect(ribs.statement!.name.text).toBe('ribs');
    expect(shape(ribs.statement!.value)).toBe('tools.count(Rib)');

    const state = readLet('let state = self.get(:state)');
    expect(state.statement!.name.text).toBe('state');
    expect(shape(state.statement!.value)).toBe('self.get(:state)');
  });

  it('spans from the keyword to the end of what it names', () => {
    const { statement } = readLet('let ribs = tools.count(Rib)');
    expect(textOf(statement!.at)).toBe('let ribs = tools.count(Rib)');
    expect(locationOf(statement!.name.at)).toBe('body.sprout:1:5');
  });

  it('names a whole expression, not only a simple one', () => {
    expect(
      shape(readLet('let ready = self.get(:wear) >= 99 && !self.get(:lit)').statement!.value),
    ).toBe('((self.get(:wear) >= 99) && (!self.get(:lit)))');
  });

  it('takes no type, because it takes the expression’s exactly', () => {
    const { statement, refusals } = readLet('let n: integer = 1');
    expect(statement).toBeNull();
    expect(refusals[0]!.message).toContain('takes its type from what it names');
    expect(refusals[0]!.remedy).toContain('let n = ');
  });

  it('says what is wrong with one that is not written out', () => {
    const table: [string, string][] = [
      ['let', 'A `let` needs a name.'],
      ['let =', 'A `let` needs a name.'],
      ['let 4 = 1', 'A `let` needs a name.'],
      ['let Ward = 1', 'starts with a capital'],
      ['let x', 'is not given anything to name'],
      ['let x = ', 'the end of the file is not something to read'],
      ['ribs = 1', 'does not name a value'],
    ];
    for (const [text, said] of table) {
      const { statement, refusals } = readLet(text);
      expect(statement, text).toBeNull();
      expect(refusals.map((d) => d.message).join(' '), text).toContain(said);
      for (const refusal of refusals)
        expect(refusal.remedy ?? '', `${text}: no remedy`).not.toBe('');
    }
  });
});
