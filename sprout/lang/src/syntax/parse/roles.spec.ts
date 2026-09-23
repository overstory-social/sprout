import { describe, expect, it } from 'vitest';

import type { KindDeclaration, PlayDeclaration, Statement } from '../ast.js';
import { unspanned } from '../../source/nodes.js';
import { locationOf, textOf } from '../../source/source.js';
import { chooser, read } from '../../fixtures/parse.js';
import { OWNERS, ownedBy, WELL_FORMED_GUARDS } from '../../fixtures/recovery.js';

/** The plays a kind's body holds, and everything said, as location, message and remedy. */
function readPlays(members: string) {
  const { declarations, refusals } = read(`kind Key {\n  ${members}\n}\n`, 'k.sprout');
  const kind = declarations.find((d): d is KindDeclaration => d.kind === 'kind');
  const plays = (kind?.members ?? []).filter((m): m is PlayDeclaration => m.kind === 'play');
  return {
    kind,
    plays,
    said: refusals.map((d) => [locationOf(d.at), d.message, d.remedy]),
    messages: refusals.map((d) => d.message),
  };
}

const kinds = (statements: readonly Statement[] | undefined) =>
  (statements ?? []).map((statement) => statement.kind);

/** The spec's own `Key`, from Verbs › Playing a role. */
const KEY_PLAY = `as tool for unlock {
    permit { if (self.get(:wear) >= 99) { refuse "The bit is worn smooth. It turns nothing." } }
    do     { self.adjust(:wear, 1) }
  }`;

describe('a play', () => {
  it('is read as the spec writes one: its role, its verb, a `permit` and a `do`', () => {
    const { plays, said, kind } = readPlays(KEY_PLAY);
    expect(said).toEqual([]);
    expect(unspanned(kind!)).toEqual([]);
    const [play] = plays;
    expect(play!.head.role.text).toBe('tool');
    expect(play!.head.verb.text).toBe('unlock');
    expect(textOf(play!.at)).toBe(KEY_PLAY);
    expect(kinds(play!.permit?.statements)).toEqual(['if']);
    expect(kinds(play!.do?.statements)).toEqual(['expression-statement']);
  });

  it('takes `actor` as its role, and its `from` lines, `permit` and `do` in any order', () => {
    const { plays, said } = readPlays(`as actor for ask {
    do { say "You ask." }
    topic from :knows
    permit { allow }
    dial from -3 to 12
  }`);
    expect(said).toEqual([]);
    const [play] = plays;
    expect(play!.head.role.text).toBe('actor');
    expect(kinds(play!.do?.statements)).toEqual(['say']);
    expect(kinds(play!.permit?.statements)).toEqual(['allow']);
    expect(
      play!.narrows.map((line) =>
        line.by.kind === 'symbol-expr'
          ? `${line.role.text} :${line.by.name.text}`
          : `${line.role.text} ${line.by.min.value} to ${line.by.max.value}`,
      ),
    ).toEqual(['topic :knows', 'dial -3 to 12']);
  });

  it('may leave out either block, but not both', () => {
    expect(readPlays('as target for pull { permit { allow } }').plays[0]!.do).toBeNull();
    expect(readPlays('as target for pull { do { } }').plays[0]!.permit).toBeNull();
    const { plays, said } = readPlays('as target for pull { topic from :knows }');
    expect(plays).toEqual([]);
    expect(said).toEqual([
      [
        'k.sprout:2:3',
        '`as target for pull` says nothing: write a `permit { … }`, a `do { … }`, or both.',
        'A `permit` decides whether it may happen and a `do` says what happens, as in `as target for unlock { permit { … } do { … } }`.',
      ],
    ]);
  });

  it('is read in a world, a kind and an object alike', () => {
    for (const owner of OWNERS) {
      const { declarations, refusals } = read(
        `${owner.open}\n  as target for pull { do { } }\n}\n`,
        'w.sprout',
      );
      expect(
        refusals.map((d) => d.message),
        owner.kind,
      ).toEqual([]);
      expect(
        ownedBy(owner, declarations)!.members.map((m) => m.kind),
        owner.kind,
      ).toEqual(['play']);
    }
  });
});

