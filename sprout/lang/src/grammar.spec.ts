import { describe, expect, it } from 'vitest';

import { BUILTIN_VERBS, grammarLines, grammarTokens, messageGrammar } from './grammar.js';
import { sproutSkill } from './sprout-skill.js';
import { compileSprout } from './sprout-lang.js';

// The grammar table is a language fact (§3.1): the lines, the defaults
// and the built-ins are produced here and the skill teaches the same.

describe('the grammar table', () => {
  it('tokenises a line: words, filler that may be left out, and the slots it declares', () => {
    expect(grammarTokens('light [self] with [with]', ['with'])).toEqual([
      { lit: 'light' },
      { slot: 'self', kind: 'object' },
      { lit: 'with' },
      { slot: 'with', kind: 'object' },
    ]);
    expect(grammarTokens('kick the wheel', [])).toEqual([
      { lit: 'kick' },
      { lit: 'the', filler: true },
      { lit: 'wheel' },
    ]);
    expect(grammarTokens('poke [ghost]', [])).toEqual([{ lit: 'poke' }]);
  });

  it('a message with no grammar gets "<name> [self]" and one line per argument', () => {
    const def = compileSprout(
      'object o {\n  wave { say "hi" }\n  use (with: object) { say "x" }\n  light { grammar "light [self]" grammar "strike a match" say "y" }\n}',
    ).definition!;
    expect(grammarLines(def.messages[0]!)).toEqual(['wave [self]']);
    expect(grammarLines(def.messages[1]!)).toEqual(['use [self]', 'use [self] with [with]']);
    expect(grammarLines(def.messages[2]!)).toEqual(['light [self]', 'strike a match']);
    expect(messageGrammar(def.messages[1]!)[1]).toEqual([
      { lit: 'use' },
      { slot: 'self', kind: 'object' },
      { lit: 'with' },
      { slot: 'with', kind: 'object' },
    ]);
  });

  it('the built-in verbs are tokenised with their slot kinds, and the skill teaches every one of them', () => {
    const names = BUILTIN_VERBS.map((b) => b.name);
    expect(names).toEqual([
      'look',
      'examine',
      'inventory',
      'take',
      'drop',
      'put',
      'give',
      'go',
      'wait',
      'help',
    ]);
    const give = BUILTIN_VERBS.find((b) => b.name === 'give')!;
    expect(give.tokens[0]).toEqual([
      { lit: 'give' },
      { slot: 'x', kind: 'held' },
      { lit: 'to' },
      { slot: 'y', kind: 'person' },
    ]);
    const skill = sproutSkill().toLowerCase();
    for (const b of BUILTIN_VERBS) expect(skill).toContain(b.lines[0]!.split(' ')[0]!);
  });
});
