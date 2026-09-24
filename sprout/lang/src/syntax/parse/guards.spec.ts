import { describe, expect, it } from 'vitest';

import type { GuardDeclaration, KindDeclaration, Statement, WorldDeclaration } from '../ast.js';
import { unspanned } from '../../source/nodes.js';
import { locationOf, textOf } from '../../source/source.js';
import { chooser, read } from '../../fixtures/parse.js';
import { GUARD_DEFECTS, GUARD_UNCLOSED, WELL_FORMED_GUARDS } from '../../fixtures/recovery.js';
import { isGuardName } from './guards.js';

/** The guards a kind's body holds, and everything said, as location and message. */
function readGuards(members: string) {
  const { declarations, refusals } = read(`kind Crate {\n  ${members}\n}\n`, 'k.sprout');
  const kind = declarations.find((d): d is KindDeclaration => d.kind === 'kind');
  const guards = (kind?.members ?? []).filter((m): m is GuardDeclaration => m.kind === 'guard');
  return {
    kind,
    guards,
    said: refusals.map((d) => [locationOf(d.at), d.message, d.remedy]),
    messages: refusals.map((d) => d.message),
  };
}

/** A statement as a short shape, blocks in braces, so a case can say what nested in what. */
function shapeOf(statement: Statement): string {
  switch (statement.kind) {
    case 'if': {
      const then = `{${statement.then.statements.map(shapeOf).join(' ')}}`;
      const otherwise = statement.otherwise;
      if (otherwise === null) return `if ${then}`;
      if (otherwise.kind === 'block') {
        return `if ${then} else {${otherwise.statements.map(shapeOf).join(' ')}}`;
      }
      return `if ${then} else ${shapeOf(otherwise)}`;
    }
    case 'refuse':
      return statement.said.kind === 'prose-literal'
        ? 'refuse "…"'
        : `refuse ${statement.said.text}`;
    default:
      return statement.kind;
  }
}

describe('the three guards', () => {
  it('are read as the spec writes them, each word, its parameters and its block', () => {
    const { guards, said } =
      readGuards(`depart  (to)         { if (mover != self) { refuse held_fast } }
  release (item, to)   { if (mover != self) { refuse not_yours } }
  accept  (item, from) {
    if (!self.get(:open))                       { refuse shut }
    else if (self.count >= self.get(:capacity)) { refuse full }
  }`);
    expect(said).toEqual([]);
    expect(unspanned(guards)).toEqual([]);
    expect(guards.map((g) => [g.guard, g.parameters.map((p) => p.text)])).toEqual([
      ['depart', ['to']],
      ['release', ['item', 'to']],
      ['accept', ['item', 'from']],
    ]);
    expect(guards.map((g) => g.body.statements.map(shapeOf))).toEqual([
      ['if {refuse held_fast}'],
      ['if {refuse not_yours}'],
      ['if {refuse shut} else if {refuse full}'],
    ]);
    expect(textOf(guards[0]!.at)).toBe(
      'depart  (to)         { if (mover != self) { refuse held_fast } }',
    );
  });

  it('name their parameters as the author chooses; the count is what is checked', () => {
    const { guards, said } = readGuards('release (thing, dest) { allow }');
    expect(said).toEqual([]);
    expect(guards[0]!.parameters.map((p) => p.text)).toEqual(['thing', 'dest']);
  });

  it('are read in a kind, an object and the world alike', () => {
    for (const [open, close] of [
      ['kind K {', '}'],
      ['world w is sprout.World {\nobject o is K {', '}\n}'],
      ['world w is sprout.World {', '}'],
    ]) {
      const { declarations, refusals } = read(`${open}\n  depart (to) { allow }\n${close}`);
      expect(refusals, open).toEqual([]);
      const top = declarations[0] as KindDeclaration | WorldDeclaration;
      const owner = top.objects[0] ?? top;
      expect(
        owner.members.map((m) => m.kind),
        open,
      ).toEqual(['guard']);
    }
  });

  it('are the only words `isGuardName` answers to', () => {
    expect(['depart', 'release', 'accept'].every(isGuardName)).toBe(true);
    expect(['passage', 'permit', 'refuse', 'Depart'].some(isGuardName)).toBe(false);
  });
});

