import { describe, expect, it } from 'vitest';

import { Diagnostics } from '../source/diagnostics.js';
import { Lexer, tokenise, type Token } from './lexer.js';
import { unspanned } from '../source/nodes.js';
import { locationOf, SourceFile, textOf } from '../source/source.js';
import { chooser } from '../fixtures/parse.js';

/** Tokenise a scrap of source, with the diagnostics it raised. */
function read(text: string, name = 'kiln.sprout'): { tokens: Token[]; diagnostics: Diagnostics } {
  const diagnostics = new Diagnostics();
  return { tokens: tokenise(new SourceFile(name, text), diagnostics), diagnostics };
}

/** Every token but the `end` one, as `kind:text` pairs. */
function shapes(text: string): string[] {
  return read(text)
    .tokens.filter((t) => t.kind !== 'end')
    .map((t) => `${t.kind}:${t.text}`);
}

describe('the token surface the language is written in', () => {
  it('reads an identifier, which may be a keyword', () => {
    expect(shapes('world printers_shop')).toEqual(['name:world', 'name:printers_shop']);
  });

  it('reads `_` alone as a name, for a parameter left unnamed, and nowhere else', () => {
    expect(shapes('(_, value)')).toEqual(['punct:(', 'name:_', 'punct:,', 'name:value', 'punct:)']);
    const { tokens, diagnostics } = read('_value');
    expect(diagnostics.refusals.map((d) => d.message)).toEqual([
      'Sprout does not use the character "_".',
    ]);
    expect(tokens.filter((t) => t.kind !== 'end').map((t) => `${t.kind}:${t.text}`)).toEqual([
      'name:value',
    ]);
  });

  it('reads a kind or an enum by its capital', () => {
    expect(shapes('Season Creature')).toEqual(['kind:Season', 'kind:Creature']);
  });

  it('leaves a dotted name to the parser, as three tokens', () => {
    expect(shapes('sprout.Actor')).toEqual(['name:sprout', 'punct:.', 'kind:Actor']);
  });

  it('reads a symbol without its colon', () => {
    expect(shapes(':season :touch_dry')).toEqual(['symbol:season', 'symbol:touch_dry']);
  });

  it('reads a colon that starts no symbol as punctuation', () => {
    expect(shapes('act nuzzle (target: p)').slice(3, 5)).toEqual(['name:target', 'punct::']);
  });

  it('reads an integer unsigned, leaving the sign to the parser', () => {
    expect(shapes('-40')).toEqual(['punct:-', 'integer:40']);
  });

  it('reads text as what it says, not as it is written', () => {
    expect(shapes('"work [target] with [tools]"')).toEqual(['string:work [target] with [tools]']);
  });

  it('knows the four escapes text has', () => {
    expect(read('"a \\"b\\" \\\\ c\\nd \\{e"').tokens[0]!.text).toBe('a "b" \\ c\nd {e');
  });

  it('reads an unescaped { inside quotes as itself', () => {
    expect(shapes('"back {soon}"')).toEqual(['string:back {soon}']);
  });

  it('reads every operator the checker names', () => {
    expect(shapes('== != <= >= && || < > + - ! =')).toEqual([
      'punct:==',
      'punct:!=',
      'punct:<=',
      'punct:>=',
      'punct:&&',
      'punct:||',
      'punct:<',
      'punct:>',
      'punct:+',
      'punct:-',
      'punct:!',
      'punct:=',
    ]);
  });

  it('reads the longest operator, so `->` is never a minus', () => {
    expect(shapes('-> == =')).toEqual(['punct:->', 'punct:==', 'punct:=']);
  });

  it('reads the brackets a body is built from', () => {
    expect(shapes('{}()[],.')).toEqual([
      'punct:{',
      'punct:}',
      'punct:(',
      'punct:)',
      'punct:[',
      'punct:]',
      'punct:,',
      'punct:.',
    ]);
  });

  it('skips a // comment to the end of its line', () => {
    expect(shapes(':lit false // type from the literal\n:wear 0')).toEqual([
      'symbol:lit',
      'name:false',
      'symbol:wear',
      'integer:0',
    ]);
  });

  it('skips a /* comment */ within a line and across lines', () => {
    expect(shapes(':lit /* type from\n the literal */ false\n:wear 0')).toEqual([
      'symbol:lit',
      'name:false',
      'symbol:wear',
      'integer:0',
    ]);
  });

  it('closes a block comment at the first */, however many /* it holds', () => {
    const { tokens, diagnostics } = read('/* a /* b */ :wear 0');
    expect(tokens.map((t) => `${t.kind}:${t.text}`)).toEqual(['symbol:wear', 'integer:0', 'end:']);
    expect(diagnostics.all).toEqual([]);
  });

  it('refuses a block comment that is never closed, at its opening, and reads nothing after it', () => {
    const { tokens, diagnostics } = read(':lit false\n/* the rest\n:wear 0');
    expect(tokens.map((t) => t.kind)).toEqual(['symbol', 'name', 'end']);
    expect(diagnostics.all).toHaveLength(1);
    const [said] = diagnostics.all;
    expect(said!.message).toBe('This comment is never closed.');
    expect(locationOf(said!.at)).toBe('kiln.sprout:2:1');
    expect(textOf(said!.at)).toBe('/*');
    expect(tokens.at(-1)!.afterRefusal).toBe(true);
  });

  it('ends with a zero-width end token, and stays there', () => {
    const lexer = new Lexer(new SourceFile('empty.sprout', ''), new Diagnostics());
    expect(lexer.next().kind).toBe('end');
    expect(lexer.next().kind).toBe('end');
    expect(lexer.done).toBe(true);
  });
});

