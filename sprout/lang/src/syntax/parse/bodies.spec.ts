import { describe, expect, it } from 'vitest';

import {
  writtenMember,
  type Declaration,
  type KindDeclaration,
  type ObjectDeclaration,
  type WorldDeclaration,
} from '../ast.js';
import { Diagnostics } from '../../source/diagnostics.js';
import { unspanned } from '../../source/nodes.js';
import { locationOf, SourceFile, textOf } from '../../source/source.js';
import { read } from '../../fixtures/parse.js';
import { apart, body, composition, kindMembers, writtenKind } from './bodies.js';
import { DECLARATION_READERS } from './declarations.js';
import { Parser } from './parser.js';

/** A parser over some text, for calling one reader directly. */
function parserOver(text: string) {
  const diagnostics = new Diagnostics();
  const p = new Parser(new SourceFile('b.sprout', text), diagnostics, DECLARATION_READERS);
  return { p, diagnostics };
}

/**
 * Each thing that holds a body, opened as it is written: the three share
 * one reader, so every rule below is asserted of all three, in the words
 * each is named by. An object is written in the body of what holds it,
 * so its text sits inside a world's, `around` it.
 */
const OWNERS = [
  {
    noun: 'world',
    article: 'A world',
    name: 'w',
    open: 'world w is sprout.World',
    holds: 'visitors',
    around: ['', ''],
  },
  { noun: 'kind', article: 'A kind', name: 'K', open: 'kind K', holds: null, around: ['', ''] },
  {
    noun: 'object',
    article: 'An object',
    name: 'o',
    open: 'object o is K',
    holds: null,
    around: ['world w is sprout.World {\n', '}\n'],
  },
] as const;
type Owner = (typeof OWNERS)[number];

/** The members every body holds, with `holds` first where the owner says one more. */
const membersOf = (owner: Owner): string =>
  `\`remembers\`, ${owner.holds === null ? '' : `\`${owner.holds}\`, `}\`contains\`, \`passage\`, \`without\`, \`depart\`, \`release\`, \`accept\`, \`as\` and \`object\``;

/**
 * The declaration a file's text opened with: a world or a kind, or, for
 * the object owner, the object in the world's body.
 */
const ownedIn = (declarations: readonly Declaration[], owner?: Owner) => {
  const top = declarations.find(
    (d): d is WorldDeclaration | KindDeclaration => d.kind === 'world' || d.kind === 'kind',
  );
  return owner?.noun === 'object' ? (top?.objects[0] as ObjectDeclaration | undefined) : top;
};
const owned = (declarations: readonly Declaration[]) => ownedIn(declarations);

/** A parser at `text` with the declaration's name taken, as its reader leaves it. */
function afterName(text: string) {
  const { p, diagnostics } = parserOver(text);
  return { p, diagnostics, name: p.next() };
}

