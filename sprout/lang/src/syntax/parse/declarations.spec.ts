import { describe, expect, it } from 'vitest';

import type { EnumDeclaration } from '../ast.js';
import { Diagnostics } from '../../source/diagnostics.js';
import { unspanned } from '../../source/nodes.js';
import { DECLARATIONS, parseDeclarations, parseProperty, parseRemembers } from '../parse.js';
import { locationOf, SourceFile, textOf } from '../../source/source.js';
import { read, optionsOf } from '../../fixtures/parse.js';

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

  it('takes a comma after the last option, which the spec allows', () => {
    const { declarations, refusals } = read('enum Ward { oak, silver, }');
    expect(refusals).toEqual([]);
    expect(optionsOf(declarations[0] as EnumDeclaration)).toEqual(['oak', 'silver']);
  });

  it('takes one after the only option, and one on a line of its own', () => {
    expect(optionsOf(read('enum Only { one, }').declarations[0] as EnumDeclaration)).toEqual([
      'one',
    ]);
    const spread = read('enum Ward {\n  oak,\n  silver,\n}\n');
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

  it('refuses a comma with no option before it, and one with nothing between two', () => {
    const empty = read('enum Ward { , }');
    expect(empty.refusals[0]!.message).toBe('`Ward` cannot hold `,`.');
    expect(empty.refusals[0]!.remedy).toContain('lower-case word');

    const doubled = read('enum Ward { oak,, silver }');
    expect(doubled.refusals[0]!.message).toBe('`Ward` cannot hold `,`.');
    expect(locationOf(doubled.refusals[0]!.at)).toBe('ward.sprout:1:17');
  });

  it('refuses a missing comma, pointing where it should go', () => {
    const { refusals } = read('enum Ward { oak silver }');
    expect(refusals[0]!.message).toBe('`Ward` needs a comma between its options.');
    expect(locationOf(refusals[0]!.at)).toBe('ward.sprout:1:17');
  });

  it('still names a missing comma before a word of the language', () => {
    const { declarations, refusals } = read('enum Ward { oak message }');
    expect(refusals.map((d) => d.message)).toEqual([
      '`Ward` needs a comma between its options.',
      '`message` is a word of the language, so it cannot be an option of `Ward`.',
    ]);
    expect(locationOf(refusals[0]!.at)).toBe('ward.sprout:1:17');
    // The word the author has to replace is not offered back to them.
    expect(refusals[0]!.remedy).toBe('Write `enum Ward { oak, … }`.');
    expect(optionsOf(declarations[0] as EnumDeclaration)).toEqual(['oak']);
  });

  it('names a missing comma at each gap, and a word of the language between them', () => {
    const { declarations, refusals } = read('enum Ward { oak message silver }');
    expect(refusals.map((d) => d.message)).toEqual([
      '`Ward` needs a comma between its options.',
      '`message` is a word of the language, so it cannot be an option of `Ward`.',
      '`Ward` needs a comma between its options.',
    ]);
    expect(locationOf(refusals[0]!.at)).toBe('ward.sprout:1:17');
    expect(locationOf(refusals[2]!.at)).toBe('ward.sprout:1:25');
    expect(optionsOf(declarations[0] as EnumDeclaration)).toEqual(['oak', 'silver']);
  });

  it('points the comma at the gap it is missing from, not at the next one', () => {
    const { declarations, refusals } = read('enum Ward { oak message, silver }');
    expect(refusals.map((d) => d.message)).toEqual([
      '`Ward` needs a comma between its options.',
      '`message` is a word of the language, so it cannot be an option of `Ward`.',
    ]);
    expect(locationOf(refusals[0]!.at)).toBe('ward.sprout:1:17');
    expect(optionsOf(declarations[0] as EnumDeclaration)).toEqual(['oak', 'silver']);
  });

  it('refuses a word of the language as an option, at the word', () => {
    const { declarations, refusals } = read('enum Ward { oak, default, silver }');
    expect(refusals).toHaveLength(1);
    expect(refusals[0]!.message).toBe(
      '`default` is a word of the language, so it cannot be an option of `Ward`.',
    );
    expect(refusals[0]!.remedy).toBe('Choose another word for it.');
    expect(locationOf(refusals[0]!.at)).toBe('ward.sprout:1:18');
    // The enum keeps the options that are options: one bad word does
    // not cost the declaration.
    expect(optionsOf(declarations[0] as EnumDeclaration)).toEqual(['oak', 'silver']);
  });

  it('refuses an enum whose only option is a word of the language, and says so once', () => {
    const { declarations, refusals } = read('enum Ward { string }');
    expect(declarations).toEqual([]);
    expect(refusals.map((d) => d.message)).toEqual([
      '`string` is a word of the language, so it cannot be an option of `Ward`.',
    ]);
  });

  it('refuses an enum that is never closed, at the end of the file', () => {
    const { refusals } = read('enum Ward { oak, silver');
    expect(refusals[0]!.message).toBe('`Ward` is never closed.');
    expect(refusals[0]!.remedy).toBe('Add a } after its options.');
    expect(locationOf(refusals[0]!.at)).toBe('ward.sprout:1:24');
  });

  it('refuses a word it cannot read at the top of a file, and says what it can read', () => {
    // `kind` is B19's, so this compiler does not read it yet.
    const { refusals } = read('kind Vessel { }');
    expect(refusals[0]!.message).toBe('Sprout does not know what to do with "kind" here.');
    expect(refusals[0]!.remedy).toBe(
      'A file holds declarations, and this compiler reads `enum`, `message` and `world`.',
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

  it('reports the second one even where its own word cannot say what it is', () => {
    // Recovery asks a LOOSER question than a loop reading elements
    // does, and this is why. `message` with the name forgotten has no
    // opening to recognise, and a nameless `world: victorian.Voice {`
    // has one that `world` deliberately does not claim — so the strict
    // question walks past both as filler and the author is told about
    // the first mistake only. An author owed two problems is owed both.
    const bare = read('enum Ward oak silver\nmessage\nenum Glaze { none, shino }\n');
    expect(bare.refusals.map((d) => d.message)).toEqual([
      'The options of `Ward` go in braces.',
      'A message needs a name.',
    ]);
    expect(bare.declarations.map((d) => d.name.text)).toEqual(['Glaze']);

    // The same through `recoverInBraces`, which hunts for a `}`.
    const nameless = read(
      'enum Ward { oak,\n42\nworld: v.X {\n  contains\n}\nenum Glaze { none, shino }\n',
    );
    expect(nameless.refusals.map((d) => d.message)).toContain('A world needs a name.');
    expect(nameless.declarations.map((d) => d.name.text)).toEqual(['Ward', 'Glaze']);
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

// Each case below is an input where the parser must not say something
// that is not the author's mistake, eat a declaration, or throw.

describe('one mistake is said once, and said truly', () => {
  const only = (text: string): string[] => read(text).refusals.map((d) => d.message);

  it('does not stop recovery on a word that merely spells a keyword', () => {
    // Nothing reserves an option's name, so recovery asks what follows
    // the word rather than matching it by spelling.
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

  it('keeps the entry after one whose type it could not read, and says nothing else', () => {
    // A refused type takes the whole property with it: its brackets, so
    // no closer is left for the `:remembers` to end early on, and its
    // default, so `default` and `oak` are not read as entries of their
    // own and answered for as if the author had written them that way.
    const diagnostics = new Diagnostics();
    const declared = parseRemembers(
      new SourceFile('k.sprout', ':remembers [a: [Ward, oak] default silver, b: 3]'),
      diagnostics,
    );
    expect(diagnostics.refusals.map((d) => d.message)).toEqual([
      'A list type names one element type.',
    ]);
    expect(declared!.properties.map((p) => p.name.text)).toEqual(['b']);
  });

  it('steps over however the default of such a property was written', () => {
    const tails = ['default oak', 'default -3', 'default 1.5', 'default "x"', 'default [oak]'];
    for (const tail of tails) {
      const diagnostics = new Diagnostics();
      const declared = parseRemembers(
        new SourceFile('k.sprout', `:remembers [a: [Ward, oak] ${tail}, b: 3]`),
        diagnostics,
      );
      expect(
        diagnostics.refusals.map((d) => d.message),
        tail,
      ).toEqual(['A list type names one element type.']);
      expect(
        declared!.properties.map((p) => p.name.text),
        tail,
      ).toEqual(['b']);
    }

    // And a property that ends where its default should have been takes
    // nothing with it: `b` is the next entry, not the missing value.
    const diagnostics = new Diagnostics();
    const declared = parseRemembers(
      new SourceFile('k.sprout', ':remembers [a: [Ward, oak] default, b: 3]'),
      diagnostics,
    );
    expect(declared!.properties.map((p) => p.name.text)).toEqual(['b']);
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
    // The span ends at whichever bound was written last; a span that
    // stopped short would suppress a real missing comma one level up.
    // The two readings have to agree.
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

describe('what recovery says, and what it keeps', () => {
  it('names where recovery actually stopped, not the end of the file', () => {
    // `recoverInBraces` gives up for two reasons, and only one of them
    // is the end of the file.
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
    // added to one and not the other cannot ship, in either direction.
    const { refusals } = read('nonsense');
    const named = [...refusals[0]!.remedy!.matchAll(/`([a-z]+)`/g)].map((m) => m[1]!);
    expect(named.sort()).toEqual([...DECLARATIONS].sort());
  });
});
