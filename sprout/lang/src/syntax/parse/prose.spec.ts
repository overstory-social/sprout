import { describe, expect, it } from 'vitest';

import type { Prose, ProsePiece } from '../ast-prose.js';
import { locationOf, textOf } from '../../source/source.js';
import { chooser, readProseText, shape, type Chooser } from '../../fixtures/parse.js';
import { DEEPEST } from './parser.js';

/** Prose as a string of what it holds: words, breaks, slots and blocks. */
function outline(prose: Prose): string {
  return prose.pieces.map(outlinePiece).join(' ');
}

function outlinePiece(piece: ProsePiece): string {
  switch (piece.kind) {
    case 'prose-words':
      return JSON.stringify(piece.text);
    case 'prose-paragraph':
      return '¶';
    case 'prose-newline':
      return '↵';
    case 'prose-slot':
      return `{${shape(piece.expr)}}`;
    case 'prose-for':
      return `for(${piece.variable.text} ${piece.walks} ${shape(piece.over)})[${outline(piece.body)}]`;
    case 'prose-if': {
      let text = `if(${shape(piece.condition)})[${outline(piece.then)}]`;
      for (let otherwise = piece.otherwise; otherwise !== null;) {
        if (otherwise.kind === 'prose') {
          text += ` else[${outline(otherwise)}]`;
          break;
        }
        text += ` elif(${shape(otherwise.condition)})[${outline(otherwise.then)}]`;
        otherwise = otherwise.otherwise;
      }
      return text;
    }
  }
}

const said = (text: string) =>
  readProseText(text).refusals.map((d) => [locationOf(d.at), d.message]);

describe('blocks read around what they guard, to their close', () => {
  it('reads an `{if}` chain, and an `{else}` as its last link', () => {
    const { prose, refusals } = readProseText('{if a}A{else if b}B{else}C{/if}');
    expect(refusals).toEqual([]);
    expect(outline(prose)).toBe('if(a)["A"] elif(b)["B"] else["C"]');
  });

  it('reads blocks inside blocks', () => {
    const { prose, refusals } = readProseText(
      '{for t in self}{if $last}{t}.{else}{t}, {/if}{/for}',
    );
    expect(refusals).toEqual([]);
    expect(outline(prose)).toBe('for(t in self)[if($last)[{t} "."] else[{t} ", "]]');
  });

  it('keeps the words around a block, its line breaks among them, for reflow', () => {
    const { prose } = readProseText('One\n{if a}\ntwo\n{/if}\nthree');
    expect(outline(prose)).toBe('"One\\n" if(a)["\\ntwo\\n"] "\\nthree"');
  });

  it('spans a block from its opening to its close', () => {
    const { prose } = readProseText('x {if a}y{/if} z');
    expect(textOf(prose.pieces[1]!.at)).toBe('{if a}y{/if}');
  });
});

describe('a mistake in prose is said once, where it is, and the words around it are read', () => {
  it('refuses a close no block takes, and reads on', () => {
    expect(said('a{/if}b{/for}')).toEqual([
      ['lines.prose:1:2', '`{/if}` closes no `{if}`.'],
      ['lines.prose:1:8', '`{/for}` closes no `{for}`.'],
    ]);
    expect(outline(readProseText('a{/if}b').prose)).toBe('"a" "b"');
  });

  it('refuses an `{else}` outside any `{if}`, and a second `{else}` in one', () => {
    expect(said('a{else}b')).toEqual([['lines.prose:1:2', '`{else}` belongs inside an `{if}`.']]);
    expect(said('{for t in self}{else}{/for}')).toEqual([
      ['lines.prose:1:16', '`{else}` belongs inside an `{if}`.'],
    ]);
    expect(said('{if a}A{else}B{else}C{/if}')).toEqual([
      ['lines.prose:1:15', 'An `{if}` has one `{else}`, and it comes last.'],
    ]);
  });

  it('refuses a block never closed at its opening, and ends it where its words end', () => {
    expect(said('{if a}A')).toEqual([['lines.prose:1:1', 'This `{if}` is never closed.']]);
    const { prose } = readProseText('{for t in self}{t}');
    expect(outline(prose)).toBe('for(t in self)[{t}]');
  });

  it('ends a block that a close for the block around it reaches first, and that close is its', () => {
    const { prose, refusals } = readProseText('{for t in self}{if a}{t}{/for}after');
    expect(refusals.map((d) => [locationOf(d.at), d.message])).toEqual([
      ['lines.prose:1:16', 'This `{if}` is never closed.'],
    ]);
    expect(outline(prose)).toBe('for(t in self)[if(a)[{t}]] "after"');
  });

  it('reads the block of an opening that did not read, so its close is not a stray', () => {
    expect(said('{if}A{else}B{/if}')).toEqual([['lines.prose:1:1', '`{if}` needs a condition.']]);
    expect(said('{for t self}{t}{/for}')).toEqual([
      ['lines.prose:1:1', '`{for}` needs a name, `in` or `of`, and what it walks.'],
    ]);
    expect(said('{if a}A{else when}B{/if}')).toEqual([
      ['lines.prose:1:8', '`{else}` is written alone, or as `{else if …}`.'],
    ]);
  });

  it('refuses `{one of}` once, and steps over the choice to its `{/one of}`', () => {
    const { prose, refusals } = readProseText('a {one of}b{or}{one of}c{/one of}{/one of} d');
    expect(refusals.map((d) => d.message)).toEqual([
      '`{one of}` is not something this compiler reads.',
    ]);
    expect(outline(prose)).toBe('"a " " d"');
    expect(said('a{or}b')).toEqual([
      ['lines.prose:1:2', '`{or}` is not something this compiler reads.'],
    ]);
  });

  it('refuses blocks nested past its own bound once, and steps over the rest to their close', () => {
    const deep = `${'{if a}'.repeat(DEEPEST + 3)}x${'{/if}'.repeat(DEEPEST + 3)} after`;
    const { prose, refusals } = readProseText(deep);
    expect(refusals.map((d) => d.message)).toEqual(['This is nested too deep to read.']);
    expect(prose.pieces.at(-1)).toMatchObject({ kind: 'prose-words', text: ' after' });
  });
});