describe('the kinds after `is`, read directly', () => {
  it('are none, and nothing is taken, where no `is` follows', () => {
    const { p, diagnostics, name } = afterName('K { }');
    expect(composition(p, 'kind', name)).toEqual([]);
    expect(p.peek().text).toBe('{');
    expect(diagnostics.refusals).toEqual([]);
  });

  it('are what was written, up to the first thing that is not one', () => {
    const { p, name } = afterName('o is Crate, sprout.Container {');
    const composes = composition(p, 'object', name);
    expect(composes?.map((c) => textOf(c.at))).toEqual(['Crate', 'sprout.Container']);
    expect(p.peek().text).toBe('{');
  });

  it('are null, having said why, where one cannot be read', () => {
    const { p, diagnostics, name } = afterName('K is Crate, 4 { }');
    expect(composition(p, 'kind', name)).toBeNull();
    expect(diagnostics.refusals.map((d) => d.message)).toEqual([
      'the number 4 is not the name of a kind.',
    ]);
  });

  it('name their owner when a comma is missing, and show how it is written', () => {
    for (const [owner, remedy] of [
      ['world', 'Write `world <name> is one.Kind, Another { … }`.'],
      ['kind', 'Write `kind <Name> is one.Kind, Another { … }`.'],
      ['object', 'Write `object <name> is one.Kind, Another { … }`.'],
    ] as const) {
      const { p, diagnostics, name } = afterName('x is Crate Heavy {');
      expect(composition(p, owner, name)?.length, owner).toBe(2);
      expect(diagnostics.refusals.map((d) => d.remedy)).toEqual([remedy]);
    }
  });

  it('are read after a colon in place of `is`, which is refused, and the line shown with `is`', () => {
    for (const [owner, text, kinds, remedy] of [
      [
        'world',
        'shop: sprout.World, victorian.Voice {',
        ['sprout.World', 'victorian.Voice'],
        'Write `world shop is sprout.World, victorian.Voice { … }`.',
      ],
      [
        'kind',
        'Crate: sprout.Container {',
        ['sprout.Container'],
        'Write `kind Crate is sprout.Container { … }`.',
      ],
      ['object', 'bench: Bench {', ['Bench'], 'Write `object bench is Bench { … }`.'],
    ] as const) {
      const { p, diagnostics, name } = afterName(text);
      expect(
        composition(p, owner, name)?.map((c) => textOf(c.at)),
        owner,
      ).toEqual(kinds);
      const article = OWNERS.find((o) => o.noun === owner)!.article;
      expect(diagnostics.refusals.map((d) => [locationOf(d.at), d.message, d.remedy])).toEqual([
        [
          `b.sprout:1:${text.indexOf(':') + 1}`,
          `${article} composes its kinds with \`is\`, not a colon.`,
          remedy,
        ],
      ]);
      expect(p.peek().text).toBe('{');
    }
  });

  it('refuse the colon with a kind left to name where what follows it is not one', () => {
    const { p, diagnostics, name } = afterName('Crate: 4 { }');
    expect(composition(p, 'kind', name)).toBeNull();
    expect(diagnostics.refusals.map((d) => [d.message, d.remedy])).toEqual([
      [
        'the number 4 is not the name of a kind.',
        'A kind starts with a capital letter, as in `Creature` or `sprout.Container`.',
      ],
      ['A kind composes its kinds with `is`, not a colon.', 'Write `kind Crate is <Kind> { … }`.'],
    ]);
  });
});

describe('a kind as it was written, for a remedy', () => {
  it('keeps its library where one was written', () => {
    const { p, name } = afterName('K is sprout.Container, Crate {');
    expect(composition(p, 'kind', name)?.map(writtenKind)).toEqual(['sprout.Container', 'Crate']);
  });
});

describe('the members of a body, apart from the objects written in it', () => {
  it('splits what was read, keeping each side in the order written', () => {
    const { declarations } = read(
      'world w is sprout.World {\n  object a is K\n  :x 1\n  object b is K\n  contains\n}\n',
    );
    const world = owned(declarations) as WorldDeclaration;
    const both = [...world.members, ...world.objects].sort((m, n) => m.at.start - n.at.start);
    const { members, objects } = apart(
      both,
      (m): m is (typeof world.members)[number] => m.kind !== 'object',
    );
    expect(members.map((m) => m.kind)).toEqual(['property', 'contains']);
    expect(objects.map((o) => o.name.text)).toEqual(['a', 'b']);
  });
});

describe('a body, read directly', () => {
  it('reads to its own brace and hands that brace back', () => {
    const { p, diagnostics } = parserOver('K { :open true\n contains } after');
    const name = p.next();
    p.next();
    const read = body(
      p,
      'kind',
      name,
      kindMembers(p, 'K', () => null),
    );
    expect(diagnostics.refusals).toEqual([]);
    expect(read?.members.map((m) => m.kind)).toEqual(['property', 'contains']);
    expect(read?.close.text).toBe('}');
    expect(p.peek().text).toBe('after');
  });

  it('is null, having said so under the name it was given, where it is never closed', () => {
    const { p, diagnostics } = parserOver('K { :open true');
    const name = p.next();
    p.next();
    expect(
      body(
        p,
        'kind',
        name,
        kindMembers(p, 'K', () => null),
      ),
    ).toBeNull();
    expect(diagnostics.refusals.map((d) => d.message)).toEqual(['`K` is never closed.']);
  });
});

