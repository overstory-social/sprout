import { describe, expect, it } from 'vitest';

import { writtenPath, type KindDeclaration } from '../ast.js';
import type { GrammarDeclaration, GrammarLine } from '../ast-grammar.js';
import { unspanned } from '../../source/nodes.js';
import { locationOf } from '../../source/source.js';
import { chooser, read } from '../../fixtures/parse.js';
import { inKindBody, readWith, rest } from '../../fixtures/readers.js';
import { grammar } from './grammar.js';

/**
 * The grammar block `members` starts with, read by `grammar` in the body
 * of `kind Case`, what it left for the body's next member, and what was said.
 */
function readGrammar(members: string) {
  const { p, diagnostics, startsMember } = inKindBody(members, 'Case');
  const block = grammar(p, startsMember);
  return {
    blocks: block === null ? [] : [block],
    rest: rest(p),
    said: diagnostics.refusals.map((d) => [locationOf(d.at), d.message, d.remedy]),
  };
}

/** The members of `kind Case`, its body read whole, and what was said. */
function readKind(members: string) {
  const { declarations, refusals } = read(`kind Case {\n  ${members}\n}\n`, 'k.sprout');
  const kind = declarations.find((d): d is KindDeclaration => d.kind === 'kind');
  const members_ = kind?.members ?? [];
  return {
    members: members_,
    blocks: members_.filter((m): m is GrammarDeclaration => m.kind === 'grammar'),
    said: refusals.map((d) => [locationOf(d.at), d.message, d.remedy]),
    messages: refusals.map((d) => d.message),
  };
}

/** A line as a case compares it. */
const written = (line: GrammarLine): string => {
  switch (line.kind) {
    case 'grammar-name':
      return `name ${line.text}`;
    case 'grammar-article':
      return `article ${line.article}`;
    case 'grammar-nouns':
      return `nouns ${line.nouns.map((noun) => noun.text).join('|')}`;
    case 'grammar-exit':
      return `exit ${line.direction.text} ${line.label.text} ${writtenPath(line.destination)}${line.when === null ? '' : ' when'}`;
    case 'grammar-link':
      return `link ${line.name.text} ${line.label.text}`;
  }
};

describe('a grammar block', () => {
  it('reads its three lines in any order, on one line or several', () => {
    for (const text of [
      'grammar { name "brass key"  article a  nouns "brass" "key ring" }',
      'grammar {\n    nouns "brass" "key ring"\n    article a\n    name "brass key"\n  }',
    ]) {
      const { blocks, said } = readGrammar(text);
      expect(said, text).toEqual([]);
      expect(unspanned(blocks)).toEqual([]);
      expect(blocks[0]!.lines.map(written).sort()).toEqual([
        'article a',
        'name brass key',
        'nouns brass|key ring',
      ]);
    }
  });

  it('reads nouns with a comma between them or not, as the worked microworld writes them', () => {
    for (const text of [
      'grammar { name "type cabinet" article the nouns "cabinet", "type" }',
      'grammar { nouns "cabinet" "type"  name "type cabinet"  article the }',
    ]) {
      const { blocks, said } = readGrammar(text);
      expect(said, text).toEqual([]);
      expect(blocks[0]!.lines.map(written).sort(), text).toEqual([
        'article the',
        'name type cabinet',
        'nouns cabinet|type',
      ]);
    }
  });

  it('refuses a comma after the last noun, as a line the block is not made of', () => {
    const { blocks, said } = readGrammar('grammar { nouns "cabinet", name "type cabinet" }');
    expect(said.map((one) => one[1])).toEqual(['A grammar block is not made of `,`.']);
    expect(blocks[0]!.lines.map(written)).toEqual(['nouns cabinet', 'name type cabinet']);
  });

  it('reads every article a grammar block may declare', () => {
    for (const article of ['a', 'an', 'the', 'none']) {
      const { blocks, said } = readGrammar(`grammar { article ${article} }`);
      expect(said).toEqual([]);
      expect(blocks[0]!.lines.map(written)).toEqual([`article ${article}`]);
    }
  });

  it('is read by `grammar` directly, spanning its word to its brace', () => {
    const text = 'grammar { name "lamp" }';
    const { read: made, refusals } = readWith((p) => grammar(p, () => false), text, {
      readers: new Map(),
    });
    expect(refusals).toEqual([]);
    expect([made?.at.start, made?.at.end]).toEqual([0, text.length]);
  });

  it('holds an empty block, which says nothing', () => {
    expect(readGrammar('grammar { }').blocks[0]!.lines).toEqual([]);
  });

  it('refuses a block with no braces, keeping the body after it', () => {
    const { said, blocks, rest } = readGrammar('grammar\n  :lit false');
    expect(said).toEqual([
      [
        'k.sprout:3:3',
        'A grammar block holds its lines in braces.',
        'Write `grammar { name "brass key"  article a  nouns "brass" }`.',
      ],
    ]);
    expect(blocks).toEqual([]);
    expect(rest).toBe(':lit false\n}\n');
  });

  it('refuses a name without its quotes, offering them', () => {
    expect(readGrammar('grammar { name brass_key }').said).toEqual([
      [
        'k.sprout:2:18',
        '`name` is followed by the name in quotes.',
        'Write `name "brass key"`, in quotes.',
      ],
    ]);
  });

  it('refuses an article it does not know, and nouns with none in quotes', () => {
    expect(readGrammar('grammar { article teh  nouns }').said).toEqual([
      [
        'k.sprout:2:21',
        '`article` is followed by `a`, `an`, `the` or `none`.',
        'Write `article the` for a thing there is one of, or `article none` for a proper name.',
      ],
      [
        'k.sprout:2:32',
        '`nouns` is followed by one or more nouns in quotes.',
        'Write `nouns "brass" "key ring"`.',
      ],
    ]);
  });

  it('refuses a line it does not read once, stepping over the rest of it', () => {
    const { said, blocks } = readGrammar(
      'grammar {\n    door north "to the yard" -> hall\n    name "lamp"\n  }',
    );
    expect(said).toEqual([
      [
        'k.sprout:3:5',
        'A grammar block is not made of `door`.',
        'It holds `name`, `article`, `nouns`, `exit` and `link`, as in `grammar { name "brass key"  article a  nouns "brass" }`.',
      ],
    ]);
    expect(blocks[0]!.lines.map(written)).toEqual(['name lamp']);
  });

  it('reads exits and links among its lines, in the order written', () => {
    const { blocks, said } = readGrammar(
      'grammar {\n    exit north "deeper" -> hall when (!self.get(:lit))\n    link back "back"\n    exit up "up" -> kiln.loft\n  }',
    );
    expect(said).toEqual([]);
    expect(blocks[0]!.lines.map(written)).toEqual([
      'exit north deeper hall when',
      'link back back',
      'exit up up kiln.loft',
    ]);
  });

  it('ends a block never closed where the body’s next member starts', () => {
    const { said, blocks, rest } = readGrammar('grammar { name "lamp"\n  :lit false');
    expect(said[0]).toEqual([
      'k.sprout:3:3',
      'This grammar block is never closed.',
      'Add a } after its last line.',
    ]);
    expect(blocks[0]!.lines.map(written)).toEqual(['name lamp']);
    expect(rest).toBe(':lit false\n}\n');
  });
});

