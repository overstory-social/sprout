import { describe, expect, it } from 'vitest';

import { writtenPass, type KindDeclaration, type PassDeclaration } from '../ast.js';
import { unspanned } from '../../source/nodes.js';
import { locationOf } from '../../source/source.js';
import { chooser, read, shape } from '../../fixtures/parse.js';
import { WELL_FORMED_GUARDS } from '../../fixtures/recovery.js';
import { atMember, inKind, readWith, rest } from '../../fixtures/readers.js';
import { passRule } from './passes.js';

/**
 * The pass rules `members` starts with, read one after another by
 * `passRule` in the body of `kind Case` after its `contains`, what they
 * left for the body, and what was said.
 */
function readPasses(members: string) {
  const { text } = inKind(`contains\n  ${members}`, 'Case');
  const { p, diagnostics, startsMember } = atMember(text, text.indexOf(members), 'Case', {
    name: 'k.sprout',
  });
  const passes: PassDeclaration[] = [];
  while (p.at('name', 'pass')) {
    const one = passRule(p, startsMember);
    if (one !== null) passes.push(one);
  }
  return {
    passes,
    rest: rest(p),
    said: diagnostics.refusals.map((d) => [locationOf(d.at), d.message, d.remedy]),
    messages: diagnostics.refusals.map((d) => d.message),
  };
}

describe('a pass rule', () => {
  it('is read as the spec writes it, for one message and for the rest', () => {
    const { passes, said, rest } = readPasses(
      'pass :illuminating (true)\n  pass any (self.get(:open))',
    );
    expect(said).toEqual([]);
    expect(rest).toBe('}\n');
    expect(unspanned(passes)).toEqual([]);
    expect(passes.map((p) => [writtenPass(p), shape(p.rule)])).toEqual([
      ['pass :illuminating', 'true'],
      ['pass any', 'self.get(:open)'],
    ]);
  });

  it('is read by `passRule` directly, spanning its word to its bracket', () => {
    const text = 'pass any (false)';
    const { read: made, refusals } = readWith((p) => passRule(p, () => false), text, {
      readers: new Map(),
    });
    expect(refusals).toEqual([]);
    expect([made?.at.start, made?.at.end]).toEqual([0, text.length]);
  });

  it('refuses a rule that names neither a message nor `any`', () => {
    expect(readPasses('pass open (true)').said).toEqual([
      [
        'k.sprout:3:8',
        '`pass` names a message, with its colon, or `any` for every message it does not name.',
        'Write `pass :open (…)` or `pass any (…)`, as in `pass any (self.get(:open))`.',
      ],
    ]);
  });

  it('refuses a rule with no condition, or an empty one', () => {
    expect(readPasses('pass any\n  :open true').said).toEqual([
      [
        'k.sprout:3:11',
        '`pass any` says whether it lets the message through, in brackets.',
        'Write `pass any (true)`, `pass any (false)`, or a condition, as in `pass any (self.get(:open))`.',
      ],
    ]);
    expect(readPasses('pass :m ()').messages).toEqual([
      '`pass :m` says nothing inside its brackets.',
    ]);
  });

  it('refuses a condition whose bracket is never closed', () => {
    const unclosed = readPasses('pass any (true\n  :open true');
    expect(unclosed.messages).toEqual([
      'The condition of `pass any` ends here, and its bracket is never closed.',
    ]);
    expect(unclosed.rest).toBe(':open true\n}\n');
  });

  it('leaves a property on the next line to the body', () => {
    const { passes, rest, messages } = readPasses('pass\n  :open true');
    expect(messages).toEqual([
      '`pass` names a message, with its colon, or `any` for every message it does not name.',
    ]);
    expect(passes).toEqual([]);
    expect(rest).toBe(':open true\n}\n');
  });
});

// --- generated input -------------------------------------------------------

const WELL_FORMED = [
  { name: 'illuminating', text: 'pass :illuminating (true)' },
  { name: 'any', text: 'pass any (self.get(:open) && !self.get(:locked))' },
];
const DEFECTS: readonly string[] = [
  'pass',
  'pass any',
  'pass open (true)',
  'pass :m ()',
  'pass :m (%%)',
  'pass :m (a ==)',
  'pass Any (true)',
];
const NEIGHBOURS = [
  ...WELL_FORMED,
  ...WELL_FORMED_GUARDS.map(({ names, text }) => ({ name: names[0], text })),
  { name: 'open', text: ':open true' },
  { name: 'gust', text: 'on :gust { self.set(:open, false) }' },
  { name: 'passage', text: 'passage full { There is no room in {self}. }' },
];

describe('a well-formed pass rule never vanishes, and never answers for its neighbour', () => {
  it('over generated bodies with one defective rule among well-formed members', () => {
    const c = chooser(20_260_925);
    const reached = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const members = c.shuffled(NEIGHBOURS).filter(() => c.below(3) !== 0);
      if (members.length === 0) continue;
      const lines = members.map((member) => member.text);
      lines.splice(c.below(members.length + 1), 0, c.one(DEFECTS));
      const text = `kind Case {\n  ${lines.join('\n  ')}\n}\n`;
      const { declarations, refusals } = read(text, 'g.sprout');
      const kind = declarations.find((d): d is KindDeclaration => d.kind === 'kind');
      expect(refusals.length, text).toBeGreaterThan(0);
      for (const member of members) {
        const start = text.indexOf(member.text);
        const end = start + member.text.length;
        const kept = kind!.members.find((m) => m.at.start === start && m.at.end === end);
        expect(kept, `${text}\n  \`${member.name}\` vanished`).toBeDefined();
        if (kept?.kind === 'pass') reached.add(`kept ${member.name}`);
        for (const d of refusals) {
          expect(d.at.start > start && d.at.start < end, `${text}\n  ${d.message}`).toBe(false);
        }
      }
    }
    expect([...reached].sort()).toEqual(['kept any', 'kept illuminating']);
  });
});
