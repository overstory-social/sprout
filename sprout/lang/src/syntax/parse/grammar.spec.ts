import { describe, expect, it } from 'vitest';

import { writtenPath, type KindDeclaration, type KindMember } from '../ast.js';
import type { GrammarDeclaration, GrammarLine } from '../ast-grammar.js';
import { unspanned } from '../../source/nodes.js';
import { Diagnostics } from '../../source/diagnostics.js';
import { locationOf, SourceFile } from '../../source/source.js';
import { chooser, read } from '../../fixtures/parse.js';
import { grammar } from './grammar.js';
import { Parser } from './parser.js';

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
      const { blocks, said } = readKind(text);
      expect(said, text).toEqual([]);
      expect(unspanned(blocks)).toEqual([]);
      expect(blocks[0]!.lines.map(written).sort()).toEqual([
        'article a',
        'name brass key',
        'nouns brass|key ring',
      ]);
    }
  });

  it('reads every article a grammar block may declare', () => {
    for (const article of ['a', 'an', 'the', 'none']) {
      const { blocks, said } = readKind(`grammar { article ${article} }`);
      expect(said).toEqual([]);
      expect(blocks[0]!.lines.map(written)).toEqual([`article ${article}`]);
    }
  });

  it('is read by `grammar` directly, spanning its word to its brace', () => {
    const diagnostics = new Diagnostics();
    const text = 'grammar { name "lamp" }';
    const p = new Parser(new SourceFile('k.sprout', text), diagnostics, new Map());
    const made = grammar(p, () => false);
    expect(diagnostics.refusals).toEqual([]);
    expect([made?.at.start, made?.at.end]).toEqual([0, text.length]);
  });

  it('holds an empty block, which says nothing', () => {
    expect(readKind('grammar { }').blocks[0]!.lines).toEqual([]);
  });

  it('refuses a block with no braces, keeping the body after it', () => {
    const { said, members } = readKind('grammar\n  :lit false');
    expect(said).toEqual([
      [
        'k.sprout:3:3',
        'A grammar block holds its lines in braces.',
        'Write `grammar { name "brass key"  article a  nouns "brass" }`.',
      ],
    ]);
    expect(members.map((m: KindMember) => m.kind)).toEqual(['property']);
  });

  it('refuses a name without its quotes, offering them', () => {
    expect(readKind('grammar { name brass_key }').said).toEqual([
      [
        'k.sprout:2:18',
        '`name` is followed by the name in quotes.',
        'Write `name "brass key"`, in quotes.',
      ],
    ]);
  });

  it('refuses an article it does not know, and nouns with none in quotes', () => {
    expect(readKind('grammar { article teh  nouns }').said).toEqual([
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
    const { said, blocks } = readKind(
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
    const { blocks, said } = readKind(
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
    const { said, members } = readKind('grammar { name "lamp"\n  :lit false');
    expect(said[0]).toEqual([
      'k.sprout:3:3',
      'This grammar block is never closed.',
      'Add a } after its last line.',
    ]);
    expect(members.map((m: KindMember) => m.kind)).toEqual(['grammar', 'property']);
  });
});

// --- the recovery invariant ------------------------------------------------

const WELL_FORMED_LINES = [
  { name: 'name brass key', text: 'name "brass key"' },
  { name: 'article the', text: 'article the' },
  { name: 'nouns brass|key ring', text: 'nouns "brass" "key ring"' },
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
