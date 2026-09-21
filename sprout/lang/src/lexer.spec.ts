import { describe, expect, it } from 'vitest';

import { Diagnostics } from './diagnostics.js';
import { Lexer, tokenise, type Token } from './lexer.js';
import { unspanned } from './nodes.js';
import { locationOf, SourceFile, textOf } from './source.js';

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
    expect(shapes('kind Creature: sprout.Actor').slice(0, 3)).toEqual([
      'name:kind',
      'kind:Creature',
      'punct::',
    ]);
  });

  it('reads an integer unsigned, leaving the sign to the parser', () => {
    expect(shapes('-40')).toEqual(['punct:-', 'integer:40']);
  });

  it('reads text as what it says, not as it is written', () => {
    expect(shapes('"work [target] with [tools]"')).toEqual(['string:work [target] with [tools]']);
  });

  it('knows the three escapes text has', () => {
    expect(read('"a \\"b\\" \\\\ c\\nd"').tokens[0]!.text).toBe('a "b" \\ c\nd');
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
    ['object paper_store: sprout.Place {', '  :open  false', '  :ward  iron', '}', ''].join('\n'),
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

describe('the lexer is pulled, so the parser can change how the next thing is read', () => {
  const source = new SourceFile('kiln.sprout', 'passage immovable { chained }');

  it('peeks without consuming, at any distance', () => {
    const lexer = new Lexer(source, new Diagnostics());
    expect(lexer.peek().text).toBe('passage');
    expect(lexer.peek(2).text).toBe('{');
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
    'world printers_shop {',
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

  it('reads the world head as its four tokens', () => {
    expect(tokens.slice(0, 3).map((t) => `${t.kind}:${t.text}`)).toEqual([
      'name:world',
      'name:printers_shop',
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