describe('a guard’s parameters', () => {
  const REMEDY = {
    depart: 'Write `depart (to) { … }`.',
    release: 'Write `release (item, to) { … }`.',
    accept: 'Write `accept (item, from) { … }`.',
  };

  it('are as many as the guard takes, refused where one is missing or one too many', () => {
    expect(readGuards('release (item) { allow }').said).toEqual([
      [
        'k.sprout:2:16',
        '`release` names the thing and where it goes: two names in brackets.',
        REMEDY.release,
      ],
    ]);
    expect(readGuards('depart (to, from) { allow }').said).toEqual([
      [
        'k.sprout:2:15',
        '`depart` names where the thing is going: one name in brackets.',
        REMEDY.depart,
      ],
    ]);
    expect(readGuards('accept () { allow }').said).toEqual([
      [
        'k.sprout:2:11',
        '`accept` names the thing and where it comes from: two names in brackets.',
        REMEDY.accept,
      ],
    ]);
  });

  it('are in brackets, refused where the brackets are left off, the block still read', () => {
    const { said, guards } = readGuards('depart { refuse }');
    expect(said.map(([at, message]) => [at, message])).toEqual([
      ['k.sprout:2:10', '`depart` names where the thing is going: one name in brackets.'],
      ['k.sprout:2:18', '`refuse` says why.'],
    ]);
    expect(guards).toEqual([]);
  });

  it('are names, refused at the first thing that is not one or not a comma', () => {
    expect(readGuards('release (Item, to) { allow }').said[0]!.slice(0, 1)).toEqual([
      'k.sprout:2:12',
    ]);
    expect(readGuards('release (item to) { allow }').said[0]!.slice(0, 1)).toEqual([
      'k.sprout:2:17',
    ]);
    expect(readGuards('depart (to,) { allow }').said[0]!.slice(0, 1)).toEqual(['k.sprout:2:13']);
  });

  it('may be `to` and `from`, as the spec writes them, and no other word of the language', () => {
    expect(readGuards('accept (item, from) { allow }').said).toEqual([]);
    expect(readGuards('release (item, if) { allow }').said).toEqual([
      [
        'k.sprout:2:18',
        '`if` is a word of the language, so it cannot name what `release` is given.',
        'Choose another name, as in `release (item, to) { … }`.',
      ],
    ]);
  });

  it('have brackets that close, before the block; what they held is stepped over', () => {
    const { said, kind } = readGuards('depart (to { allow }\n  :open true');
    expect(said.map(([at, message]) => [at, message])).toEqual([
      ['k.sprout:2:14', 'The brackets after `depart` are never closed.'],
    ]);
    expect(kind!.members.map((m) => m.kind)).toEqual(['property']);
    const before = readGuards('depart (to\n  :open true');
    expect(before.messages).toEqual(['The brackets after `depart` are never closed.']);
    expect(before.kind!.members.map((m) => m.kind)).toEqual(['property']);
  });
});