describe('a world, a kind and an object read their bodies by one rule', () => {
  for (const owner of OWNERS) {
    const opened = (members: string) =>
      read(`${owner.around[0]}${owner.open} {\n  ${members}\n}\n${owner.around[1]}`);
    const owned = (declarations: readonly Declaration[]) => ownedIn(declarations, owner);

    it(`${owner.noun}: holds its properties, a \`remembers\` block and \`contains\``, () => {
      const { declarations, refusals } = opened(':a 1\n  remembers { :b 2 }\n  contains actors');
      expect(refusals).toEqual([]);
      expect(owned(declarations)!.members.map((m) => m.kind)).toEqual([
        'property',
        'remembers',
        'contains',
      ]);
    });

    it(`${owner.noun}: names itself and what it holds when a word is no member`, () => {
      const { declarations, refusals } = opened('nonsense\n  :a 1');
      expect(refusals.map((d) => [d.message, d.remedy])).toEqual([
        [
          `${owner.article} is not made of \`nonsense\`.`,
          `It holds its properties, ${membersOf(owner)}.`,
        ],
      ]);
      expect(owned(declarations)!.members.map((m) => m.kind)).toEqual(['property']);
    });

    it(`${owner.noun}: reads on past a member it could not read`, () => {
      // A list is stepped over whole, so `:wet` inside it is not a member.
      const { declarations, refusals } = opened(':a Zeta [oak, :wet]\n  :b Ward.Iron\n  :c 1');
      expect(refusals).toHaveLength(2);
      expect(
        owned(declarations)!.members.map((m) => (m.kind === 'property' ? m.name.text : m.kind)),
      ).toEqual(['c']);
    });

    it(`${owner.noun}: says it is never closed, in its own noun`, () => {
      // An object never closed leaves the world around it never closed too.
      const { refusals } = read(`${owner.around[0]}${owner.open} {\n  :a 1\n`);
      expect(refusals.map((d) => [d.message, d.remedy])).toEqual([
        [`\`${owner.name}\` is never closed.`, `Add a } after what the ${owner.noun} is made of.`],
        ...(owner.noun === 'object'
          ? [['`w` is never closed.', 'Add a } after what the world is made of.']]
          : []),
      ]);
    });

    it(`${owner.noun}: ends at a declaration written inside it, which is the file's`, () => {
      const { declarations, refusals } = opened('enum Inner { oak }');
      expect(refusals.map((d) => d.message)).toContain(`\`${owner.name}\` is never closed.`);
      expect(refusals.map((d) => d.message)).not.toContain(
        `${owner.article} is not made of \`enum\`.`,
      );
      expect(declarations.map((d) => d.name.text)).toContain('Inner');
    });
  }

  it('names every member written after a stray `}` that ends a kind too early', () => {
    // A brace count alone cannot tell a stray `}` from the kind's own,
    // so what follows it is named rather than lost the way stepping
    // straight to the next declaration would lose it — as `bodies.ts`
    // holds for a world, a kind and an object alike.
    const { declarations, refusals } = read(`kind K is sprout.Container {
  :alpha 0
  }
  :bravo 1
  contains actors
}
`);
    const kind = owned(declarations)!;
    expect(kind.members.map((m) => (m.kind === 'property' ? m.name.text : m.kind))).toEqual([
      'alpha',
    ]);
    expect(refusals.map((d) => [d.message, d.remedy])).toEqual([
      [
        '`:bravo` and `contains` are written after the `}` that ends `K`.',
        'Everything `K` is made of goes inside its braces. Take out the `}` that ends it too early.',
      ],
    ]);
  });

  it('names a guard written after a stray `}` by its word, and steps over its block', () => {
    // The guard's own braces are not members, and not the scan's end:
    // what comes after the guard is named too.
    const { declarations, refusals } = read(`kind K {
  :alpha 0
  }
  depart (to) { if (mover != self) { refuse "No." } }
  :bravo 1
}
`);
    expect(
      owned(declarations)!.members.map((m) => (m.kind === 'property' ? m.name.text : m.kind)),
    ).toEqual(['alpha']);
    expect(refusals.map((d) => d.message)).toEqual([
      '`depart` and `:bravo` are written after the `}` that ends `K`.',
    ]);
  });

  it('names the entries of a `remembers` block written after a stray `}`, one by one', () => {
    // A block after the stray brace is named entry by entry, so the
    // remedy says which memory was lost and not merely that one was.
    const { declarations, refusals } = read(`kind K is sprout.Container {
  :alpha 0
  }
  remembers { :visits 0 :greeted false }
}
`);
    expect(
      owned(declarations)!.members.map((m) => (m.kind === 'property' ? m.name.text : m.kind)),
    ).toEqual(['alpha']);
    expect(refusals.map((d) => d.message)).toEqual([
      '`:visits` and `:greeted` are written after the `}` that ends `K`.',
    ]);
  });

  it("reads the members after a `}` that was already refused as a property's value", () => {
    // The `}` right after `:faulty` was already refused as its value:
    // that refusal, and not a brace count, is what tells the reader this
    // `}` is not `w`'s own, so the members before the real one are read
    // rather than merely named as displaced.
    const { declarations, refusals } = read(`world w is sprout.World {
  :faulty }
  visitors are P
  visitors arrive at y
}
`);
    const world = owned(declarations)!;
    expect(world.members.map((m) => m.kind)).toEqual(['visitors-are', 'visitors-arrive-at']);
    expect(refusals.map((d) => [d.message, d.remedy])).toEqual([
      [
        '`}` is not a value.',
        'Write `true` or `false`, a whole number, text in quotes, an option of an enum, or a list.',
      ],
    ]);
  });

  it('names two members after a stray `}` once, where both read the same way', () => {
    // `visitors are` and `visitors arrive at` are both looked up by
    // `visitors`, the only word the member table itself knows; naming
    // each occurrence again would read as if the same word had been
    // written twice.
    const { declarations, refusals } = read(`world w is sprout.World {
  :alpha 0
  }
  visitors are P
  visitors arrive at y
}
`);
    expect(
      owned(declarations)!.members.map((m) => (m.kind === 'property' ? m.name.text : m.kind)),
    ).toEqual(['alpha']);
    expect(refusals.map((d) => d.message)).toEqual([
      '`visitors` is written after the `}` that ends `w`.',
    ]);
  });
});