describe('every token knows where it was written', () => {
  const source = new SourceFile(
    'composing_room.sprout',
    ['object paper_store is sprout.Place {', '  :open  false', '  :ward  iron', '}', ''].join('\n'),
  );

  it('covers exactly its own text, for every token in a file', () => {
    const tokens = tokenise(source, new Diagnostics()).filter((t) => t.kind !== 'end');
    for (const token of tokens) {
      const written = textOf(token.at);
      const expected =
        token.kind === 'string'
          ? `"${token.text}"`
          : token.kind === 'symbol'
            ? `:${token.text}`
            : token.text;
      expect(written).toBe(expected);
    }
    expect(tokens.length).toBeGreaterThan(10);
  });

  it('names the line and column of the token, not of the definition it sits in', () => {
    const tokens = tokenise(source, new Diagnostics());
    const ward = tokens.find((t) => t.kind === 'symbol' && t.text === 'ward')!;
    expect(locationOf(ward.at)).toBe('composing_room.sprout:3:3');
  });

  it('is a node by the rule every node keeps', () => {
    expect(unspanned(tokenise(source, new Diagnostics()))).toEqual([]);
  });

  it('puts the end token at the end of the file', () => {
    const tokens = tokenise(source, new Diagnostics());
    const end = tokens.at(-1)!;
    expect(end.at.start).toBe(source.text.length);
    expect(end.at.end).toBe(source.text.length);
  });

  it('spans a symbol from its colon, which is what an author sees', () => {
    const { tokens } = read(':door open');
    expect(textOf(tokens[0]!.at)).toBe(':door');
  });

  it('spans text from quote to quote', () => {
    const { tokens } = read('"a b"');
    expect(textOf(tokens[0]!.at)).toBe('"a b"');
  });
});

describe('a problem names its own character and reading carries on', () => {
  it('refuses a character the language does not use, at that character', () => {
    const { tokens, diagnostics } = read(':door % open');
    expect(diagnostics.refusals).toHaveLength(1);
    expect(locationOf(diagnostics.refusals[0]!.at)).toBe('kiln.sprout:1:7');
    expect(diagnostics.refusals[0]!.message).toContain('"%"');
    expect(diagnostics.refusals[0]!.remedy).toBeTruthy();
    expect(tokens.map((t) => t.text)).toEqual(['door', 'open', '']);
  });

  it('reports every bad character, not the first', () => {
    expect(read('% ; %').diagnostics.refusals).toHaveLength(3);
  });

  it('refuses text that is never closed, at the quote that opened it', () => {
    const { tokens, diagnostics } = read('say "hello\nsay "there"');
    expect(diagnostics.refusals).toHaveLength(1);
    expect(locationOf(diagnostics.refusals[0]!.at)).toBe('kiln.sprout:1:5');
    expect(diagnostics.refusals[0]!.message).toContain('never closed');
    expect(tokens[1]!.text).toBe('hello');
    expect(tokens.map((t) => t.kind)).toEqual(['name', 'string', 'name', 'string', 'end']);
  });

  it('refuses an escape it does not know, at the backslash, and keeps the character', () => {
    const { tokens, diagnostics } = read('"a \\q b"');
    expect(locationOf(diagnostics.refusals[0]!.at)).toBe('kiln.sprout:1:4');
    expect(tokens[0]!.text).toBe('a q b');
  });

  it('never throws, whatever it is given', () => {
    for (const text of ['"', '\\', ':', '%', '"\\', ':::', '// ', '"a\n']) {
      expect(() => read(text)).not.toThrow();
    }
  });
});