describe('a guard’s block', () => {
  it('is required, and its absence does not take the next member', () => {
    const { said, kind } = readGuards('depart (to)\n  :open true');
    expect(said).toEqual([
      [
        'k.sprout:2:14',
        'What `depart` decides goes in braces.',
        'Write `depart (to) { … }`, ending in `allow` or `refuse` where it decides.',
      ],
    ]);
    expect(kind!.members.map((m) => m.kind)).toEqual(['property']);
  });

  it('is never closed where the body’s next member starts inside it, said there, and the member kept', () => {
    const { said, kind } = readGuards(
      'accept (item, from) {\n    if (a) { refuse shut }\n  passage shut { {self} is shut. }',
    );
    expect(said).toEqual([
      [
        'k.sprout:4:3',
        '`accept` is never closed.',
        'Add a } where what `accept` decides ends. Every { inside it, after an `if` or an `else`, needs its own }.',
      ],
    ]);
    expect(kind!.members.map((m) => m.kind)).toEqual(['passage']);
  });

  it('leaves the file’s end to the body, which says it is never closed once', () => {
    const { refusals } = read('kind Crate {\n  depart (to) { allow\n');
    expect(refusals.map((d) => d.message)).toEqual(['`Crate` is never closed.']);
  });

  it('keeps the statements that read around one that did not', () => {
    const { guards, messages } = readGuards('depart (to) {\n    tell "Hi."\n    allow\n  }');
    expect(messages).toEqual(['`tell` does not start a statement this compiler reads.']);
    expect(guards[0]!.body.statements.map(shapeOf)).toEqual(['allow']);
  });
});

// --- generated input -------------------------------------------------------
//
// The guard reader's share of the parser's recovery rule, over bodies of
// well-formed guards and other members with one defective guard among
// them: every well-formed guard is kept whole, with every statement it
// was written with, and nothing is said about the inside of a
// well-formed guard because of its neighbour. A guard never closed may
// be said to end at the next member's first word, which is where it ran
// out, and never further in.

const NEIGHBOURS = [
  ...WELL_FORMED_GUARDS.map(({ names, text }) => ({ name: names[0], text })),
  { name: 'open', text: ':open true' },
  { name: 'passage', text: 'passage full { There is no room in {self}. }' },
  { name: 'contains', text: 'contains' },
];

describe('a well-formed guard never vanishes, and never answers for its neighbour', () => {
  it('over generated bodies with one defective guard among well-formed members', () => {
    const c = chooser(20_260_927);
    const reached = new Set<string>();
    for (let i = 0; i < 600; i++) {
      const members = c.shuffled(NEIGHBOURS).filter(() => c.below(4) !== 0);
      const unclosed = c.below(8) === 0;
      const defect = unclosed ? GUARD_UNCLOSED : c.one(GUARD_DEFECTS);
      // The unclosed guard takes the body's own `}` when it is last, and
      // then the body is never closed; that shape is `bodies.spec.ts`'s.
      const at = unclosed ? c.below(members.length) : c.below(members.length + 1);
      if (members.length === 0) continue;
      const lines = members.map((member) => member.text);
      lines.splice(at, 0, defect);
      const text = `kind Crate {\n  ${lines.join('\n  ')}\n}\n`;
      const { declarations, refusals } = read(text, 'g.sprout');
      const kind = declarations.find((d): d is KindDeclaration => d.kind === 'kind');
      expect(refusals.length, text).toBeGreaterThan(0);
      expect(kind, text).toBeDefined();

      for (const member of members) {
        const start = text.indexOf(member.text);
        const end = start + member.text.length;
        const kept = kind!.members.find((m) => m.at.start === start && m.at.end === end);
        expect(kept, `${text}\n  \`${member.name}\` vanished`).toBeDefined();
        if (kept?.kind === 'guard') {
          const written = WELL_FORMED_GUARDS.find(({ names }) => names[0] === member.name)!;
          expect(textOf(kept.at), text).toBe(written.text);
          reached.add(`kept ${kept.guard}`);
        }
        // Nothing said about the inside of a well-formed member.
        for (const d of refusals) {
          expect(d.at.start > start && d.at.start < end, `${text}\n  ${d.message}`).toBe(false);
        }
      }
      reached.add(unclosed ? 'unclosed' : 'contained');
    }
    expect([...reached].sort()).toEqual([
      'contained',
      'kept accept',
      'kept depart',
      'kept release',
      'unclosed',
    ]);
  });
});
