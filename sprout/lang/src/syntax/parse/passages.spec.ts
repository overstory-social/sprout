import { describe, expect, it } from 'vitest';

import type {
  Declaration,
  KindDeclaration,
  ObjectDeclaration,
  PassageDeclaration,
  WorldDeclaration,
  WorldMember,
} from '../ast.js';
import { Diagnostics } from '../../source/diagnostics.js';
import { unspanned } from '../../source/nodes.js';
import { locationOf, SourceFile, textOf } from '../../source/source.js';
import { tokenise } from '../lexer.js';
import { chooser, read } from '../../fixtures/parse.js';
import { isPassage } from './passages.js';

/**
 * Each thing that may hold a passage, opened and closed as it is written;
 * an object in the body of a world, which holds it.
 */
const OWNERS = [
  { kind: 'world', open: 'world w is sprout.World {', close: '}' },
  { kind: 'kind', open: 'kind K {', close: '}' },
  { kind: 'object', open: 'world w is sprout.World {\nobject o is K {', close: '}\n}' },
] as const;

/** The body a file's text opened with: a world's or a kind's, or the object's in a world. */
const owned = (
  declarations: readonly Declaration[],
): WorldDeclaration | KindDeclaration | ObjectDeclaration | undefined => {
  const top = declarations.find(
    (d): d is WorldDeclaration | KindDeclaration => d.kind === 'world' || d.kind === 'kind',
  );
  return top?.kind === 'world' && top.objects.length > 0 ? top.objects[0] : top;
};

/** The passages a body read. */
function passagesOf(declarations: readonly Declaration[]): PassageDeclaration[] {
  const members: readonly WorldMember[] = owned(declarations)?.members ?? [];
  return members.filter(isPassage);
}

/** Every member a body read, a passage by its name and a property by its own. */
const membersOf = (declarations: readonly Declaration[]): string[] =>
  owned(declarations)?.members.map((m) =>
    m.kind === 'passage'
      ? `passage ${m.name.text}`
      : m.kind === 'property'
        ? `:${m.name.text}`
        : m.kind,
  ) ?? [];

describe('a passage, as a world, a kind and an object write one', () => {
  for (const owner of OWNERS) {
    it(`${owner.kind}: reads its name, whether it yields, and its words as written`, () => {
      const text = `${owner.open}\n  passage greeting {\n    It's late. Who's there?\n  }\n  passage taken default { You take {target}. }\n  :a 1\n${owner.close}\n`;
      const { declarations, refusals } = read(text, 'k.sprout');
      expect(refusals).toEqual([]);
      expect(unspanned(declarations)).toEqual([]);
      const [greeting, taken] = passagesOf(declarations);
      expect([greeting!.name.text, greeting!.yields, greeting!.body.text]).toEqual([
        'greeting',
        false,
        "\n    It's late. Who's there?\n  ",
      ]);
      expect([taken!.name.text, taken!.yields, taken!.body.text]).toEqual([
        'taken',
        true,
        ' You take {target}. ',
      ]);
      expect(textOf(taken!.at)).toBe('passage taken default { You take {target}. }');
      expect(locationOf(taken!.name.at)).toBe(`k.sprout:${owner.kind === 'object' ? 6 : 5}:11`);
      expect(membersOf(declarations)).toEqual(['passage greeting', 'passage taken', ':a']);
    });
  }

  it("reads the standard library's stock lines as the spec writes them", () => {
    const text = `kind World {
  contains

  passage unknown default         { That is not something you can do here. }
  passage which default           { Which do you mean: {for thing of candidates}{thing}{if $last}?{else}, {/if}{/for} }
  passage nothing_happens default { Nothing much comes of that. }
}

kind Actor {
  passage inventory default   {
    {if self.count == 0}You are carrying nothing.{else}
    You are carrying {for thing in self}{thing}{if $last}.{else}, {/if}{/for}{/if}
  }
  passage held_fast default   { {self} is not something you can carry off. }
}
`;
    const { declarations, refusals } = read(text);
    expect(refusals).toEqual([]);
    expect(
      declarations.flatMap((d) =>
        d.kind === 'kind'
          ? d.members.filter(isPassage).map((m) => `${m.name.text}:${m.yields}`)
          : [],
      ),
    ).toEqual([
      'unknown:true',
      'which:true',
      'nothing_happens:true',
      'inventory:true',
      'held_fast:true',
    ]);
  });

  it('tells a passage from every other member', () => {
    const { declarations } = read('kind K {\n  passage p { . }\n  :a 1\n  contains\n}\n');
    expect(owned(declarations)!.members.map(isPassage)).toEqual([true, false, false]);
  });
});

