import { describe, expect, it } from 'vitest';

import { writtenPass, type KindDeclaration, type PassDeclaration } from '../ast.js';
import { unspanned } from '../../source/nodes.js';
import { Diagnostics } from '../../source/diagnostics.js';
import { locationOf, SourceFile } from '../../source/source.js';
import { chooser, read, shape } from '../../fixtures/parse.js';
import { WELL_FORMED_GUARDS } from '../../fixtures/recovery.js';
import { Parser } from './parser.js';
import { passRule } from './passes.js';

function readMembers(members: string) {
  const { declarations, refusals } = read(`kind Case {\n  contains\n  ${members}\n}\n`, 'k.sprout');
  const kind = declarations.find((d): d is KindDeclaration => d.kind === 'kind');
  return {
    members: kind?.members ?? [],
    passes: (kind?.members ?? []).filter((m): m is PassDeclaration => m.kind === 'pass'),
    said: refusals.map((d) => [locationOf(d.at), d.message, d.remedy]),
    messages: refusals.map((d) => d.message),
  };
}

describe('a pass rule', () => {
  it('is read as the spec writes it, for one message and for the rest', () => {
    const { passes, said } = readMembers('pass :illuminating (true)\n  pass any (self.get(:open))');
    expect(said).toEqual([]);
    expect(unspanned(passes)).toEqual([]);
    expect(passes.map((p) => [writtenPass(p), shape(p.rule)])).toEqual([
      ['pass :illuminating', 'true'],
      ['pass any', 'self.get(:open)'],
    ]);
  });

  it('is read by `passRule` directly, spanning its word to its bracket', () => {
    const diagnostics = new Diagnostics();
    const text = 'pass any (false)';
    const p = new Parser(new SourceFile('k.sprout', text), diagnostics, new Map());
    const made = passRule(p, () => false);
    expect(diagnostics.refusals).toEqual([]);
    expect([made?.at.start, made?.at.end]).toEqual([0, text.length]);
  });

  it('refuses a rule that names neither a message nor `any`', () => {
    expect(readMembers('pass open (true)').said).toEqual([
      [
        'k.sprout:3:8',
        '`pass` names a message, with its colon, or `any` for every message it does not name.',
        'Write `pass :open (…)` or `pass any (…)`, as in `pass any (self.get(:open))`.',
      ],
    ]);
  });

  it('refuses a rule with no condition, or an empty one', () => {
    expect(readMembers('pass any\n  :open true').said).toEqual([
      [
        'k.sprout:3:11',
        '`pass any` says whether it lets the message through, in brackets.',
        'Write `pass any (true)`, `pass any (false)`, or a condition, as in `pass any (self.get(:open))`.',
      ],
    ]);
    expect(readMembers('pass :m ()').messages).toEqual([
      '`pass :m` says nothing inside its brackets.',
    ]);
  });

  it('refuses a condition whose bracket is never closed', () => {
    expect(readMembers('pass any (true\n  :open true').messages).toEqual([
      'The condition of `pass any` ends here, and its bracket is never closed.',
    ]);
  });

  it('leaves a property on the next line to the body', () => {
    const { members, messages } = readMembers('pass\n  :open true');
    expect(messages).toEqual([
      '`pass` names a message, with its colon, or `any` for every message it does not name.',
    ]);
    expect(members.map((m) => m.kind)).toEqual(['contains', 'property']);
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
