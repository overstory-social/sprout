import { describe, expect, it } from 'vitest';

import { writtenPath, type KindDeclaration } from '../ast.js';
import type { GrammarDeclaration, GrammarExit, GrammarLink } from '../ast-grammar.js';
import { Diagnostics } from '../../source/diagnostics.js';
import { unspanned } from '../../source/nodes.js';
import { locationOf, SourceFile, textOf } from '../../source/source.js';
import { chooser, read, shape } from '../../fixtures/parse.js';
import { exitLine, linkLine } from './exits.js';
import { Parser } from './parser.js';

/** The ways out of the one grammar block in `kind Cell`, and what reading them said. */
function readWays(lines: string) {
  const { declarations, refusals } = read(
    `kind Cell {\n  grammar {\n    ${lines}\n  }\n}\n`,
    'c.sprout',
  );
  const kind = declarations.find((d): d is KindDeclaration => d.kind === 'kind');
  const block = kind?.members.find((m): m is GrammarDeclaration => m.kind === 'grammar');
  return {
    lines: block?.lines ?? [],
    said: refusals.map((d) => [locationOf(d.at), d.message, d.remedy]),
  };
}

/** An exit or a link written back. */
const written = (line: GrammarExit | GrammarLink): string =>
  line.kind === 'grammar-link'
    ? `link ${line.name.text} "${line.label.text}"`
    : `exit ${line.direction.text} "${line.label.text}" -> ${writtenPath(line.destination)}${line.when === null ? '' : ` when (${shape(line.when)})`}`;

const ways = (lines: readonly unknown[]) =>
  (lines as (GrammarExit | GrammarLink)[]).filter(
    (line) => line.kind === 'grammar-exit' || line.kind === 'grammar-link',
  );

