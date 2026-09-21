import { describe, expect, it } from 'vitest';

import type { EnumDeclaration } from './ast.js';
import { Diagnostics, type Diagnostic } from './diagnostics.js';
import { unspanned } from './nodes.js';
import { DECLARATIONS, parseDeclarations } from './parse.js';
import { locationOf, SourceFile, textOf } from './source.js';

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
    expect(refusals[0]!.remedy).toBe('A file holds declarations, and this compiler reads `enum`.');
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