describe('what a play’s head and body refuse, where, and what to write', () => {
  const cases: [string, string, string, string][] = [
    [
      'as for pull { do { } }',
      'k.sprout:2:5',
      '`as` names the role this plays.',
      'Write `as <role> for <verb> { … }`, as in `as target for unlock { … }`.',
    ],
    [
      'as Target for pull { do { } }',
      'k.sprout:2:6',
      'A role is named in lower case, and `Target` starts with a capital.',
      'Write `target`, as the verb declares it.',
    ],
    [
      'as target pull { do { } }',
      'k.sprout:2:13',
      '`as target` does not say which verb it is played for.',
      'Write `for` and the verb: `as target for <verb> { … }`, as in `as target for unlock { permit { … } do { … } }`.',
    ],
    [
      'as target for { do { } }',
      'k.sprout:2:16',
      '`for` names the verb the role is in.',
      'Write `as <role> for <verb> { … }`, as in `as tool for unlock { … }`.',
    ],
    [
      'as target for Pull { do { } }',
      'k.sprout:2:17',
      'A verb is named in lower case, and `Pull` starts with a capital.',
      'Write `pull`, as the verb declares it.',
    ],
    [
      'as target for pull',
      'k.sprout:2:21',
      'What `as target for pull` does goes in braces.',
      'Write `as target for pull { permit { … } do { … } }`, with a `permit`, a `do`, or both.',
    ],
    [
      'as target for pull { permit { } permit { } }',
      'k.sprout:2:35',
      '`as target for pull` has two `permit`s.',
      'Keep one, and write what both decide in it with `if` and `else if`.',
    ],
    [
      'as target for pull { do { } do { } }',
      'k.sprout:2:31',
      '`as target for pull` has two `do`s.',
      'Keep one, and write what both do in it.',
    ],
    [
      'as target for pull { tell { } do { } }',
      'k.sprout:2:24',
      '`as target for pull` holds a `permit`, a `do` and `<role> from …` lines, not `tell`.',
      'Write it as `as target for unlock { permit { … } do { … } }`.',
    ],
    [
      'as target for pull { permit allow }',
      'k.sprout:2:31',
      'What `permit` decides goes in braces.',
      'Write `permit { … }` inside `as target for pull`.',
    ],
    [
      'as target for pull { topic from do { } }',
      'k.sprout:2:34',
      '`topic from` names the property that holds its options, or a range of numbers.',
      'Write `topic from :<property>`, as in `topic from :knows`, or a range, as in `topic from 1 to 12`.',
    ],
    [
      'as target for pull { dial from 1 do { } }',
      'k.sprout:2:35',
      '`dial from 1` does not say where the range ends.',
      'Write `to` and the highest number: `dial from 1 to 12`.',
    ],
  ];
  for (const [text, at, message, remedy] of cases) {
    it(text, () => {
      const { plays, said } = readPlays(`${text}\n  :open true`);
      expect(said).toEqual([[at, message, remedy]]);
      expect(plays).toEqual([]);
    });
  }

  it('is never closed where the body’s next member starts inside it, said there, and the member kept', () => {
    const { kind, said } = readPlays('as target for pull { do { }\n  :open true');
    expect(said).toEqual([
      [
        'k.sprout:3:3',
        '`as target for pull` is never closed.',
        'Add a } after what it holds. Every { inside it, after a `permit`, a `do`, an `if` or an `else`, needs its own }.',
      ],
    ]);
    expect(kind!.members.map((m) => m.kind)).toEqual(['property']);
  });

  it('leaves the file’s end to the body, which says it is never closed once', () => {
    const { refusals } = read('kind Key {\n  as target for pull { do { }\n', 'k.sprout');
    expect(refusals.map((d) => d.message)).toEqual(['`Key` is never closed.']);
  });

  it('is written after a stray `}` as one member, its own braces stepped over', () => {
    const { refusals } = read(
      'kind Key {\n  }\n  as target for pull { do { self.set(:open, true) } }\n}\n',
      'k.sprout',
    );
    expect(refusals.map((d) => d.message)).toEqual([
      '`as target for pull` is written after the `}` that ends `Key`.',
    ]);
  });

  it('is not what a `without` with nothing in it leaves out', () => {
    const { kind, messages } = readPlays('without\n  as target for pull { do { } }');
    expect(messages).toEqual(['`without` does not say what to leave out.']);
    expect(kind!.members.map((m) => m.kind)).toEqual(['play']);
  });
});