// --- generated prose ---------------------------------------------------------

/** A piece of well-formed prose, with the names of the slots it holds. */
interface Generated {
  readonly text: string;
  readonly slots: string[];
}

let counter = 0;

function generate(c: Chooser, depth: number): Generated {
  const parts: Generated[] = [];
  const length = 1 + c.below(4);
  for (let i = 0; i < length; i++) {
    const choice = depth >= 3 ? c.below(3) : c.below(6);
    if (choice === 0)
      parts.push({ text: c.one(['the glass', ' and ', '\n', '\n\n', ', ']), slots: [] });
    else if (choice === 1) parts.push({ text: '\\n', slots: [] });
    else if (choice === 2) {
      const name = `w${counter++}`;
      parts.push({ text: `{${name}}`, slots: [name] });
    } else if (choice === 3) {
      const then = generate(c, depth + 1);
      const otherwise = c.below(2) === 0 ? null : generate(c, depth + 1);
      parts.push({
        text: `{if c${counter++}}${then.text}${otherwise === null ? '' : `{else}${otherwise.text}`}{/if}`,
        slots: [...then.slots, ...(otherwise?.slots ?? [])],
      });
    } else if (choice === 4) {
      const body = generate(c, depth + 1);
      parts.push({ text: `{for t${counter++} in self}${body.text}{/for}`, slots: body.slots });
    } else {
      const body = generate(c, depth + 1);
      parts.push({
        text: `{for t${counter++} of self.get(:l)}${body.text}{/for}`,
        slots: body.slots,
      });
    }
  }
  return { text: parts.map((p) => p.text).join(''), slots: parts.flatMap((p) => p.slots) };
}

/** Every slot's name the prose read, blocks' insides included. */
function slotsIn(prose: Prose): string[] {
  const found: string[] = [];
  const walk = (run: Prose): void => {
    for (const piece of run.pieces) {
      if (piece.kind === 'prose-slot' && piece.expr.kind === 'binding')
        found.push(piece.expr.name.text);
      if (piece.kind === 'prose-for') walk(piece.body);
      if (piece.kind === 'prose-if') {
        walk(piece.then);
        for (let o = piece.otherwise; o !== null;) {
          if (o.kind === 'prose') {
            walk(o);
            break;
          }
          walk(o.then);
          o = o.otherwise;
        }
      }
    }
  };
  walk(prose);
  return found;
}

/** A mistake put into well-formed prose between two of its pieces, and what it is refused as. */
const DEFECTS = [
  { text: '{/if}', message: '`{/if}` closes no `{if}`.' },
  { text: '{/for}', message: '`{/for}` closes no `{for}`.' },
  { text: '{else}', message: '`{else}` belongs inside an `{if}`.' },
  { text: '{}', message: 'This slot is empty.' },
  { text: '{/while}', message: '`{/while}` closes nothing a passage opens.' },
  { text: '{a b}', message: 'A slot renders one thing, and more is written after it.' },
] as const;

describe('generated prose', () => {
  it('a well-formed passage reads with nothing said, and every slot it holds is read', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const generated = generate(chooser(seed), 0);
      const { prose, refusals } = readProseText(generated.text);
      expect(refusals, generated.text).toEqual([]);
      expect(slotsIn(prose), generated.text).toEqual(generated.slots);
    }
  });

  it('a mistake at the top of a passage is said once, and no well-formed slot vanishes silently', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const c = chooser(seed);
      const before = generate(c, 0);
      const after = generate(c, 0);
      const defect = c.one(DEFECTS);
      const text = `${before.text}${defect.text}${after.text}`;
      const { prose, refusals } = readProseText(text);
      expect(
        refusals.map((d) => d.message),
        text,
      ).toEqual([defect.message]);
      expect(slotsIn(prose), text).toEqual([...before.slots, ...after.slots]);
    }
  });

  it('a block left unclosed is said once, at its opening, and keeps every slot after it', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const c = chooser(seed);
      const before = generate(c, 0);
      const inside = generate(c, 0);
      const opening = c.one(['{if open}', '{for open in self}']);
      const text = `${before.text}${opening}${inside.text}`;
      const { prose, refusals } = readProseText(text);
      expect(
        refusals.map((d) => [textOf(d.at), d.message]),
        text,
      ).toEqual([
        [
          opening,
          opening.startsWith('{if')
            ? 'This `{if}` is never closed.'
            : 'This `{for}` is never closed.',
        ],
      ]);
      expect(slotsIn(prose), text).toEqual([...before.slots, ...inside.slots]);
    }
  });
});