describe('`without` names a member and the kind it comes from, in any body', () => {
  /** The `without` lines a body read, each as the member and kind it names. */
  const withouts = (declarations: readonly Declaration[], owner?: Owner) =>
    ownedIn(declarations, owner)!.members.flatMap((m) =>
      m.kind === 'without' ? [`${writtenMember(m.member)} from ${textOf(m.source.at)}`] : [],
    );

  for (const owner of OWNERS) {
    it(`${owner.noun}: reads each member form the spec's table says every source of runs`, () => {
      const lines = [
        'without changed :lit from sprout.LightSource',
        'without on :stir from Bellows',
        'without depart from sprout.Fixture',
        'without release from Crate',
        'without accept from Crate',
        'without as target for unlock from Lock',
      ];
      const { declarations, refusals } = read(
        `${owner.around[0]}${owner.open} {\n  ${lines.join('\n  ')}\n}\n${owner.around[1]}`,
      );
      expect(refusals).toEqual([]);
      expect(withouts(declarations, owner)).toEqual(
        lines.map((line) => line.slice('without '.length)),
      );
      const first = ownedIn(declarations, owner)!.members[0]!;
      expect(textOf(first.at)).toBe(lines[0]);
      expect(unspanned(declarations)).toEqual([]);
    });
  }

  /** Each refusal as its place, its words and its remedy, in a kind's body. */
  const said = (line: string) =>
    read(`kind K {\n  ${line}\n  :a 1\n}\n`, 'k.sprout').refusals.map((d) => [
      locationOf(d.at),
      d.message,
      d.remedy,
    ]);
  const EXAMPLE = '`without changed :lit from sprout.LightSource`';

  it('refuses one that names nothing, at the word, and reads the member after it', () => {
    const missing = [
      'k.sprout:2:3',
      '`without` does not say what to leave out.',
      `Name a handler, a hook, a guard or a role, and the kind it comes from: ${EXAMPLE}.`,
    ];
    expect(said('without')).toEqual([missing]);
    expect(said('without from Crate')).toEqual([missing]);
    const { declarations } = read('kind K {\n  without\n  :a 1\n}\n');
    expect(owned(declarations)!.members.map((m) => m.kind)).toEqual(['property']);
  });

  it('refuses a member that is none of the forms, at it, and does not read it as a member', () => {
    expect(said('without :x from Crate')).toEqual([
      [
        'k.sprout:2:11',
        '`without` names a handler, a hook, a guard or a role, not `:x`, which is a property or a message.',
        `A handler is written \`on :x\` and a hook \`changed :x\`, as in ${EXAMPLE}.`,
      ],
    ]);
    expect(said('without nonsense from Crate')).toEqual([
      [
        'k.sprout:2:11',
        '`without` names a handler, a hook, a guard or a role, not `nonsense`.',
        `Write one as it is declared: \`on :<message>\`, \`changed :<property>\`, \`depart\`, \`release\`, \`accept\` or \`as <role> for <verb>\`, as in ${EXAMPLE}.`,
      ],
    ]);
    const { declarations } = read('kind K {\n  without :x from Crate\n  :a 1\n}\n');
    expect(
      owned(declarations)!.members.map((m) => (m.kind === 'property' ? m.name.text : m.kind)),
    ).toEqual(['a']);
  });

  it('refuses a handler or a hook with no name, and a role with half of one', () => {
    expect(said('without on from Bellows')).toEqual([
      [
        'k.sprout:2:14',
        '`on` names the message a handler answers, with its colon.',
        'Write `without on :<message> from <Kind>`, as in `without on :stir from Bellows`.',
      ],
    ]);
    expect(said('without changed')).toEqual([
      [
        'k.sprout:2:18',
        '`changed` names the property a hook watches, with its colon.',
        `Write \`without changed :<property> from <Kind>\`, as in ${EXAMPLE}.`,
      ],
    ]);
    expect(said('without as target unlock from Lock')).toEqual([
      [
        'k.sprout:2:21',
        '`as` names a role and the verb it plays it for.',
        'Write `without as <role> for <verb> from <Kind>`, as in `without as target for unlock from Lock`.',
      ],
    ]);
  });

  it('refuses a member with no `from`, just after the member', () => {
    expect(said('without accept')).toEqual([
      [
        'k.sprout:2:17',
        '`without accept` does not say which kind it comes from.',
        `Write \`from\` and the kind that declares it: \`without accept from <Kind>\`, as in ${EXAMPLE}.`,
      ],
    ]);
  });

  it('refuses a passage, at the word, since writing one replaces it, and reads on', () => {
    const remedy = (name: string) =>
      `Write your own \`passage ${name} { … }\` in this body instead: a body's own passage is the one that applies.`;
    const message = '`without` does not leave out a passage.';
    expect(said('without passage immovable from sprout.Fixture')).toEqual([
      ['k.sprout:2:11', message, remedy('immovable')],
    ]);
    expect(said('without passage immovable { It stays. }')).toEqual([
      ['k.sprout:2:11', message, remedy('immovable')],
    ]);
    expect(said('without passage from sprout.Fixture')).toEqual([
      ['k.sprout:2:11', message, remedy('<name>')],
    ]);
    for (const line of ['without passage immovable', 'without passage immovable { It stays. }']) {
      const { declarations } = read(`kind K {\n  ${line}\n  :a 1\n  contains\n}\n`);
      expect(
        owned(declarations)!.members.map((m) => m.kind),
        line,
      ).toEqual(['property', 'contains']);
    }
  });

  it('refuses a `from` that names no kind, at what it names or just after it', () => {
    const remedy = `Name it as it is composed, with its capital: ${EXAMPLE}.`;
    expect(said('without accept from 4')).toEqual([
      ['k.sprout:2:23', 'After `from` comes the kind that declares `accept`.', remedy],
    ]);
    expect(said('without accept from')).toEqual([
      ['k.sprout:2:22', 'After `from` comes the kind that declares `accept`.', remedy],
    ]);
  });
});