describe('the lexer is pulled, and peeking reads what pulling would', () => {
  const source = new SourceFile('kiln.sprout', 'passage immovable { chained }');

  it('peeks without consuming, at any distance', () => {
    const lexer = new Lexer(source, new Diagnostics());
    expect(lexer.peek().text).toBe('passage');
    expect(lexer.peek(2).kind).toBe('passage-body');
    expect(lexer.peek().text).toBe('passage');
    expect(lexer.next().text).toBe('passage');
    expect(lexer.next().text).toBe('immovable');
  });

  it('reads the same tokens pulled one at a time as tokenise does in one pass', () => {
    const lexer = new Lexer(source, new Diagnostics());
    const pulled: Token[] = [];
    while (!lexer.done) pulled.push(lexer.next());
    expect(pulled.map((t) => t.text)).toEqual(
      tokenise(source, new Diagnostics())
        .filter((t) => t.kind !== 'end')
        .map((t) => t.text),
    );
  });
});

describe('the spec worked example reads as tokens', () => {
  // The spec's A worked microworld › world.sprout, as written there.
  const WORLD = [
    'world printers_shop is sprout.World {',
    '  contains',
    '  visitors are Creature',
    '  visitors arrive at composing_room',
    '  :season Season default autumn',
    '}',
    '',
    'enum Season { spring, summer, autumn, winter }',
    '',
    'message :stir',
    '',
    'verb work {',
    '  role target',
    '  role tools many',
    '  "work [target]"',
    '  "work [target] with [tools]"',
    '}',
    '',
  ].join('\n');

  const source = new SourceFile('world.sprout', WORLD);
  const diagnostics = new Diagnostics();
  const tokens = tokenise(source, diagnostics);

  it('reads with nothing to refuse', () => expect(diagnostics.all).toEqual([]));

  it('reads the world head, the library it composes and all', () => {
    expect(tokens.slice(0, 7).map((t) => `${t.kind}:${t.text}`)).toEqual([
      'name:world',
      'name:printers_shop',
      'name:is',
      'name:sprout',
      'punct:.',
      'kind:World',
      'punct:{',
    ]);
  });

  it('reads an enum body as its options', () => {
    const keyword = tokens.findIndex((t) => t.kind === 'name' && t.text === 'enum');
    expect(tokens.slice(keyword + 1, keyword + 3).map((t) => t.text)).toEqual(['Season', '{']);
    expect(tokens.slice(keyword + 3, keyword + 10).map((t) => t.text)).toEqual([
      'spring',
      ',',
      'summer',
      ',',
      'autumn',
      ',',
      'winter',
    ]);
  });

  it('reads a phrase as one piece of text with its slots still in it', () => {
    const phrases = tokens.filter((t) => t.kind === 'string').map((t) => t.text);
    expect(phrases).toEqual(['work [target]', 'work [target] with [tools]']);
  });

  it('names the column of the property, not of the world it is in', () => {
    const season = tokens.find((t) => t.kind === 'symbol' && t.text === 'season')!;
    expect(locationOf(season.at)).toBe('world.sprout:5:3');
  });
});

describe('a token says whether a character was refused just before it', () => {
  const read = (text: string) => tokenise(new SourceFile('kiln.sprout', text), new Diagnostics());

  it('marks the token after a character it stepped over', () => {
    const tokens = read('oak % silver');
    expect(tokens.map((t) => `${t.text}:${t.afterRefusal}`)).toEqual([
      'oak:false',
      'silver:true',
      ':false',
    ]);
  });

  it('marks nothing when the gap holds only spaces', () => {
    expect(read('oak   silver').every((t) => !t.afterRefusal)).toBe(true);
  });

  it('marks only the token that follows the character, not the ones after that', () => {
    expect(read('a % b c').map((t) => t.afterRefusal)).toEqual([false, true, false, false]);
  });

  it('marks the end token when the file ends on a refused character', () => {
    const tokens = read('a %');
    expect(tokens.at(-1)!.kind).toBe('end');
    expect(tokens.at(-1)!.afterRefusal).toBe(true);
  });

  it('marks once for a run of refused characters, since it is one gap', () => {
    expect(read('a %%% b').map((t) => t.afterRefusal)).toEqual([false, true, false]);
  });
});