describe('an exit line and a link line', () => {
  it('read the spec’s own, a path and a guard included, spanning their words', () => {
    const text = [
      'exit out "back to the yard" -> yard',
      'exit north "deeper into the dark" -> maze_hall when (!self.get(:lamp_lit))',
      'exit down "down the ladder" -> composing_room.paper_store',
      'link onward "deeper into the dark"',
      'link back_2 "the way you came"',
    ];
    const { lines, said } = readWays(text.join('\n    '));
    expect(said).toEqual([]);
    expect(unspanned(lines)).toEqual([]);
    expect(ways(lines).map((line) => textOf(line.at))).toEqual(text);
    expect(ways(lines).map(written)[1]).toMatch(
      /^exit north "deeper into the dark" -> maze_hall when \(/,
    );
  });

  it('are read by their own readers, one after the other', () => {
    const diagnostics = new Diagnostics();
    const p = new Parser(
      new SourceFile('c.sprout', 'exit in "in" -> hall link out "out"'),
      diagnostics,
      new Map(),
    );
    const atLineEnd = (at: Parser) => at.done || at.at('name', 'link');
    const exit = exitLine(p, { atLineEnd });
    const link = linkLine(p, { atLineEnd });
    expect(diagnostics.refusals).toEqual([]);
    expect([exit?.kind, link?.kind]).toEqual(['grammar-exit', 'grammar-link']);
  });

  it('refuse a line with no direction, no label, no arrow or no destination, each once', () => {
    expect(readWays('exit "to the yard" -> yard').said).toEqual([
      [
        'c.sprout:3:10',
        '`exit` is followed by the direction it leads in, then its label in quotes.',
        'Write `exit north "out to the yard" -> yard`.',
      ],
    ]);
    expect(readWays('exit North "x" -> yard').said[0]!.slice(1)).toEqual([
      '`North` starts with a capital, and a direction is written in lower case.',
      'Write `exit north …`, as in `exit north "out to the yard" -> yard`.',
    ]);
    expect(readWays('exit north -> yard').said).toEqual([
      [
        'c.sprout:3:16',
        '`exit north` is followed by its label in quotes: what a visitor reads, and may type, for the way out.',
        'Write the label after the direction, as in `exit north "out to the yard" -> yard`.',
      ],
    ]);
    expect(readWays('exit north "x" yard').said).toEqual([
      [
        'c.sprout:3:20',
        'An exit says where it leads after its label, with `->`.',
        'Write `exit north "x" -> yard`, naming the place it leads to.',
      ],
    ]);
    expect(readWays('exit north "x" ->\n    name "cell"').said).toEqual([
      [
        'c.sprout:3:22',
        'After `->` comes the place the exit leads to.',
        'Name it in lower case, as in `exit north "x" -> yard`, or by its path, as in `-> bedroom.wardrobe`.',
      ],
    ]);
  });

  it('refuse a `when` with no condition, an empty one, or one never closed', () => {
    expect(readWays('exit up "up" -> loft when').said[0]!.slice(1)).toEqual([
      "An exit's `when` is followed by its condition in brackets.",
      'Write `exit up "up" -> loft when (self.get(:open))`.',
    ]);
    expect(readWays('exit up "up" -> loft when ()').said[0]!.slice(1)).toEqual([
      "This exit's `when` says nothing inside its brackets.",
      'Write the condition it applies under, as in `exit up "up" -> loft when (self.get(:open))`, or leave `when` out.',
    ]);
    expect(readWays('exit up "up" -> loft when (self.get(:open)').said[0]!.slice(1)).toEqual([
      "The condition of this exit's `when` ends here, and its bracket is never closed.",
      'Add a ) after the condition.',
    ]);
  });

  it('read a link’s name as written, a word of the author’s, leaving what it may be to the tier after', () => {
    const { lines, said } = readWays('link onward "on"\n    link north "on"');
    expect(said).toEqual([]);
    expect(ways(lines).map((line) => (line.kind === 'grammar-link' ? line.name.text : ''))).toEqual(
      ['onward', 'north'],
    );
  });

  it('refuse a link with no name, a capitalised one, or no label, each once', () => {
    expect(readWays('link "the way on"').said).toEqual([
      [
        'c.sprout:3:10',
        '`link` is followed by its name, a word of your own, then its label in quotes.',
        'Write `link onward "deeper into the dark"`.',
      ],
    ]);
    expect(readWays('link Onward "on"').said).toEqual([
      [
        'c.sprout:3:10',
        "`Onward` starts with a capital, and a link's name is written in lower case.",
        'Write `link onward …`, as in `link onward "deeper into the dark"`.',
      ],
    ]);
    expect(readWays('link back\n    name "cell"').said).toEqual([
      [
        'c.sprout:3:14',
        '`link back` is followed by its label in quotes: what a visitor reads, and may type, for the way out.',
        'Write the label after the name, as in `link back "deeper into the dark"`.',
      ],
    ]);
  });

  it('refuse a link that names a place, since the world connects it', () => {
    expect(readWays('link onward "on" -> cell').said).toEqual([
      [
        'c.sprout:3:22',
        'A link leads nowhere until the world connects it, so it names no place.',
        'Write `link onward "on"`, and `connect onward to …` where the place is made; or write an `exit` for a place written in source.',
      ],
    ]);
  });
});

// --- generated input -------------------------------------------------------
//
// The line readers' share of the parser's recovery rule: a well-formed
// exit or link is read whole and in silence, and one with any single
// token taken out is refused, never thrown, and never costs the line after it.

const WELL_FORMED = [
  'exit out "back to the yard" -> yard',
  'exit north "deeper" -> maze when (!self.get(:lit))',
  'exit up "the loft" -> shop.loft when (ladder.get(:down) && true)',
  'link back "the way you came"',
];

describe('an exit or a link never vanishes silently, and never takes the line after it', () => {
  it('over generated lines, whole and with any one token taken out', () => {
    const c = chooser(20_260_924);
    for (let run = 0; run < 200; run++) {
      const line = c.one(WELL_FORMED);
      const whole = readWays(`${line}\n    name "cell"`);
      expect(whole.said, line).toEqual([]);
      const tokens = [...line.matchAll(/"[^"]*"|->|[()!.:]|&&|\w+/g)];
      const dropped = tokens[c.below(tokens.length)]!;
      const gap = `${line.slice(0, dropped.index)}${line.slice(dropped.index + dropped[0].length)}`;
      let readGap: ReturnType<typeof readWays> | undefined;
      expect(() => {
        readGap = readWays(`${gap}\n    name "cell"`);
      }, gap).not.toThrow();
      expect(
        readGap!.lines.some((one) => one.kind === 'grammar-name' && one.text === 'cell'),
        gap,
      ).toBe(true);
      // Some tokens leave a shorter line that still reads, a path's step or
      // a guard's operand; any other gap is said.
      const kept = ways(readGap!.lines);
      expect(readGap!.said.length > 0 || kept.length === 1, gap).toBe(true);
      expect(kept.length, gap).toBeLessThanOrEqual(1);
    }
  });
});
