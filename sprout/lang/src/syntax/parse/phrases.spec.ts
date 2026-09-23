import { describe, expect, it } from 'vitest';

import type { PhraseDeclaration, VerbDeclaration } from '../ast.js';
import { Diagnostics } from '../../source/diagnostics.js';
import { unspanned } from '../../source/nodes.js';
import { locationOf, SourceFile, textOf } from '../../source/source.js';
import { chooser, read } from '../../fixtures/parse.js';
import { DECLARATION_READERS } from './declarations.js';
import { Parser } from './parser.js';
import { lowerCase, meantOf, phrase } from './phrases.js';

/** One phrase, read on its own from the quoted text given. */
function readPhrase(quoted: string) {
  const diagnostics = new Diagnostics();
  const p = new Parser(new SourceFile('p.sprout', quoted), diagnostics, DECLARATION_READERS);
  const read = phrase(p);
  return { read, refusals: diagnostics.refusals };
}

/** A phrase's parts as short words: a slot in brackets, words as they mean. */
const partsOf = (read: PhraseDeclaration): string[] =>
  read.parts.map((part) => (part.kind === 'phrase-slot' ? `[${part.role.text}]` : part.text));

describe('a phrase, split into its words and its slots', () => {
  it('reads each run of words and each slot, in order', () => {
    const { read, refusals } = readPhrase('"unlock [target] with [tool]"');
    expect(refusals).toEqual([]);
    expect(partsOf(read!)).toEqual(['unlock', '[target]', 'with', '[tool]']);
    expect(read!.text).toBe('unlock [target] with [tool]');
  });

  it('reads a phrase that is only a slot, and one with no slot', () => {
    expect(partsOf(readPhrase('"[way]"').read!)).toEqual(['[way]']);
    expect(partsOf(readPhrase('"look around"').read!)).toEqual(['look around']);
    expect(partsOf(readPhrase('"?"').read!)).toEqual(['?']);
  });

  it('trims each run of words and makes its spaces single, and reads nothing from spaces alone', () => {
    expect(partsOf(readPhrase('"  pick   up [target]  "').read!)).toEqual(['pick up', '[target]']);
    expect(readPhrase('"   "').read!.parts).toEqual([]);
    expect(readPhrase('""').read!.parts).toEqual([]);
  });

  it('spans each part inside the quotes, and a slot’s role at its name', () => {
    const { read } = readPhrase('"use [tool] on [target]"');
    expect(unspanned(read)).toEqual([]);
    expect(read!.parts.map((part) => textOf(part.at))).toEqual(['use', '[tool]', 'on', '[target]']);
    const slot = read!.parts[1]!;
    expect(slot.kind === 'phrase-slot' && textOf(slot.role.at)).toBe('tool');
  });

  it('spans a slot exactly however many escapes stand before it', () => {
    const { read } = readPhrase('"say \\"hi\\" \\\\ to [target]"');
    expect(read!.text).toBe('say "hi" \\ to [target]');
    expect(partsOf(read!)).toEqual(['say "hi" \\ to', '[target]']);
    expect(read!.parts.map((part) => textOf(part.at))).toEqual([
      'say \\"hi\\" \\\\ to',
      '[target]',
    ]);
  });
});

describe('what a phrase’s slots may not be, refused at the slot', () => {
  const said = (quoted: string): string[] =>
    readPhrase(quoted).refusals.map((d) => `${locationOf(d.at)} ${d.message}`);

  it('never closed, at its `[`', () => {
    expect(said('"take [target"')).toEqual(['p.sprout:1:7 This slot is never closed.']);
    expect(readPhrase('"take [target"').refusals[0]!.remedy).toBe(
      "Add a ] after the role's name: `[target]`.",
    );
  });

  it('empty, or only spaces', () => {
    expect(said('"take []"')).toEqual(['p.sprout:1:7 `[]` names no role.']);
    expect(said('"take [ ]"')).toEqual(['p.sprout:1:7 `[ ]` names no role.']);
  });

  it('capitalised, with the name to write instead', () => {
    const { refusals } = readPhrase('"take [MagicWord]"');
    expect(refusals.map((d) => [locationOf(d.at), d.message, d.remedy])).toEqual([
      [
        'p.sprout:1:7',
        'A slot names a role in lower case, and `MagicWord` starts with a capital.',
        'Write `[magic_word]`.',
      ],
    ]);
  });

  it('anything but a role’s name, spaces around it included', () => {
    for (const inside of ['the target', ' target', 'target!', '4th', 'a[b', 'ta-rget']) {
      expect(said(`"take [${inside}]"`), inside).toEqual([
        `p.sprout:1:7 \`[${inside}]\` is not the name of a role.`,
      ]);
    }
  });

  it('a `]` that closes no slot', () => {
    expect(said('"take target] now"')).toEqual(['p.sprout:1:13 This `]` closes no slot.']);
  });

  it('costs the phrase it is in and nothing else in the verb', () => {
    const { declarations, refusals } = read(
      'verb take { role target  "take [Target]"  "get [target]" }',
      'v.sprout',
    );
    expect(refusals).toHaveLength(1);
    const [take] = declarations as VerbDeclaration[];
    expect(take!.phrases.map((p) => p.text)).toEqual(['get [target]']);
  });
});

describe('what a phrase means is the lexer’s own reading of its quotes', () => {
  it('matches the lexer’s text over generated quoted text, escapes and all', () => {
    const c = chooser(20_260_923);
    const pieces = ['a', ' ', '[', ']', 'x', '\\"', '\\\\', '\\n', '\\{', '{', '}', '?', 'é'];
    for (let i = 0; i < 400; i++) {
      const body = Array.from({ length: c.below(12) }, () => c.one(pieces)).join('');
      const quoted = `"${body}"`;
      const diagnostics = new Diagnostics();
      const p = new Parser(new SourceFile('p.sprout', quoted), diagnostics, DECLARATION_READERS);
      const token = p.peek();
      const meant = meantOf(p, token);
      expect(meant.map((m) => m.ch).join(''), quoted).toBe(token.text);
      // Every character is spanned by what was written for it: one
      // source character, or two for an escape.
      for (const m of meant) {
        const written = quoted.slice(m.start, m.end);
        expect(written === m.ch || (written.startsWith('\\') && written.length === 2), quoted).toBe(
          true,
        );
      }
    }
  });
});

describe('a capitalised name, as a role would be written', () => {
  it('lower-cases it, with an underscore where a word began', () => {
    expect(lowerCase('Target')).toBe('target');
    expect(lowerCase('MagicWord')).toBe('magic_word');
    expect(lowerCase('Door2Key')).toBe('door2_key');
  });
});