// --- generated input -------------------------------------------------------
//
// The play reader's share of the parser's recovery rule, over bodies of
// well-formed plays and other members with one defective play among them:
// every well-formed member is kept whole, and nothing is said about the
// inside of one because of its neighbour. A play never closed may be said
// to end at the next member's first word, which is where it ran out.

const WELL_FORMED_PLAYS = [
  { name: 'key', text: KEY_PLAY },
  {
    name: 'guard',
    text: 'as target for ask {\n    topic from :knows\n    do { if (bound topic) { say toll } else { say "Nothing." } }\n  }',
  },
  {
    name: 'hand',
    text: 'as actor for take { permit { if (self.holds(target)) { refuse "Got it." } } }',
  },
];

const PLAY_DEFECTS: readonly string[] = [
  'as',
  'as target',
  'as target for',
  'as Target for pull { do { } }',
  'as target for Pull { do { } }',
  'as target for pull',
  'as target for pull { }',
  'as target for pull { topic from :knows }',
  'as target for pull { do { } do { } }',
  'as target for pull { permit { } permit { } }',
  'as target for pull { permit allow }',
  'as target for pull { tell "Hi." do { } }',
  'as target for pull { topic from }',
  'as target for pull { dial from 1 }',
  'as target for pull { dial from 1 to }',
  'as target for pull { do { refuse } }',
  'as target for pull { do { say } }',
  'as target for pull { do { if (bound) { } } }',
  'as target for pull { do { %% } }',
  'as for pull { do { } }',
];
const PLAY_UNCLOSED = 'as target for pull { do { say "Hi." }';

const NEIGHBOURS = [
  ...WELL_FORMED_PLAYS,
  ...WELL_FORMED_GUARDS.map(({ names, text }) => ({ name: names[0], text })),
  { name: 'open', text: ':open true' },
  { name: 'passage', text: 'passage full { There is no room in {self}. }' },
  { name: 'contains', text: 'contains' },
  { name: 'without', text: 'without as target for unlock from Lock' },
];

describe('a well-formed play never vanishes, and never answers for its neighbour', () => {
  it('over generated bodies with one defective play among well-formed members', () => {
    const c = chooser(20_260_923);
    const reached = new Set<string>();
    for (let i = 0; i < 600; i++) {
      const members = c.shuffled(NEIGHBOURS).filter(() => c.below(3) !== 0);
      if (members.length === 0) continue;
      const unclosed = c.below(8) === 0;
      const defect = unclosed ? PLAY_UNCLOSED : c.one(PLAY_DEFECTS);
      // The unclosed play takes the body's own `}` when it is last, and
      // then the body is never closed; that shape is the body's own.
      const at = unclosed ? c.below(members.length) : c.below(members.length + 1);
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
        if (kept?.kind === 'play') reached.add(`kept ${member.name}`);
        for (const d of refusals) {
          expect(d.at.start > start && d.at.start < end, `${text}\n  ${d.message}`).toBe(false);
        }
      }
      reached.add(unclosed ? 'unclosed' : 'contained');
    }
    expect([...reached].sort()).toEqual([
      'contained',
      'kept guard',
      'kept hand',
      'kept key',
      'unclosed',
    ]);
  });
});