// --- the recovery invariant ------------------------------------------------

const WELL_FORMED_LINES = [
  { name: 'name brass key', text: 'name "brass key"' },
  { name: 'article the', text: 'article the' },
  { name: 'nouns brass|key ring', text: 'nouns "brass" "key ring"' },
  { name: 'nouns cabinet|type', text: 'nouns "cabinet", "type"' },
  { name: 'exit out to the yard yard', text: 'exit out "to the yard" -> yard' },
  {
    name: 'exit up the loft kiln.loft when',
    text: 'exit up "the loft" -> kiln.loft when (ladder.get(:down))',
  },
  { name: 'link onward deeper', text: 'link onward "deeper"' },
] as const;

/**
 * A line with one defect in it, each costing that line at most. Text in
 * quotes on its own is not one: after `nouns` it is another noun.
 */
const LINE_DEFECTS: readonly string[] = [
  'name',
  'name brass',
  'name 4',
  'article',
  'article teh',
  'article The',
  'article 4',
  'nouns',
  'nouns 4',
  'nouns "brass",',
  'nouns , "brass"',
  'exit',
  'exit North "x" -> hall',
  'exit "to the yard" -> hall',
  'exit north',
  'exit north -> hall',
  'exit north "x" hall',
  'exit north "x" ->',
  'exit north "x" -> when (true)',
  'exit north "x" -> hall when',
  'exit north "x" -> hall when ()',
  'exit north "x" -> hall when (self.get(:lit)',
  'exit north "x" -> hall when (self.get(:lit) +)',
  'link',
  'link Onward "x"',
  'link "x"',
  'link onward',
  'link onward deeper',
  'link onward "x" -> hall',
  'faulty',
  '4',
  'Faulty',
  '[faulty]',
];

describe('a defect in one line never loses a well-formed neighbour in silence (generated)', () => {
  it('keeps every line written well, around one written badly, and says something', () => {
    const c = chooser(27);
    for (let run = 0; run < 300; run++) {
      const good = c.shuffled(WELL_FORMED_LINES).slice(0, 1 + c.below(4));
      const defect = c.one(LINE_DEFECTS);
      const at = c.below(good.length + 1);
      const lines: string[] = good.map((line) => line.text);
      lines.splice(at, 0, defect);
      const between = c.below(2) === 0 ? '  ' : '\n    ';
      const text = `grammar {${between}${lines.join(between)}${between}}\n  :after false`;
      const { blocks, members, messages } = readKind(text);
      expect(messages.length, text).toBeGreaterThan(0);
      const kept = blocks.flatMap((block) => block.lines.map(written));
      for (const line of good) expect(kept, text).toContain(line.name);
      // The body's next member is its own, not the block's.
      expect(
        members.some((m) => m.kind === 'property' && m.name.text === 'after'),
        text,
      ).toBe(true);
    }
  });

  it('keeps the body’s other members around a block written badly', () => {
    const c = chooser(54);
    for (let run = 0; run < 100; run++) {
      const defect = c.one([
        `grammar { ${c.one(LINE_DEFECTS)} }`,
        'grammar',
        `grammar { ${c.one(LINE_DEFECTS)}`,
        'grammar name "lamp"',
      ]);
      const text = `:before true\n  ${defect}\n  :after false\n  contains`;
      const { members, messages } = readKind(text);
      expect(messages.length, text).toBeGreaterThan(0);
      const names = members.map((m) => (m.kind === 'property' ? m.name.text : m.kind));
      for (const name of ['before', 'after', 'contains']) expect(names, text).toContain(name);
    }
  });
});
