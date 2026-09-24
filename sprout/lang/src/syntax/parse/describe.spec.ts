import { describe as group, expect, it } from 'vitest';

import type { KindDeclaration, WorldDeclaration } from '../ast.js';
import type { DescribeDeclaration } from '../ast-speech.js';
import { unspanned } from '../../source/nodes.js';
import { locationOf, textOf } from '../../source/source.js';
import { chooser, read } from '../../fixtures/parse.js';
import { WELL_FORMED_GUARDS } from '../../fixtures/recovery.js';

/** The describes a kind's body holds, and everything said, as location, message and remedy. */
function readDescribes(members: string) {
  const { declarations, refusals } = read(`kind Crate {\n  ${members}\n}\n`, 'k.sprout');
  const kind = declarations.find((d): d is KindDeclaration => d.kind === 'kind');
  const described = (kind?.members ?? []).filter(
    (m): m is DescribeDeclaration => m.kind === 'describe',
  );
  return {
    kind,
    described,
    said: refusals.map((d) => [locationOf(d.at), d.message, d.remedy]),
  };
}

group('a describe', () => {
  it('is its word and a block of statements, read as any body’s block is', () => {
    const { described, said } = readDescribes(
      'describe {\n    let n = self.count\n    if (n > 1) { text many } else { text "One." }\n  }',
    );
    expect(said).toEqual([]);
    expect(described).toHaveLength(1);
    const [one] = described;
    expect(unspanned(one)).toEqual([]);
    expect(textOf(one!.at).startsWith('describe {')).toBe(true);
    expect(one!.body.statements.map((s) => s.kind)).toEqual(['let', 'if']);
  });

  it('is read in a kind and an object alike, and the world’s own body reads none', () => {
    const { declarations, refusals } = read(
      [
        'world w is sprout.World {',
        '  describe { text "The world." }',
        '  object hall is sprout.Place { describe { text "A hall." } }',
        '}',
        'kind K { describe { text "A thing." } }',
      ].join('\n'),
      'w.sprout',
    );
    const world = declarations.find((d): d is WorldDeclaration => d.kind === 'world')!;
    const hall = world.objects[0]!;
    expect(hall.members.map((m) => m.kind)).toEqual(['describe']);
    const kind = declarations.find((d): d is KindDeclaration => d.kind === 'kind')!;
    expect(kind.members.map((m) => m.kind)).toEqual(['describe']);
    expect(refusals.map((d) => [locationOf(d.at), d.message])).toEqual([
      ['w.sprout:2:3', 'A world is not made of `describe`.'],
    ]);
  });

  it('holds what it gives in braces, refused where they are left off, the next member kept', () => {
    const { kind, said } = readDescribes('describe text "A crate."\n  :open true');
    expect(said).toEqual([
      [
        'k.sprout:2:12',
        'What `describe` gives goes in braces.',
        'Write `describe { text "Slat-sided, heavier than it looks." }`.',
      ],
    ]);
    expect(kind!.members.map((m) => m.kind)).toEqual(['property']);
  });

  it('is never closed where the body’s next member starts inside it, said there, and the member kept', () => {
    const { kind, said } = readDescribes('describe { text "A crate."\n  :open true');
    expect(said).toEqual([
      [
        'k.sprout:3:3',
        '`describe` is never closed.',
        'Add a } where what `describe` decides ends. Every { inside it, after an `if` or an `else`, needs its own }.',
      ],
    ]);
    expect(kind!.members.map((m) => m.kind)).toEqual(['property']);
  });

  it('keeps the statements that read around one that did not', () => {
    const { described, said } = readDescribes('describe { text "A." 4 text "B." }');
    expect(said.map(([, message]) => message)).toEqual([
      'the number 4 does not start a statement this compiler reads.',
    ]);
    expect(described[0]!.body.statements.map((s) => s.kind)).toEqual(['text', 'text']);
  });

  it('is named, with its block stepped over, when written after the `}` that ends its body', () => {
    const { refusals } = read(
      'kind Crate {\n  :open true\n}\n  describe { text "A crate." }\n  :shut false\n}\n',
      'k.sprout',
    );
    expect(refusals.map((d) => [locationOf(d.at), d.message])).toEqual([
      ['k.sprout:4:3', '`describe` and `:shut` are written after the `}` that ends `Crate`.'],
    ]);
  });
});

// --- the recovery invariant, over generated bodies ----------------------
//
// A describe with one defect in it costs itself at most, and never a
// neighbour: every well-formed member is kept whole, and nothing is said
// about the inside of a well-formed one because of it.

const WELL_FORMED_DESCRIBES = [
  'describe { text "Slat-sided, heavier than it looks." }',
  'describe {\n    if (self.get(:open)) { text open } else { text "Shut." }\n  }',
] as const;

const DESCRIBE_DEFECTS: readonly string[] = [
  'describe',
  'describe text "A."',
  'describe ( ) { text "A." }',
  'describe { text }',
  'describe { text 4 }',
  'describe { if self.open { text "A." } }',
  'describe { else { text "A." } }',
  'describe { %% text "A." }',
  'describe { text "A." with }',
];

const NEIGHBOURS = [
  { name: 'open', text: ':open true' },
  { name: 'passage', text: 'passage open { It stands open. }' },
  { name: 'contains', text: 'contains' },
  { name: 'depart', text: WELL_FORMED_GUARDS[0].text },
];

group('a well-formed member never vanishes beside a defective describe', () => {
  it('over generated bodies with one defective describe among well-formed members', () => {
    const c = chooser(20_260_924);
    const reached = new Set<string>();
    for (let i = 0; i < 600; i++) {
      const members = c.shuffled(NEIGHBOURS).filter(() => c.below(4) !== 0);
      if (members.length === 0) continue;
      const kept = c.below(3) === 0 ? c.one(WELL_FORMED_DESCRIBES) : null;
      const defect = c.one(DESCRIBE_DEFECTS);
      const lines = members.map((member) => member.text);
      lines.splice(c.below(lines.length + 1), 0, defect);
      if (kept !== null) lines.splice(c.below(lines.length + 1), 0, kept);
      const text = `kind Crate {\n  ${lines.join('\n  ')}\n}\n`;
      const { declarations, refusals } = read(text, 'g.sprout');
      const kind = declarations.find((d): d is KindDeclaration => d.kind === 'kind');
      expect(refusals.length, text).toBeGreaterThan(0);
      expect(kind, text).toBeDefined();

      const whole = [...members.map((member) => member.text), ...(kept === null ? [] : [kept])];
      for (const written of whole) {
        const start = text.indexOf(written);
        const end = start + written.length;
        const found = kind!.members.find((m) => m.at.start === start && m.at.end === end);
        expect(found, `${text}\n  \`${written}\` vanished`).toBeDefined();
        if (found?.kind === 'describe') reached.add('kept describe');
        for (const d of refusals) {
          expect(d.at.start > start && d.at.start < end, `${text}\n  ${d.message}`).toBe(false);
        }
      }
      reached.add('defect');
    }
    expect([...reached].sort()).toEqual(['defect', 'kept describe']);
  });
});