describe('a header that cannot be read is refused at its defect, and costs nothing after it', () => {
  /** Each refusal as its place, its words and its remedy, with the members read after it. */
  const said = (line: string) => {
    const { declarations, refusals } = read(
      `kind K {\n  ${line}\n  :a 1\n  contains\n}\n`,
      'k.sprout',
    );
    return {
      refusals: refusals.map((d) => [locationOf(d.at), d.message, d.remedy]),
      members: membersOf(declarations),
    };
  };
  const AFTER = [':a', 'contains'];

  const CASES: readonly [string, string, string, string][] = [
    [
      'passage { Hello. }',
      'k.sprout:2:11',
      'A passage needs a name.',
      "A passage's name is a lower-case word before its braces: `passage greeting { … }`.",
    ],
    [
      'passage default { Hello. }',
      'k.sprout:2:11',
      'A passage needs a name.',
      "A passage's name comes before `default`: `passage greeting default { … }`.",
    ],
    [
      'passage Greeting { Hello. }',
      'k.sprout:2:11',
      "A passage's name starts with a lower-case letter, and `Greeting` starts with a capital.",
      'Write `passage greeting { … }`.',
    ],
    [
      'passage HeldFast { Hello. }',
      'k.sprout:2:11',
      "A passage's name starts with a lower-case letter, and `HeldFast` starts with a capital.",
      'Write `passage held_fast { … }`.',
    ],
    [
      'passage default greeting { Hello. }',
      'k.sprout:2:11',
      "`default` comes after a passage's name.",
      'Write `passage greeting default { … }`.',
    ],
    [
      'passage greeting please { Hello. }',
      'k.sprout:2:20',
      "Only `default` may stand between a passage's name and its braces, not `please`.",
      'A passage is written `passage greeting { … }`, with `default` after the name where any other passage of that name should replace it: `passage greeting default { … }`.',
    ],
    [
      'passage greeting default Please { Hello. }',
      'k.sprout:2:28',
      "Only `default` may stand between a passage's name and its braces, not `Please`, which starts with a capital.",
      'A passage is written `passage greeting { … }`, with `default` after the name where any other passage of that name should replace it: `passage greeting default { … }`.',
    ],
    [
      'passage "greeting" { Hello. }',
      'k.sprout:2:11',
      "A passage's name is not written in quotes.",
      'Write it as a bare lower-case word: `passage greeting { … }`.',
    ],
    [
      'passage "Good day" { Hello. }',
      'k.sprout:2:11',
      "A passage's name is not written in quotes.",
      'Write it as a bare lower-case word: `passage greeting { … }`.',
    ],
    [
      'passage :greeting { Hello. }',
      'k.sprout:2:11',
      "A passage's name has no colon before it.",
      'Write `passage greeting { … }`; a colon is how a property or a message is named.',
    ],
    [
      'passage 4 { Hello. }',
      'k.sprout:2:11',
      'the number 4 cannot name a passage.',
      "A passage's name is a lower-case word: `passage greeting { … }`.",
    ],
    [
      'passage greeting',
      'k.sprout:2:19',
      'The passage `greeting` has no braces.',
      'A passage holds its words in braces, even when it has few: `passage greeting { … }`.',
    ],
    [
      'passage greeting default',
      'k.sprout:2:27',
      'The passage `greeting` has no braces.',
      'A passage holds its words in braces, even when it has few: `passage greeting default { … }`.',
    ],
    [
      'passage',
      'k.sprout:2:10',
      'A passage needs a name, and its words in braces.',
      "Write `passage greeting { … }`, with the passage's words between the braces.",
    ],
  ];

  for (const [line, at, message, remedy] of CASES) {
    it(`\`${line}\``, () => {
      const { refusals, members } = said(line);
      expect(refusals).toEqual([[at, message, remedy]]);
      expect(members).toEqual(AFTER);
    });
  }

  it('says nothing more of a header word the lexer already refused a character in', () => {
    const { refusals, members } = said("passage greet'ing { Hello. }");
    expect(refusals.map(([, message]) => message)).toEqual([
      'Sprout does not use the character "\'".',
    ]);
    expect(members).toEqual(AFTER);
  });

  it('never takes a member on the line after a header left without braces', () => {
    for (const next of [
      'contains actors',
      ':b 2',
      'without accept from Crate',
      'passage b { . }',
    ]) {
      const { declarations } = read(`kind K {\n  passage greeting\n  ${next}\n}\n`);
      expect(membersOf(declarations), next).toHaveLength(1);
    }
  });

  it("surfaces the lexer's refusals of a body as problems in the file, at the body", () => {
    const escape = said('passage greeting { C:\\attic }');
    expect(escape.refusals).toEqual([
      [
        'k.sprout:2:24',
        'A backslash inside a passage means one of \\" , \\\\ , \\n or \\{.',
        'Write \\\\ if you meant a backslash of its own.',
      ],
    ]);
    expect(escape.members).toEqual(['passage greeting', ...AFTER]);
    const { refusals } = read('kind K {\n  passage greeting { {a {b\n}\n', 'k.sprout');
    expect(refusals.map((d) => [locationOf(d.at), d.message])).toEqual([
      ['k.sprout:2:20', 'The passage `greeting` opens here and is never closed.'],
    ]);
  });
});