describe('looking ahead, and the cursor that reading back does not pay for', () => {
  // `peek` buffers as far as it is asked, and something does ask: the
  // parser steps over a construct it could not read by looking for its
  // closing bracket first. Draining that buffer one `shift()` at a time
  // would be quadratic in its length.
  const source = () => new SourceFile('k.sprout', 'a b c d e f g h\n');

  it('hands back the same tokens whether they were peeked at first or not', () => {
    const straight = new Lexer(source(), new Diagnostics());
    const peeked = new Lexer(source(), new Diagnostics());
    for (let i = 0; i < 8; i++) peeked.peek(i);

    for (let i = 0; i < 8; i++) {
      expect(peeked.next().text, `token ${i}`).toBe(straight.next().text);
    }
    expect(peeked.next().kind).toBe('end');
  });

  it('keeps `peek` and `next` agreeing while they are interleaved', () => {
    const lexer = new Lexer(source(), new Diagnostics());
    const read: string[] = [];
    while (!lexer.done) {
      const ahead = lexer.peek(1);
      const here = lexer.next();
      read.push(here.text);
      if (!lexer.done) expect(lexer.peek().text, `after ${here.text}`).toBe(ahead.text);
    }
    expect(read).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  });

  it('reads on correctly across the point the buffer empties and is reset', () => {
    // The boundary the cursor has to get right: fill it, drain it
    // exactly, then ask for more.
    const lexer = new Lexer(source(), new Diagnostics());
    expect(lexer.peek(3).text).toBe('d');
    expect([lexer.next(), lexer.next(), lexer.next(), lexer.next()].map((t) => t.text)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
    expect(lexer.peek().text).toBe('e');
    expect(lexer.peek(2).text).toBe('g');
    expect(lexer.next().text).toBe('e');
  });

  it('reads on correctly when the buffer is drained only part way', () => {
    const lexer = new Lexer(source(), new Diagnostics());
    lexer.peek(7);
    expect([lexer.next(), lexer.next()].map((t) => t.text)).toEqual(['a', 'b']);
    lexer.peek(5);
    expect(lexer.next().text).toBe('c');
    expect(lexer.peek(4).text).toBe('h');
  });

  it('keeps a token’s own answers whichever way it was reached', () => {
    // A cursor read from the wrong index would be subtle everywhere, so
    // the span and `afterRefusal` are checked against a straight read.
    const straight = new Lexer(new SourceFile('k.sprout', 'a % b c'), new Diagnostics());
    const peeked = new Lexer(new SourceFile('k.sprout', 'a % b c'), new Diagnostics());
    peeked.peek(2);
    for (let i = 0; i < 3; i++) {
      const one = straight.next();
      const other = peeked.next();
      expect(other.text, `token ${i}`).toBe(one.text);
      expect(other.afterRefusal, `token ${i} afterRefusal`).toBe(one.afterRefusal);
      expect(locationOf(other.at), `token ${i} at`).toBe(locationOf(one.at));
    }
  });

  it('reads a long lookahead back without paying for it twice', () => {
    // Not a timing assertion — the test timeout is the guard, the same
    // way it is in `parse.spec.ts`. The size is chosen so that it
    // actually bites: draining this buffer by `shift()` takes about
    // nineteen seconds against a default timeout of five, where the
    // cursor takes well under one. A count of fifty thousand does not
    // bite, since `shift()` drains that in a fifth of a second. Do not
    // lower the count, and do not raise the timeout.
    const count = 400_000;
    const lexer = new Lexer(new SourceFile('k.sprout', 'a '.repeat(count)), new Diagnostics());
    lexer.peek(count - 1);
    let read = 0;
    while (!lexer.done) {
      lexer.next();
      read += 1;
    }
    expect(read).toBe(count);
  });
});

describe("a passage's body is one token, holding its words whole", () => {
  /** The one passage body in a scrap of source. */
  const bodyOf = (text: string) => read(text).tokens.find((t) => t.kind === 'passage-body');

  it('holds everything between its braces as written, and spans the braces', () => {
    const text = 'passage greeting {\n  Hello, {actor}.\n}\n:a 1';
    const { tokens, diagnostics } = read(text);
    expect(diagnostics.all).toEqual([]);
    expect(tokens.map((t) => t.kind)).toEqual([
      'name',
      'name',
      'passage-body',
      'symbol',
      'integer',
      'end',
    ]);
    expect(tokens[2]!.text).toBe('\n  Hello, {actor}.\n');
    expect(textOf(tokens[2]!.at)).toBe('{\n  Hello, {actor}.\n}');
    expect(locationOf(tokens[2]!.at)).toBe('kiln.sprout:1:18');
  });

  it('reads prose as prose: no character in it is refused, and nothing in it is a comment', () => {
    const words = `It's late. Who's there? 50% of it // is here /* and this */ too; ~ @ # & |`;
    const { diagnostics } = read(`passage greeting { ${words} }`);
    expect(diagnostics.all).toEqual([]);
    expect(bodyOf(`passage greeting { ${words} }`)!.text).toBe(` ${words} `);
  });

  it('opens after a name, after `default`, and after up to three words on the header’s line', () => {
    for (const header of [
      'passage',
      'passage greeting',
      'passage greeting default',
      'passage Greeting',
      'passage "greeting"',
      'passage :greeting',
      'passage default greeting',
      'passage greeting default please',
      'passage greeting\n',
    ]) {
      expect(bodyOf(`${header} { Hi. }`)?.text, header).toBe(' Hi. ');
    }
  });

  it('does not open where the header runs on, onto another line, or past a mark', () => {
    for (const text of [
      'passage greeting default please now { Hi. }',
      'passage greeting\n  contains { Hi. }',
      'passage\n  greeting { Hi. }',
      'passage greeting. { Hi. }',
      'passage greeting } { Hi. }',
      'greeting { Hi. }',
    ]) {
      expect(bodyOf(text), text).toBeUndefined();
    }
  });

  it('counts the braces of its slots, so a slot never closes it', () => {
    expect(bodyOf('passage p { {if a}{thing}{/if} } :x')!.text).toBe(' {if a}{thing}{/if} ');
  });

  it('counts no brace written `\\{`, and no brace inside quoted text in a slot', () => {
    expect(bodyOf('passage p { a \\{ b } :x')!.text).toBe(' a \\{ b ');
    expect(bodyOf('passage p { {say("}")} } :x')!.text).toBe(' {say("}")} ');
    expect(bodyOf('passage p { {say("{", "\\"}")} } :x')!.text).toBe(' {say("{", "\\"}")} ');
  });

  it('reads a quote in its prose as a character, and a quote in a slot as ending at its line', () => {
    expect(bodyOf('passage p { She said "no}" }')!.text).toBe(' She said "no');
    expect(bodyOf('passage p { {a("x\n} b } :x')!.text).toBe(' {a("x\n} b ');
  });

  it('takes the four escapes quoted text takes, and keeps them as written', () => {
    const { tokens, diagnostics } = read('passage p { \\" \\\\ \\n \\{ }');
    expect(diagnostics.all).toEqual([]);
    expect(tokens[2]!.text).toBe(' \\" \\\\ \\n \\{ ');
  });

  it('refuses any other escape at its backslash, naming the four, and reads on', () => {
    const { tokens, diagnostics } = read('passage p { C:\\attic \\} }\n:x 1');
    expect(diagnostics.refusals.map((d) => [locationOf(d.at), d.message, d.remedy])).toEqual([
      [
        'kiln.sprout:1:15',
        'A backslash inside a passage means one of \\" , \\\\ , \\n or \\{.',
        'Write \\\\ if you meant a backslash of its own.',
      ],
      [
        'kiln.sprout:1:22',
        'A backslash inside a passage means one of \\" , \\\\ , \\n or \\{.',
        'Write \\\\ if you meant a backslash of its own.',
      ],
    ]);
    // A `\}` meant as a brace closes nothing.
    expect(tokens.map((t) => t.kind)).toEqual([
      'name',
      'name',
      'passage-body',
      'symbol',
      'integer',
      'end',
    ]);
  });

  it('refuses a backslash at the end of a line on its own, and leaves the line break', () => {
    const { tokens, diagnostics } = read('passage p { a\\\n}');
    expect(diagnostics.refusals.map((d) => textOf(d.at))).toEqual(['\\']);
    expect(tokens[2]!.text).toBe(' a\\\n');
  });

  it('refuses a body never closed once, at its opening, naming the passage', () => {
    const { tokens, diagnostics } = read(':a 1\npassage greeting {\n  Hello, {actor.\n}\n:b 2');
    expect(diagnostics.refusals.map((d) => [locationOf(d.at), d.message, d.remedy])).toEqual([
      [
        'kiln.sprout:2:18',
        'The passage `greeting` opens here and is never closed.',
        'Add a } where its words end. Every { inside a passage opens a slot that needs its own }; write \\{ for a brace that is only a character.',
      ],
    ]);
    expect(tokens.map((t) => t.kind)).toEqual([
      'symbol',
      'integer',
      'name',
      'name',
      'passage-body',
      'end',
    ]);
    expect(tokens.at(-1)!.afterRefusal).toBe(true);
    expect(read('passage { a {b').diagnostics.refusals[0]!.message).toBe(
      'This passage opens here and is never closed.',
    );
  });

  it('says whether something never closed took the rest of the file', () => {
    for (const [text, swallowed] of [
      ['passage p { {', true],
      ['/* a', true],
      ['passage p { a } "b', false],
      ['%', false],
    ] as const) {
      const lexer = new Lexer(new SourceFile('k.sprout', text), new Diagnostics());
      while (!lexer.done) lexer.next();
      expect(lexer.swallowedRest, text).toBe(swallowed);
    }
  });

  it('reads the same whether the body was peeked past first or not', () => {
    const text = "kind K { passage p { It's {a}. } :x 1 }";
    const peeked = new Lexer(new SourceFile('k.sprout', text), new Diagnostics());
    peeked.peek(8);
    const pulled: string[] = [];
    while (!peeked.done) pulled.push(`${peeked.next().kind}:${peeked.peek().at.start}`);
    const straight = new Lexer(new SourceFile('k.sprout', text), new Diagnostics());
    const again: string[] = [];
    while (!straight.done) again.push(`${straight.next().kind}:${straight.peek().at.start}`);
    expect(pulled).toEqual(again);
  });

  it('over generated bodies: one token holding exactly what was written, and nothing refused', () => {
    // Prose that code would refuse or misread, slots whose braces nest
    // and hold quoted braces, and every escape; whatever the mix, the body
    // is one token, its text is what was generated, and the tokens after
    // it are the ones written after it.
    const c = chooser(20_260_923);
    const PROSE = [
      "It's",
      'late?',
      '50%',
      '// no comment',
      '/* nor this',
      '*/',
      '"quoted"',
      ';',
      '~',
      'and',
      '\n',
      '\n\n',
      '  ',
    ];
    const ESCAPED = ['\\"', '\\\\', '\\n', '\\{'];
    const slot = (depth: number): string => {
      const inner = Array.from({ length: c.below(3) }, () =>
        depth > 0 && c.below(3) === 0
          ? slot(depth - 1)
          : c.one(['if x', 'thing', ' "}{" ', '"\\"}"', ':a', '$last', ...ESCAPED]),
      );
      return `{${inner.join('')}}`;
    };
    for (let i = 0; i < 500; i++) {
      const words = Array.from({ length: c.below(12) }, () => {
        const roll = c.below(4);
        return roll === 0 ? slot(2) : roll === 1 ? c.one(ESCAPED) : c.one(PROSE);
      }).join(c.one([' ', '']));
      const header = c.one(['passage p', 'passage p default', 'passage\tp']);
      const text = `:a 1\n${header} {${words}}\n:b 2`;
      const { tokens, diagnostics } = read(text);
      expect(diagnostics.all, text).toEqual([]);
      const body = tokens.filter((t) => t.kind === 'passage-body');
      expect(
        body.map((t) => t.text),
        text,
      ).toEqual([words]);
      expect(
        tokens.slice(-3).map((t) => t.text),
        text,
      ).toEqual(['b', '2', '']);
    }
  });
});

describe('a window of a file, as a slot of prose is read', () => {
  it('reads only its stretch, at the file’s own offsets, `$` names among its names', () => {
    const source = new SourceFile('lines.prose', 'Before {$index == self.count} after.');
    const diagnostics = new Diagnostics();
    const lexer = new Lexer(source, diagnostics, { start: 8, end: 28 });
    const tokens: Token[] = [];
    for (let token = lexer.next(); token.kind !== 'end'; token = lexer.next()) tokens.push(token);
    expect(diagnostics.all).toEqual([]);
    expect(tokens.map((t) => `${t.kind}:${t.text}`)).toEqual([
      'name:$index',
      'punct:==',
      'name:self',
      'punct:.',
      'name:count',
    ]);
    expect(tokens.map((t) => textOf(t.at))).toEqual(['$index', '==', 'self', '.', 'count']);
  });

  it('refuses a `$` in source, where no loop binds one', () => {
    const { diagnostics } = read('$index');
    expect(diagnostics.refusals.map((d) => d.message)).toEqual([
      'Sprout does not use the character "$".',
    ]);
  });
});
