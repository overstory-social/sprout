import { describe, expect, it } from 'vitest';

import type { EachStatement } from '../ast.js';
import { Diagnostics } from '../../source/diagnostics.js';
import { locationOf, SourceFile, textOf } from '../../source/source.js';
import { chooser, shape } from '../../fixtures/parse.js';
import { readWith } from '../../fixtures/readers.js';
import { Lexer } from '../lexer.js';
import { block, onItsOwn } from './statements.js';
import { eachStatement } from './each.js';

/** `text` read as an `each`, and what was refused, where and in what words. */
function readEach(text: string) {
  const { read, refusals } = readWith((p) => eachStatement(p), text, { name: 'body.sprout' });
  return {
    each: read,
    said: refusals.map((d) => [locationOf(d.at), d.message, d.remedy]),
  };
}

/** An `each` as written, in brief: its variable, filter, word, what it walks and its body's statement kinds. */
function written(each: EachStatement): string {
  const filter = each.filter === null ? '' : `: ${each.filter.name.text}`;
  const body = each.body.statements.map((s) => s.kind).join(',');
  return `each ${each.variable.text}${filter} ${each.walks} ${shape(each.over)} {${body}}`;
}

describe('`each` walks contents, those of a kind, or a set role', () => {
  it('reads the three forms the spec writes, with the body a block', () => {
    const forms = [
      'each pot: Vessel in self { send pot :fired }',
      'each thing in cabinet { }',
      'each tool of tools { allow }',
      'each p: Creature in composing_room {\n  if (p != self) { act nuzzle (target: p) }\n}',
      'each c: sprout.Container in here.shelf { }',
    ];
    const read = forms.map((text) => {
      const { each, said } = readEach(text);
      expect(said, text).toEqual([]);
      expect(textOf(each!.at), text).toBe(text);
      return written(each!);
    });
    expect(read).toEqual([
      'each pot: Vessel in self {send}',
      'each thing in cabinet {}',
      'each tool of tools {allow}',
      'each p: Creature in composing_room {if}',
      'each c: Container in here.shelf {}',
    ]);
  });

  it('refuses a kind on `of`, which walks a set role whole', () => {
    expect(readEach('each rib: Rib of tools { }').said).toEqual([
      [
        'body.sprout:1:11',
        'A kind picks out what a container holds, and `of` walks a set role whole.',
        'Write `each rib: Rib in <container> { … }`, or leave the kind out: `each rib of <set role> { … }`.',
      ],
    ]);
  });

  it('refuses a head it cannot read, once, saying the forms', () => {
    const forms =
      'Write `each thing in self { … }`, `each pot: Vessel in self { … }` or `each tool of tools { … }`.';
    expect(readEach('each Pot in self { }').said).toEqual([
      [
        'body.sprout:1:6',
        'The name `each` gives what it walks starts with a small letter, and `Pot` starts with a capital.',
        forms,
      ],
    ]);
    expect(readEach('each move in here { }').said).toEqual([
      [
        'body.sprout:1:6',
        '`move` is a word of the language, so it cannot name what `each` walks.',
        'Choose another word, as in `each thing in self { … }`.',
      ],
    ]);
    expect(readEach('each thing self { }').said).toEqual([
      [
        'body.sprout:1:12',
        '`each thing` is followed by `in` and a container, or `of` and a set role.',
        forms,
      ],
    ]);
    expect(readEach('each thing in { }').said).toEqual([
      ['body.sprout:1:15', '`each thing in` does not say what it walks.', forms],
    ]);
    expect(readEach('each thing in self send thing :stir').said).toEqual([
      [
        'body.sprout:1:20',
        'What `each` does goes in braces.',
        'Write `each thing in … { … }`, as in `each thing in self { send thing :stir }`.',
      ],
    ]);
  });
});

// --- generated input -------------------------------------------------------
//
// The recovery rule for `each`: written whole it reads in silence, and
// with any one token taken out it is refused exactly once, never passed
// and never thrown; and, unless the token was one of the body's braces,
// the statement after it in its block is kept.

const VARIABLES = ['thing', 'pot', 'p'];
const FILTERS = ['', ': Vessel', ': Creature'];
const OVERS = ['self', 'here', 'cabinet', 'kiln.shelf'];
const BODIES = ['', 'allow', 'send pot :fired', 'let n = 1'];

function tokensOf(text: string): { start: number; end: number }[] {
  const lexer = new Lexer(new SourceFile('g.sprout', text), new Diagnostics());
  const out: { start: number; end: number }[] = [];
  for (let token = lexer.next(); token.kind !== 'end'; token = lexer.next()) {
    out.push({ start: token.at.start, end: token.at.end });
  }
  return out;
}

describe('an `each` never vanishes silently (generated)', () => {
  it('is read whole, and refused once with any one token taken out, keeping the next statement', () => {
    const c = chooser(49);
    for (let run = 0; run < 200; run++) {
      const filter = c.one(FILTERS);
      const walks = filter === '' && c.below(3) === 0 ? 'of tools' : `in ${c.one(OVERS)}`;
      const made = `each ${c.one(VARIABLES)}${filter} ${walks} { ${c.one(BODIES)} }`;
      expect(readEach(made).said, made).toEqual([]);
      for (const dropped of tokensOf(made)) {
        const before = made.slice(0, dropped.start);
        const after = made.slice(dropped.end);
        const word = made.slice(dropped.start, dropped.end);
        const joins = /\w$/.test(before) && /^\w/.test(after);
        const text = `{ ${before}${joins ? ' ' : ''}${after}\n  allow\n}`;
        const { read, refusals } = readWith((p) => block(p, onItsOwn()), text);
        const said = refusals.map((d) => d.message);
        // Taking out a body's only statement leaves an `each` that does nothing.
        if (
          said.length === 0 &&
          BODIES.some((one) => one !== '' && one.split(' ').includes(word))
        ) {
          continue;
        }
        expect(said.length, `${JSON.stringify(text)}: ${said.join(' | ')}`).toBeGreaterThan(0);
        expect(said, text).toHaveLength(1);
        // A brace taken out pairs the body's other brace with the block's own.
        if (word === '{' || word === '}') continue;
        expect(read?.statements.at(-1)?.kind, text).toBe('allow');
      }
    }
  });
});