describe('over generated bodies of members, a passage is never lost to a neighbour', () => {
  // Well-formed passages, with generated names, headers and words, sit
  // among properties and `contains`, and header defects are put between
  // them anywhere. Every well-formed member is kept, exactly; nothing
  // appears that was not written well; and no problem is ever found inside
  // a well-formed passage's words. A body with a bad escape is written now
  // and then too: the one thing that may be found inside a body is that.
  const HEADER_DEFECTS = [
    'passage',
    'passage { Hi. }',
    'passage default { Hi. }',
    'passage default hello { Hi. }',
    'passage Hello { Hi. }',
    'passage hello extra { Hi. }',
    'passage hello default extra { Hi. }',
    'passage "hello" { Hi. }',
    'passage :hello { Hi. }',
    'passage 4 { Hi. }',
    'passage hello',
    'passage hello default',
    "passage hel'lo { Hi. }",
    'without passage hello',
    'without passage hello from K',
    'without passage hello { Hi. }',
  ];
  const WORDS = [
    "It's late.",
    'Who is there?',
    '50% // of it',
    '/* not a comment',
    '"quoted"',
    '{thing}',
    '{if self.get(:lit)}lit{else}dark{/if}',
    '{for x in self}{x}{if $last}.{else}, {/if}{/for}',
    '{say("}{")}',
    '\\{',
    '\\"',
    '\\\\',
    '\\n',
    '\n',
    '\n\n',
  ];
  const BACKSLASH = 'A backslash inside a passage means one of \\" , \\\\ , \\n or \\{.';

  for (const [n, owner] of OWNERS.entries()) {
    it(`${owner.kind}`, () => {
      const c = chooser(20_260_923 + n);
      let escapes = 0;
      let kept = 0;
      for (let i = 0; i < 600; i++) {
        const passages = ['alpha', 'bravo', 'charlie']
          .filter(() => c.below(4) !== 0)
          .map((name) => {
            const yields = c.below(2) === 0;
            const escaped = c.below(10) === 0;
            const words = Array.from({ length: c.below(6) }, () => c.one(WORDS));
            if (escaped) words.splice(c.below(words.length + 1), 0, 'C:\\attic');
            const body = words.join(' ');
            return {
              name,
              yields,
              body,
              escaped,
              text: `passage ${name}${yields ? ' default' : ''}${c.one([' ', '  ', '\t'])}{${body}}`,
            };
          });
        const others = [':delta 1', ':echo "x"', 'contains'].filter(() => c.below(2) === 0);
        const lines = c.shuffled([...passages.map((p) => p.text), ...others]);
        for (let d = 0; d < 1 + c.below(2); d++) {
          lines.splice(c.below(lines.length + 1), 0, c.one(HEADER_DEFECTS));
        }
        const text = `${owner.open}\n  ${lines.join('\n  ')}\n${owner.close}\n`;
        const { declarations, refusals } = read(text, 'g.sprout');

        expect(refusals.length, `${text}\n  nothing was wrong with it`).toBeGreaterThan(0);
        const found = passagesOf(declarations);
        expect(
          found.map((p) => [p.name.text, p.yields, p.body.text]),
          text,
        ).toEqual(
          passages
            .filter((p) => lines.includes(p.text))
            .sort((a, b) => lines.indexOf(a.text) - lines.indexOf(b.text))
            .map((p) => [p.name, p.yields, p.body]),
        );
        const members = membersOf(declarations).filter((m) => !m.startsWith('passage '));
        expect(members.sort(), text).toEqual(
          others.map((o) => (o.startsWith(':') ? o.split(' ')[0]! : o)).sort(),
        );

        for (const passage of found) {
          const inside = refusals.filter(
            (d) => d.at.start >= passage.body.at.start && d.at.start < passage.body.at.end,
          );
          const written = passages.find((p) => p.name === passage.name.text)!;
          if (written.escaped) escapes += 1;
          expect(
            inside.map((d) => d.message),
            `${text}\n  a problem was found inside \`${passage.name.text}\``,
          ).toEqual(written.escaped ? [BACKSLASH] : []);
          kept += 1;
        }

        // And of every body in the file, the defects' included: past its
        // opening brace, the only problem is a backslash.
        const bodies = tokenise(new SourceFile('g.sprout', text), new Diagnostics()).filter(
          (t) => t.kind === 'passage-body',
        );
        for (const body of bodies) {
          const inside = refusals.filter(
            (d) => d.at.start > body.at.start && d.at.start < body.at.end,
          );
          expect(
            inside.filter((d) => d.message !== BACKSLASH),
            `${text}\n  a problem was found inside ${textOf(body.at)}`,
          ).toEqual([]);
        }
      }
      expect(escapes).toBeGreaterThan(0);
      expect(kept).toBeGreaterThan(600);
    });
  }
});
