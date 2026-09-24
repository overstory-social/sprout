import { describe, expect, it } from 'vitest';

import { Diagnostics } from '../../source/diagnostics.js';
import { locationOf, SourceFile, textOf } from '../../source/source.js';
import { shape } from '../../fixtures/parse.js';
import { DECLARATION_READERS } from './declarations.js';
import { Parser } from './parser.js';
import { readTag, type Tag } from './prose-tags.js';

/** The one tag `text` is, read where it stands in a line of prose around it. */
function tag(text: string) {
  const line = `Before ${text} after.`;
  const source = new SourceFile('lines.prose', line);
  const diagnostics = new Diagnostics();
  const p = new Parser(source, diagnostics, DECLARATION_READERS);
  const start = 'Before '.length;
  const read = readTag(p, {
    at: source.span(start, start + text.length),
    start: start + 1,
    end: start + text.length - 1,
  });
  return {
    read,
    said: diagnostics.refusals.map((d) => [locationOf(d.at), d.message, d.remedy]),
  };
}

/** What a tag read as, in a word. */
function kindOf(read: Tag | null): string {
  if (read === null) return 'null';
  switch (read.tag) {
    case 'slot':
      return `slot ${shape(read.expr)}`;
    case 'if':
    case 'else-if':
      return `${read.tag} ${shape(read.condition)}`;
    case 'for':
      return `for ${read.variable.text}${read.filter === null ? '' : `: ${read.filter.name.text}`} ${read.walks} ${shape(read.over)}`;
    case 'close':
      return `close ${read.closes}`;
    case 'one-of':
      return 'one of';
    case 'or':
      return 'or';
    case 'broken':
      return `broken ${read.opens}`;
    case 'else':
      return 'else';
  }
}

describe('a tag says what it is by its first word', () => {
  it('reads a slot as one expression, whose spans are the file’s', () => {
    const { read, said } = tag('{self.get(:mood)}');
    expect(said).toEqual([]);
    expect(kindOf(read)).toBe('slot self.get(:mood)');
    if (read?.tag !== 'slot') return expect.unreachable('a slot was written');
    expect(textOf(read.expr.at)).toBe('self.get(:mood)');
  });

  it('reads the loop’s own names as names inside a slot', () => {
    expect(kindOf(tag('{$index}').read)).toBe('slot $index');
    expect(kindOf(tag('{if !$last}').read)).toBe('if (!$last)');
  });

  it('reads a condition with no brackets, whatever it compares', () => {
    expect(kindOf(tag('{if self.count == 1}').read)).toBe('if (self.count == 1)');
    expect(kindOf(tag('{else if thing != actor}').read)).toBe('else-if (thing != actor)');
    expect(kindOf(tag('{ else }').read)).toBe('else');
  });

  it('reads the three walks, the kind filter on contents alone', () => {
    expect(kindOf(tag('{for thing in self}').read)).toBe('for thing in self');
    expect(kindOf(tag('{for pot: Vessel in self}').read)).toBe('for pot: Vessel in self');
    expect(kindOf(tag('{for key of self.get(:keys)}').read)).toBe('for key of self.get(:keys)');
  });

  it('reads the closes, and the words of a choice', () => {
    expect(kindOf(tag('{/if}').read)).toBe('close if');
    expect(kindOf(tag('{/ for }').read)).toBe('close for');
    expect(kindOf(tag('{one of}').read)).toBe('one of');
    expect(kindOf(tag('{ one \n of }').read)).toBe('one of');
    expect(kindOf(tag('{or}').read)).toBe('or');
    expect(kindOf(tag('{/one  of}').read)).toBe('close one of');
  });

  it('reads `or` and `one of` with more after them as slots, which the checker types', () => {
    expect(kindOf(tag('{or more}').read)).toBe('null');
    expect(kindOf(tag('{one}').read)).toBe('slot one');
  });

  it('reads a word that only begins like a block’s as a slot', () => {
    expect(kindOf(tag('{format}').read)).toBe('slot format');
    expect(kindOf(tag('{iffy}').read)).toBe('slot iffy');
    expect(kindOf(tag('{order}').read)).toBe('slot order');
  });
});

describe('a tag that cannot be read is said once, and costs itself', () => {
  it('refuses an empty slot', () => {
    const { read, said } = tag('{ }');
    expect(read).toBeNull();
    expect(said).toEqual([
      [
        'lines.prose:1:8',
        'This slot is empty.',
        'Write what it renders between the braces, as in `{self}`, or \\{ for a brace that is only a character.',
      ],
    ]);
  });

  it('refuses more than one thing in a slot, at what is more', () => {
    const { read, said } = tag('{self thing}');
    expect(read).toBeNull();
    expect(said).toEqual([
      [
        'lines.prose:1:14',
        'A slot renders one thing, and more is written after it.',
        'Write one reading in each slot, as in `{self.get(:mood)}`.',
      ],
    ]);
  });

  it('refuses a close for a block no passage opens', () => {
    const { read, said } = tag('{/while}');
    expect(read).toBeNull();
    expect(said.map(([, message]) => message)).toEqual([
      '`{/while}` closes nothing a passage opens.',
    ]);
  });

  it('keeps a block’s opening that did not read as broken, so its close is still its own', () => {
    for (const [text, opens, message] of [
      ['{if}', 'if', '`{if}` needs a condition.'],
      ['{else if }', 'else', '`{else if}` needs a condition.'],
      ['{else when awake}', 'else', '`{else}` is written alone, or as `{else if …}`.'],
      ['{for thing self}', 'for', '`{for}` needs a name, `in` or `of`, and what it walks.'],
      ['{for}', 'for', '`{for}` needs a name, `in` or `of`, and what it walks.'],
      ['{for thing in}', 'for', '`{for}` needs a name, `in` or `of`, and what it walks.'],
    ] as const) {
      const { read, said } = tag(text);
      expect(kindOf(read), text).toBe(`broken ${opens}`);
      expect(
        said.map(([, m]) => m),
        text,
      ).toEqual([message]);
    }
  });

  it('refuses a loop variable named as a loop’s own are, or with a word of the language', () => {
    const own = tag('{for $first in self}');
    expect(kindOf(own.read)).toBe('broken for');
    expect(own.said.map(([at, m]) => [at, m])).toEqual([
      [
        'lines.prose:1:13',
        "`$first` is one of a loop's own names, so it cannot name what the loop walks.",
      ],
    ]);
    const reserved = tag('{for say in self}');
    expect(reserved.said.map(([, m]) => m)).toEqual([
      '`say` is a word of the language, so it cannot name what a loop walks.',
    ]);
  });

  it('refuses a kind filter on a walk of a list, naming both forms', () => {
    const { read, said } = tag('{for m: Mirror of self.get(:moods)}');
    expect(kindOf(read)).toBe('broken for');
    expect(said).toEqual([
      [
        'lines.prose:1:16',
        'A kind picks out what a container holds, and `of` walks a list or a set role whole.',
        'Write `{for m: Mirror in <container>}`, or leave the kind out: `{for m of <list>}`.',
      ],
    ]);
  });
});
