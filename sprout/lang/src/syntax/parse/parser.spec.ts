import { describe, expect, it } from 'vitest';

import type { EnumDeclaration } from '../ast.js';
import { Diagnostics } from '../../source/diagnostics.js';
import {
  DECLARATIONS,
  DEEPEST,
  parseDeclarations,
  parseExpression,
  parseProperty,
  parseRemembers,
} from '../parse.js';
import { SourceFile } from '../../source/source.js';
import { read, optionsOf, readProperty, readExpression, readWorld } from '../../fixtures/parse.js';
import { DECLARATION_READERS } from './declarations.js';
import { Parser } from './parser.js';

/** The parser's own depth bound, refused in the same words wherever it is met. */
const TOO_DEEP = 'This is nested too deep to read.';

/** A property, for the specs about depth that are written as one. */
function readExpressionOf(text: string) {
  const diagnostics = new Diagnostics();
  parseProperty(new SourceFile('k.sprout', text), diagnostics);
  return { refusals: diagnostics.refusals };
}

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

// The two describes below are paired on purpose: each case is a table
// with both readings side by side — the same shape, read the other way
// — so neither can be changed without the other being looked at.

describe('a declaration’s word inside a body: a word in an option’s place, or a forgotten brace', () => {
  /** What the parser says about a reserved word standing where an option should. */
  const notAnOption = (word: string): string =>
    `\`${word}\` is a word of the language, so it cannot be an option of \`Ward\`.`;

  const asOption: [string, string[], string[]][] = [
    ['enum Ward { message, silver }', ['silver'], ['message']],
    ['enum Ward { oak, message }', ['oak'], ['message']],
    ['enum Ward { enum, silver }', ['silver'], ['enum']],
    ['enum Ward { message }', [], ['message']],
    ['enum Ward { oak, kind, object }', ['oak'], ['kind', 'object']],
  ];
  for (const [text, kept, refused] of asOption) {
    it(`reads it as a word in an option’s place in ${text}`, () => {
      // The word is READ here rather than taken for the start of a
      // declaration, so the enum and everything after it survive. It is
      // then refused as an option, which the spec forbids.
      const { declarations, refusals } = read(text);
      expect(refusals.map((d) => d.message)).toEqual(refused.map(notAnOption));
      if (kept.length === 0) expect(declarations).toEqual([]);
      else expect(optionsOf(declarations[0] as EnumDeclaration)).toEqual(kept);
    });
  }

  it('does not swallow the declarations after it', () => {
    const { declarations, refusals } = read(
      'enum Ward { enum, silver }\nenum Glaze { none }\nmessage :stir\n',
    );
    expect(refusals.map((d) => d.message)).toEqual([notAnOption('enum')]);
    expect(declarations).toHaveLength(3);
  });

  const asForgottenBrace: string[] = [
    'enum Ward {\n  oak\nenum Two { a, b }\n',
    'enum Ward {\n  oak\nmessage :stir\n',
    'enum Ward {\n  oak,\nenum Two { a }\n',
    'enum Ward {\n  oak\nkind Crate { }\n',
    'enum Ward {\n  oak\nobject bench: Bench in hall\n',
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
    // A comma or a brace after it means a word in an option's place,
    // refused as an option; its own name after it means a declaration,
    // so the enum was never closed.
    expect(read('enum Ward { message, a }').refusals.map((d) => d.message)).toEqual([
      notAnOption('message'),
    ]);
    const asDeclaration = read('enum Ward { message :stir }').refusals.map((d) => d.message);
    expect(asDeclaration).toContain('`Ward` is never closed.');
    expect(asDeclaration).not.toContain(notAnOption('message'));
    // `object` is followed by its name and then `in` or a colon, and
    // `kind` by a capitalised name and its brace or colon.
    expect(read('enum Ward { object, a }').refusals.map((d) => d.message)).toEqual([
      notAnOption('object'),
    ]);
    for (const text of ['enum Ward { object bench in hall }', 'enum Ward { kind Crate { } }']) {
      const said = read(text).refusals.map((d) => d.message);
      expect(said, text).toContain('`Ward` is never closed.');
      expect(said, text).not.toContain(notAnOption(text.split(' ')[3]!));
    }
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

describe('the parser refuses rather than throwing, at its own bound', () => {
  const deep = (n: number) => `message :m with ${'['.repeat(n)}Ward`;

  it('refuses text past the bound instead of running out of stack', () => {
    const { refusals } = read(deep(7000));
    expect(refusals[0]!.message).toBe(TOO_DEEP);
  });

  it('names no number, because the bound is the parser’s and not a figure to write up to', () => {
    const { refusals } = read(deep(7000));
    expect(refusals[0]!.message, 'the refusal quotes a figure').not.toMatch(/\d/);
    expect(refusals[0]!.remedy).toBe('Take some of the brackets out.');
  });

  it('reads a type nested exactly to the bound', () => {
    expect(
      read(`message :m with ${'['.repeat(DEEPEST)}Ward${']'.repeat(DEEPEST)}`).refusals,
    ).toEqual([]);
  });

  it('never throws, however deep it is given', () => {
    for (const n of [100, 1_000, 20_000]) {
      expect(() => read(deep(n)), String(n)).not.toThrow();
      expect(() => read(`:x ${'['.repeat(n)}`), String(n)).not.toThrow();
    }
  });
});

describe('recovery and reading ask the same word different questions', () => {
  // A loop reading what the author WROTE stops when the answer is yes,
  // so a false yes loses their work; recovery is already skipping, so a
  // false no loses their diagnostic. One predicate cannot be wrong in
  // both directions at once, which is why there are two.
  //
  // One input per reading loop, each chosen so the two questions
  // disagree about it: a word this compiler reads, followed by
  // something that is neither that word's own opening nor a closer. A
  // change that asked the wrong question in one loop would otherwise
  // ship behind a green gate.

  it('an enum\u2019s options: the loose question would lose the option after the word', () => {
    const { declarations, refusals } = read('enum Ward { oak, message silver }');
    // `silver` is what the loose question would have lost, so it is
    // what this asserts; `message` is read and then refused as an
    // option, which is the other half of the same rule.
    expect(optionsOf(declarations[0] as EnumDeclaration)).toEqual(['oak', 'silver']);
    expect(refusals.map((d) => d.message)).toEqual([
      '`message` is a word of the language, so it cannot be an option of `Ward`.',
      '`Ward` needs a comma between its options.',
    ]);
  });

  it('a world\u2019s members: the loose question would not say the word is not a member', () => {
    const { declarations, refusals } = read(
      'world w: sprout.World { message foo }\nenum Ward { oak }',
    );
    expect(refusals.map((d) => d.message)).toEqual([
      'A world is not made of `message`.',
      '`w` is never closed.',
      'A message needs a name.',
    ]);
    expect(declarations.map((d) => d.name.text)).toEqual(['Ward']);
  });

  it('a list literal, past an element it could not read: it would lose the world', () => {
    const { declarations, refusals } = read(
      'world w: sprout.World {\n  :x [- message foo]\n  visitors are Creature\n  visitors arrive at start\n}\nenum Ward { oak }\n',
    );
    expect(declarations.map((d) => d.name.text)).toEqual(['w', 'Ward']);
    // `message` is what the sign stood before, and goes with it.
    expect(refusals.map((d) => d.message)).toEqual(['A minus sign needs a number after it.']);
  });

  it('a `:remembers`, past an entry it could not read: the same', () => {
    const { declarations, refusals } = read(
      'world outer: sprout.World {\n  :remembers [oops: - message foo]\n  visitors are Creature\n  visitors arrive at start\n}\nenum Ward { oak }\n',
    );
    expect(declarations.map((d) => d.name.text)).toEqual(['outer', 'Ward']);
    // `message foo` is the abandoned entry's own text, stepped over
    // whole rather than retried as a sibling, so only the one thing
    // wrong with `oops` is said.
    expect(refusals.map((d) => d.message)).toEqual(['A minus sign needs a number after it.']);
  });
});

describe('a declaration\u2019s own word is an ordinary name wherever a name may stand', () => {
  // *Reserved names* reserves nothing for a property's name or an
  // option's, so `enum`, `message` and `world` are ordinary words
  // almost everywhere. Recovery has to tell a declaration from a word
  // that merely spells one, and a remembered property's name is never
  // followed by a closer, since its grammar is `name: value` \u2014 so a
  // guard that asked only for a closer would read every `:remembers`
  // holding an entry called `enum` as a declaration starting mid-list
  // and throw it away whole, and inside a world would take the world
  // with it.
  //
  // The suite in `recovery.spec.ts` walks DEFECTIVE items and asks what
  // survives beside them. This is the other half \u2014 nothing well formed
  // is refused at all \u2014 and it is driven off DECLARATIONS so that `kind`
  // and `object` are covered the day they are added.

  it('as the name of a remembered property', () => {
    for (const word of DECLARATIONS) {
      const diagnostics = new Diagnostics();
      const remembered = parseRemembers(
        new SourceFile('k.sprout', `:remembers [${word}: 1, keep: 2]`),
        diagnostics,
      );
      expect(diagnostics.refusals, word).toEqual([]);
      expect(
        remembered?.properties.map((p) => p.name.text),
        word,
      ).toEqual([word, 'keep']);
    }
  });

  it('as an option in a list, wherever in it the word stands', () => {
    for (const word of DECLARATIONS) {
      for (const written of [
        `[${word}]`,
        `[oak, ${word}]`,
        `[${word}, oak]`,
        `[oak, ${word}, silver]`,
      ]) {
        const { declared, refusals } = readProperty(`:x [Ward] default ${written}`);
        expect(refusals, `${word} in ${written}`).toEqual([]);
        expect(
          declared?.default?.kind === 'list-literal'
            ? declared.default.elements.map((e) =>
                e.kind === 'option-literal' ? e.name.text : e.kind,
              )
            : null,
          `${word} in ${written}`,
        ).toContain(word);
      }
    }
  });

  it('and a comma dropped after it is a missing comma, not the end of the list', () => {
    // The word is followed by another option rather than by a closer.
    for (const word of DECLARATIONS) {
      const { declared, refusals } = readProperty(`:x [Ward] default [${word} silver]`);
      expect(
        refusals.map((d) => d.message),
        word,
      ).toEqual(['A list needs a comma between its elements.']);
      expect(
        declared?.default?.kind === 'list-literal'
          ? declared.default.elements.map((e) =>
              e.kind === 'option-literal' ? e.name.text : e.kind,
            )
          : null,
        word,
      ).toEqual([word, 'silver']);
    }
  });

  it('inside a world, where losing it would cost the whole declaration', () => {
    // The compound shape: an entry thrown away leaves `worldMembers` to
    // fire on the same unconsumed word, and `file()` to read that
    // leftover as a declaration the author never wrote \u2014 `w` would
    // vanish and a stray "An enum needs a name." would name nothing.
    for (const word of DECLARATIONS) {
      const { declarations, refusals } = readWorld(
        `world w: sprout.World {\n  :remembers [${word}: 1]\n  visitors are Creature\n  visitors arrive at start\n}\nenum Ward { oak }\n`,
      );
      expect(
        refusals.map((d) => d.message),
        word,
      ).toEqual([]);
      expect(
        declarations.map((d) => d.name.text),
        word,
      ).toEqual(['w', 'Ward']);
    }
  });
});

describe('the parser bounds its own recursion, and nothing else does', () => {
  it('reads what is within its bound, and refuses what is past it', () => {
    expect(readExpression('('.repeat(DEEPEST) + 'a' + ')'.repeat(DEEPEST)).expr).not.toBeNull();
    expect(readExpression('('.repeat(DEEPEST + 1) + 'a' + ')'.repeat(DEEPEST + 1)).expr).toBeNull();
    expect(readExpression('!'.repeat(DEEPEST) + 'a').expr).not.toBeNull();
    expect(readExpression('!'.repeat(DEEPEST + 1) + 'a').expr).toBeNull();
  });

  it('says so ONCE, however far past it goes', () => {
    // Reading on past an item that could not be read is what an author
    // owed three problems is owed all three for, but every item past
    // the cap sits at the same depth and fails identically, so reading
    // on would say one true thing once per level.
    for (const text of [
      '('.repeat(2000) + 'a' + ')'.repeat(2000),
      'a' + '.f(a'.repeat(2000) + ')'.repeat(2000),
      '!'.repeat(2000) + 'a',
    ]) {
      const said = readExpression(text).refusals.map((d) => d.message);
      expect(said, text.slice(0, 20)).toEqual(['This is nested too deep to read.']);
    }
  });

  it('says so once for a list too', () => {
    const diagnostics = new Diagnostics();
    parseProperty(new SourceFile('k.sprout', ':x ' + '['.repeat(2000) + 'oak'), diagnostics);
    expect(diagnostics.refusals.filter((d) => d.message === TOO_DEEP)).toHaveLength(1);
  });

  it('says so once for a `:remembers` too, which has the same loop', () => {
    const diagnostics = new Diagnostics();
    parseRemembers(
      new SourceFile('k.sprout', ':remembers [a: ' + '['.repeat(2000) + 'oak]'),
      diagnostics,
    );
    expect(diagnostics.refusals.filter((d) => d.message === TOO_DEEP)).toHaveLength(1);
  });

  it('says it once, and takes the whole construct with it rather than half', () => {
    // Two things had to be told apart here. What is INSIDE a construct
    // the cap abandoned goes with it — the same way an enum's options
    // go with an enum that could not be read — and one message is the
    // whole account of it. What comes AFTER it is a sibling the author
    // is still owed, so stopping at the first too-deep item would say
    // the depth once and drop everything else that was wrong.
    const deep = '['.repeat(DEEPEST + 1);
    const inside = readExpressionOf(`:x [${deep}oak, Zeta]`).refusals.map((d) => d.message);
    expect(inside.filter((m) => m === TOO_DEEP)).toHaveLength(1);

    const diagnostics = new Diagnostics();
    const after = parseRemembers(
      new SourceFile('k.sprout', `:remembers [a: ${deep}oak${']'.repeat(DEEPEST + 1)}, b c: 1]`),
      diagnostics,
    );
    const said = diagnostics.refusals.map((d) => d.message);
    expect(said.filter((m) => m === TOO_DEEP)).toHaveLength(1);
    expect(said.join(' ')).toContain('needs a colon between its name and its value');
    expect(after).not.toBeNull();
  });

  it('gives each declaration its own account of being too deep', () => {
    const diagnostics = new Diagnostics();
    const deep = '['.repeat(DEEPEST + 1);
    parseDeclarations(
      new SourceFile(
        'k.sprout',
        `message :a with ${deep}Ward
message :b with ${deep}Ward
`,
      ),
      diagnostics,
    );
    expect(diagnostics.refusals.filter((d) => d.message === TOO_DEEP)).toHaveLength(2);
  });

  it('counts prefix signs against the same depth brackets do', () => {
    // A counter of its own would give every bracketed level a fresh
    // allowance of signs on top of the shared one, so a bracket at the
    // bound could still hold a wall of signs and read twice as deep,
    // with nothing said.
    expect(readExpression('(' + '!'.repeat(DEEPEST - 1) + 'a)').expr).not.toBeNull();
    expect(readExpression('(' + '!'.repeat(DEEPEST) + 'a)').expr).toBeNull();
    const stacked = ('(' + '!'.repeat(DEEPEST)).repeat(DEEPEST) + 'a' + ')'.repeat(DEEPEST);
    expect(readExpression(stacked).refusals.map((d) => d.message)).toEqual([TOO_DEEP]);
  });

  it('steps over what it would not read, rather than leaving its closer behind', () => {
    // A bracket the cap refuses is consumed and never opens a level;
    // without the skip its CLOSER would be left in the stream, where
    // the loop reading around it takes the closer for its own and ends
    // early, dropping everything after it with nothing said.
    const deep = '('.repeat(DEEPEST) + 'a' + ')'.repeat(DEEPEST);
    const call = readExpression(`self.f(${deep}, b)`);
    expect(call.shape).toBe('self.f(b)');
    expect(call.refusals.map((d) => d.message)).toEqual([TOO_DEEP]);

    // The same shape in a `:remembers`.
    const diagnostics = new Diagnostics();
    const remembered = parseRemembers(
      new SourceFile(
        'k.sprout',
        ':remembers [a: ' + '['.repeat(DEEPEST + 1) + 'oak' + ']'.repeat(DEEPEST + 1) + ', b: 3]',
      ),
      diagnostics,
    );
    expect(remembered!.properties.map((p) => p.name.text)).toEqual(['a', 'b']);
  });

  it('steps over a TYPE it would not read, keeping the entry after it', () => {
    // The type path opens its own bracket before it discovers it may
    // not read what is inside, so it is the one that has to step back
    // over it. Left behind, that `]` ends the `:remembers` around it
    // and `b` goes with nothing said.
    const type = '['.repeat(DEEPEST + 1) + 'Ward' + ']'.repeat(DEEPEST + 1);
    const diagnostics = new Diagnostics();
    const remembered = parseRemembers(
      new SourceFile('k.sprout', `:remembers [a: ${type} default oak, b: 3]`),
      diagnostics,
    );
    expect(remembered!.properties.map((p) => p.name.text)).toEqual(['b']);
    // And exactly one thing said: nothing about `oak`, `default` or a
    // missing colon, which are pieces of the entry it gave up on and
    // not mistakes the author made.
    expect(diagnostics.refusals.map((d) => d.message)).toEqual([TOO_DEEP]);
  });

  it('steps over the default of a property whose type it would not read', () => {
    // The default and the bounds are the refused property's own text.
    // Read as anything else they become entries of their own, and the
    // author is told about mistakes they did not make.
    const type = '['.repeat(DEEPEST + 1) + 'Ward' + ']'.repeat(DEEPEST + 1);
    for (const tail of ['default oak', 'default [oak, silver]', 'default 0 min 0 max 9']) {
      const diagnostics = new Diagnostics();
      const remembered = parseRemembers(
        new SourceFile('k.sprout', `:remembers [a: ${type} ${tail}, b: 3]`),
        diagnostics,
      );
      expect(
        remembered!.properties.map((p) => p.name.text),
        tail,
      ).toEqual(['b']);
      expect(
        diagnostics.refusals.map((d) => d.message),
        tail,
      ).toEqual([TOO_DEEP]);
    }
  });

  it('steps over a VALUE and a bracketed expression the same way', () => {
    const value = '['.repeat(DEEPEST + 1) + 'oak' + ']'.repeat(DEEPEST + 1);
    const list = new Diagnostics();
    const remembered = parseRemembers(
      new SourceFile('k.sprout', `:remembers [a: ${value}, b: 3]`),
      list,
    );
    expect(remembered!.properties.map((p) => p.name.text)).toEqual(['a', 'b']);
    expect(list.refusals.map((d) => d.message)).toEqual([TOO_DEEP]);

    const bracketed = readExpression(
      'self.f(' + '('.repeat(DEEPEST + 1) + 'a' + ')'.repeat(DEEPEST + 1) + ', b)',
    );
    expect(bracketed.shape).toBe('self.f(b)');
    expect(bracketed.refusals.map((d) => d.message)).toEqual([TOO_DEEP]);
  });

  it('walks past a word that only looks like a declaration inside it', () => {
    // Nothing reserves `message` or `enum`, so `[message foo]` is a
    // list of two things. A skip that stopped at one would leave the
    // real closers behind, which is what the skip exists to prevent.
    const trap = '['.repeat(DEEPEST + 1) + 'message foo' + ']'.repeat(DEEPEST + 1);
    const diagnostics = new Diagnostics();
    const remembered = parseRemembers(
      new SourceFile('k.sprout', `:remembers [a: ${trap}, c: 3]`),
      diagnostics,
    );
    expect(remembered!.properties.map((p) => p.name.text)).toEqual(['a', 'c']);
    expect(diagnostics.refusals.map((d) => d.message)).toEqual([TOO_DEEP]);

    // And at file scope it must not invent a declaration out of the
    // trapped word: `A message needs a name.` about content the author
    // never wrote as one is worse than saying nothing.
    const atFile = new Diagnostics();
    const declared = parseDeclarations(
      new SourceFile('k.sprout', `message :first with ${trap}\nmessage :second\n`),
      atFile,
    );
    expect(declared.map((d) => d.name.text)).toEqual(['second']);
    expect(atFile.refusals.map((d) => d.message)).toEqual([TOO_DEEP]);
  });

  it('takes nothing at all where the closer was never written', () => {
    // The skip looks for its closer before consuming anything, so a
    // bracket that was never closed does not take the rest of the file
    // with it.
    const diagnostics = new Diagnostics();
    const declared = parseDeclarations(
      new SourceFile(
        'k.sprout',
        `message :a with ${'['.repeat(DEEPEST + 2)}Ward\nmessage :b with ${'['.repeat(DEEPEST + 2)}Ward\n`,
      ),
      diagnostics,
    );
    expect(declared).toHaveLength(0);
    expect(diagnostics.refusals.filter((d) => d.message === TOO_DEEP)).toHaveLength(2);
  });

  it('names what the author actually wrote too much of', () => {
    const brackets = readExpression('('.repeat(DEEPEST + 1) + 'a' + ')'.repeat(DEEPEST + 1));
    expect(brackets.refusals[0]!.remedy).toContain('brackets');
    // A wall of signs has no bracket in it.
    const signs = readExpression('!'.repeat(DEEPEST + 1) + 'a');
    expect(signs.refusals[0]!.remedy).toContain('signs');
  });

  it('reads each kind of stack exactly at the bound, and refuses one past it', () => {
    // The bound is set by the STACK, so what the parser accepts it must
    // also survive: at the bound every kind of nesting parses, and one
    // deeper is a refusal rather than a `RangeError`.
    const at: [string, string][] = [
      ['parentheses', '('.repeat(DEEPEST) + 'a' + ')'.repeat(DEEPEST)],
      ['call arguments', 'a' + '.f(a'.repeat(DEEPEST) + ')'.repeat(DEEPEST)],
      ['prefix signs', '!'.repeat(DEEPEST) + 'a'],
    ];
    for (const [what, text] of at) {
      expect(readExpression(text).refusals, what).toEqual([]);
    }

    const past: [string, string][] = [
      ['parentheses', '('.repeat(DEEPEST + 1) + 'a' + ')'.repeat(DEEPEST + 1)],
      ['call arguments', 'a' + '.f(a'.repeat(DEEPEST + 1) + ')'.repeat(DEEPEST + 1)],
      ['prefix signs', '!'.repeat(DEEPEST + 1) + 'a'],
    ];
    for (const [what, text] of past) {
      // The refusal, not a null tree: a call whose argument was refused
      // reads on to its closing bracket and comes back with no
      // arguments, which is the same recovery an unreadable argument
      // gets anywhere else.
      expect(
        readExpression(text).refusals.map((d) => d.message),
        what,
      ).toEqual([TOO_DEEP]);
    }

    // The same, written as the types and values a property takes.
    const type = (n: number) => `:x ${'['.repeat(n)}Ward${']'.repeat(n)} default []`;
    const value = (n: number) => `:x ${'['.repeat(n)}${']'.repeat(n)}`;
    expect(readProperty(type(DEEPEST)).refusals).toEqual([]);
    expect(readProperty(value(DEEPEST)).refusals).toEqual([]);
    expect(readProperty(type(DEEPEST + 1)).refusals.map((d) => d.message)).toEqual([TOO_DEEP]);
    expect(readProperty(value(DEEPEST + 1)).refusals.map((d) => d.message)).toEqual([TOO_DEEP]);
  });

  it('never throws, however deep or however long', () => {
    // `parseExpression` directly, not `readExpression`: `shape()`
    // walks the tree by recursion, and a chain of fifty thousand terms
    // would overflow the SPEC rather than the parser.
    //
    // This also guards SPEED, not only throwing, and the guard is the
    // test timeout rather than an assertion. Stepping over a construct
    // the cap refused looks ahead for its closing bracket, which fills
    // the lexer's buffer; draining that buffer one `shift()` at a time
    // would be quadratic and take this test from a millisecond to the
    // better part of a minute. Do not raise the timeout to make this
    // pass.
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

    // And the bracket kinds a property is written with, which reach the
    // same bound down a different path.
    for (const text of [
      `:x ${'['.repeat(20_000)}Ward${']'.repeat(20_000)} default []`,
      `:x ${'['.repeat(20_000)}${']'.repeat(20_000)}`,
      `:x ${'['.repeat(20_000)}Ward`,
    ]) {
      expect(
        () => parseProperty(new SourceFile('k.sprout', text), new Diagnostics()),
        text.slice(0, 16),
      ).not.toThrow();
    }
  });
});

describe('what the parser says about the passages the lexer hands it', () => {
  const over = (text: string) =>
    new Parser(new SourceFile('k.sprout', text), new Diagnostics(), DECLARATION_READERS);

  it("describes a passage's body as words, never by the prose it holds", () => {
    const p = over('passage greeting { Hello, {actor}. }');
    expect(p.describe(p.peek(2))).toBe("a passage's words in braces");
  });

  it('knows when a passage or a comment never closed took the rest of the file', () => {
    for (const [text, swallowed] of [
      ['passage greeting { Hello, {actor}.', true],
      ['/* the rest', true],
      ['passage greeting { Hello. }', false],
      ['%', false],
    ] as const) {
      const p = over(text);
      while (!p.done) p.next();
      expect(p.swallowedRest, text).toBe(swallowed);
    }
  });
});