describe('a body never closed', () => {
  it('says so where the file ends', () => {
    const { refusals } = read('kind K {\n  :a 1\n', 'k.sprout');
    expect(refusals.map((d) => [d.message, d.remedy])).toEqual([
      ['`K` is never closed.', 'Add a } after what the kind is made of.'],
    ]);
  });

  it('says nothing more when a comment or a passage never closed took its `}`', () => {
    for (const text of [
      'kind K {\n  :a 1\n  /* the rest\n}\n',
      'kind K {\n  passage greeting { Hello, {actor.\n}\n',
    ]) {
      const { refusals } = read(text, 'k.sprout');
      expect(refusals, text).toHaveLength(1);
      expect(refusals[0]!.message, text).toMatch(/never closed/);
      expect(refusals[0]!.message, text).not.toMatch(/`K`/);
    }
  });

  it('names the passage it ends with, whose slot may have taken its `}`', () => {
    const text = 'kind K {\n  passage greeting { A {slot.\n  }\n}\nenum Ward { oak }\n';
    const { declarations, refusals } = read(text, 'k.sprout');
    expect(refusals.map((d) => [locationOf(d.at), d.message, d.remedy])).toEqual([
      [
        'k.sprout:5:1',
        '`K` is never closed.',
        'Add a } after what the kind is made of. If there is one, a { inside the passage `greeting` has no } of its own, and took it.',
      ],
    ]);
    expect(declarations.map((d) => d.kind)).toEqual(['enum']);
  });
});

describe('`without` beside a guard', () => {
  /** A kind's body, its members by kind, and what was said. */
  const readKind = (members: string) => {
    const { declarations, refusals } = read(`kind Crate {\n  ${members}\n}\n`, 'k.sprout');
    const kind = declarations[0] as KindDeclaration;
    return {
      members: kind.members.map((m) => m.kind),
      said: refusals.map((d) => d.message),
    };
  };

  it('names a guard by its word, and leaves a guard written after it alone', () => {
    expect(readKind('without depart from Fixture\n  depart (to) { allow }')).toEqual({
      members: ['without', 'guard'],
      said: [],
    });
  });

  it('with nothing named, does not take the guard written after it for what it leaves out', () => {
    expect(readKind('without\n  depart (to) { allow }')).toEqual({
      members: ['guard'],
      said: ['`without` does not say what to leave out.'],
    });
  });
});

describe('objects written in a body', () => {
  it('are held apart from its members, each holding what is written in its own', () => {
    const { declarations, refusals } = read(`world w is sprout.World {
  visitors are P
  object hall is Room {
    :lit true
    object chest is Chest {
      object key is Key
    }
    object bench is Bench
  }
  visitors arrive at hall
  object yard is Room
}
`);
    expect(refusals).toEqual([]);
    const world = owned(declarations) as WorldDeclaration;
    expect(world.members.map((m) => m.kind)).toEqual(['visitors-are', 'visitors-arrive-at']);
    expect(world.objects.map((o) => o.name.text)).toEqual(['hall', 'yard']);
    const hall = world.objects[0]!;
    expect(hall.members.map((m) => m.kind)).toEqual(['property']);
    expect(hall.objects.map((o) => o.name.text)).toEqual(['chest', 'bench']);
    expect(hall.objects[0]!.objects.map((o) => o.name.text)).toEqual(['key']);
    expect(unspanned(declarations)).toEqual([]);
  });

  it('are read in a kind’s body too, where the declaration layer says what it makes of them', () => {
    const { declarations, refusals } = read(
      'kind Lantern {\n  contains\n  object wick is Wick\n}\n',
    );
    expect(refusals).toEqual([]);
    const kind = owned(declarations) as KindDeclaration;
    expect(kind.members.map((m) => m.kind)).toEqual(['contains']);
    expect(kind.objects.map((o) => o.name.text)).toEqual(['wick']);
  });

  it('leave what follows an object’s `}` to the body around it, where it was written', () => {
    const { declarations, refusals } = read(
      'world w is sprout.World {\n  object hall is Room { :lit true }\n  :season 1\n  visitors are P\n}\n',
    );
    expect(refusals).toEqual([]);
    const world = owned(declarations) as WorldDeclaration;
    expect(world.members.map((m) => m.kind)).toEqual(['property', 'visitors-are']);
    expect(world.objects[0]!.members.map((m) => m.kind)).toEqual(['property']);
  });

  it('are where stepping over a member that could not be read stops', () => {
    const { declarations, refusals } = read(
      'world w is sprout.World {\n  :faulty Zeta [oak]\n  object hall is Room\n  :after 1\n}\n',
    );
    expect(refusals.length).toBeGreaterThan(0);
    const world = owned(declarations) as WorldDeclaration;
    expect(world.objects.map((o) => o.name.text)).toEqual(['hall']);
    expect(world.members.map((m) => (m.kind === 'property' ? m.name.text : m.kind))).toEqual([
      'after',
    ]);
  });
});
