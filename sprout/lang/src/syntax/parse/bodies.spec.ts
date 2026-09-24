import { describe, expect, it } from 'vitest';

import type { WorldMember } from '../ast.js';
import { unspanned } from '../../source/nodes.js';
import { locationOf } from '../../source/source.js';
import { parserOver, readBody, rest } from '../../fixtures/readers.js';
import { apart, body, kindMembers } from './bodies.js';

/**
 * Each thing that holds a body, opened as it is written: the three share
 * one reader, so every rule below is asserted of all three, in the words
 * each is named by. An object's body is read as one written inside
 * another body is, so what follows its `}` is left to that body.
 */
const OWNERS = [
  {
    noun: 'world',
    article: 'A world',
    name: 'w',
    open: 'world w is sprout.World',
    holds: 'visitors',
  },
  { noun: 'kind', article: 'A kind', name: 'K', open: 'kind K', holds: null },
  { noun: 'object', article: 'An object', name: 'o', open: 'object o is K', holds: null },
] as const;
type Owner = (typeof OWNERS)[number];

/** The members every body holds, with `holds` first where the owner says one more, and `grammar` and `describe` where it is a thing's. */
const membersOf = (owner: Owner): string =>
  `\`remembers\`, ${owner.holds === null ? '' : `\`${owner.holds}\`, `}\`contains\`, \`passage\`, \`prose\`, \`without\`, ${owner.holds === null ? '`grammar`, `describe`, ' : ''}\`depart\`, \`release\`, \`accept\`, \`as\`, \`on\`, \`changed\`, \`pass\` and \`object\``;

/** A member by its name where it is a property, and otherwise by what it is. */
const named = (members: readonly WorldMember[]): string[] =>
  members.map((m) => (m.kind === 'property' ? m.name.text : m.kind));

describe('the members of a body, apart from the objects written in it', () => {
  it('splits what was read, keeping each side in the order written', () => {
    const { read } = readBody(
      'world w is sprout.World {\n  object a is K\n  :x 1\n  object b is K\n  contains\n}\n',
      'world',
    );
    const { members, objects } = apart(read!.members, (m): m is WorldMember => m.kind !== 'object');
    expect(members.map((m) => m.kind)).toEqual(['property', 'contains']);
    expect(objects.map((o) => o.name.text)).toEqual(['a', 'b']);
  });
});

describe('a body, read directly', () => {
  it('reads to its own brace and hands that brace back', () => {
    const { p, diagnostics } = parserOver('K { :open true\n contains } after', {
      name: 'b.sprout',
    });
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
    const { p, diagnostics } = parserOver('K { :open true', { name: 'b.sprout' });
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
    const opened = (members: string) => readBody(`${owner.open} {\n  ${members}\n}\n`, owner.noun);

    it(`${owner.noun}: holds its properties, a \`remembers\` block and \`contains\``, () => {
      const { members, refusals } = opened(':a 1\n  remembers { :b 2 }\n  contains actors');
      expect(refusals).toEqual([]);
      expect(members.map((m) => m.kind)).toEqual(['property', 'remembers', 'contains']);
    });

    it(`${owner.noun}: names itself and what it holds when a word is no member`, () => {
      const { members, refusals } = opened('nonsense\n  :a 1');
      expect(refusals.map((d) => [d.message, d.remedy])).toEqual([
        [
          `${owner.article} is not made of \`nonsense\`.`,
          `It holds its properties, ${membersOf(owner)}.`,
        ],
      ]);
      expect(members.map((m) => m.kind)).toEqual(['property']);
    });

    it(`${owner.noun}: reads on past a member it could not read`, () => {
      // A list is stepped over whole, so `:wet` inside it is not a member.
      const { members, refusals } = opened(':a Zeta [oak, :wet]\n  :b Ward.Iron\n  :c 1');
      expect(refusals).toHaveLength(2);
      expect(named(members)).toEqual(['c']);
    });

    it(`${owner.noun}: says it is never closed, in its own noun`, () => {
      const { read, refusals } = readBody(`${owner.open} {\n  :a 1\n`, owner.noun);
      expect(read).toBeNull();
      expect(refusals.map((d) => [d.message, d.remedy])).toEqual([
        [`\`${owner.name}\` is never closed.`, `Add a } after what the ${owner.noun} is made of.`],
      ]);
    });

    it(`${owner.noun}: ends at a declaration written inside it, which is the file's`, () => {
      const { p, refusals } = opened('enum Inner { oak }');
      expect(refusals.map((d) => d.message)).toContain(`\`${owner.name}\` is never closed.`);
      expect(refusals.map((d) => d.message)).not.toContain(
        `${owner.article} is not made of \`enum\`.`,
      );
      expect(rest(p)).toBe('enum Inner { oak }\n}\n');
    });
  }

  it('steps over what a refused member left of its line, to the member on the next', () => {
    for (const line of [
      'without :x from Crate',
      'without passage immovable',
      'without passage immovable { It stays. }',
    ]) {
      const { members, refusals } = readBody(`kind K {\n  ${line}\n  :a 1\n  contains\n}\n`);
      expect(refusals, line).toHaveLength(1);
      expect(named(members), line).toEqual(['a', 'contains']);
    }
  });

  it('leaves the world around an object never closed, never closed too', () => {
    const { refusals } = readBody('world w is sprout.World {\nobject o is K {\n  :a 1\n', 'world');
    expect(refusals.map((d) => [d.message, d.remedy])).toEqual([
      ['`o` is never closed.', 'Add a } after what the object is made of.'],
      ['`w` is never closed.', 'Add a } after what the world is made of.'],
    ]);
  });

  it('names every member written after a stray `}` that ends a kind too early', () => {
    // A brace count alone cannot tell a stray `}` from the kind's own,
    // so what follows it is named rather than lost the way stepping
    // straight to the next declaration would lose it — as `bodies.ts`
    // holds for a world, a kind and an object alike.
    const { members, refusals } = readBody(`kind K is sprout.Container {
  :alpha 0
  }
  :bravo 1
  contains actors
}
`);
    expect(named(members)).toEqual(['alpha']);
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
    const { members, refusals } = readBody(`kind K {
  :alpha 0
  }
  depart (to) { if (mover != self) { refuse "No." } }
  :bravo 1
}
`);
    expect(named(members)).toEqual(['alpha']);
    expect(refusals.map((d) => d.message)).toEqual([
      '`depart` and `:bravo` are written after the `}` that ends `K`.',
    ]);
  });

  it('names the entries of a `remembers` block written after a stray `}`, one by one', () => {
    // A block after the stray brace is named entry by entry, so the
    // remedy says which memory was lost and not merely that one was.
    const { members, refusals } = readBody(`kind K is sprout.Container {
  :alpha 0
  }
  remembers { :visits 0 :greeted false }
}
`);
    expect(named(members)).toEqual(['alpha']);
    expect(refusals.map((d) => d.message)).toEqual([
      '`:visits` and `:greeted` are written after the `}` that ends `K`.',
    ]);
  });

  it('names a describe written after a stray `}` by its word, and steps over its block', () => {
    const { refusals } = readBody(
      'kind Crate {\n  :open true\n}\n  describe { text "A crate." }\n  :shut false\n}\n',
      'kind',
      'k.sprout',
    );
    expect(refusals.map((d) => [locationOf(d.at), d.message])).toEqual([
      ['k.sprout:4:3', '`describe` and `:shut` are written after the `}` that ends `Crate`.'],
    ]);
  });

  it('names a handler after a stray `}` with its message, and a pass rule with its own', () => {
    const { refusals } = readBody(
      'kind Lamp {\n  :lit false\n}\n  on :stir (from) { self.set(:lit, true) }\n  pass any (false)\n}\n',
      'kind',
      'k.sprout',
    );
    expect(refusals.map((d) => d.message)).toEqual([
      '`on :stir` and `pass any` are written after the `}` that ends `Lamp`.',
    ]);
  });

  it('names a play written after a stray `}` as one member, its own braces stepped over', () => {
    const { refusals } = readBody(
      'kind Key {\n  }\n  as target for pull { do { self.set(:open, true) } }\n}\n',
      'kind',
      'k.sprout',
    );
    expect(refusals.map((d) => d.message)).toEqual([
      '`as target for pull` is written after the `}` that ends `Key`.',
    ]);
  });

  it("reads the members after a `}` that was already refused as a property's value", () => {
    // The `}` right after `:faulty` was already refused as its value:
    // that refusal, and not a brace count, is what tells the reader this
    // `}` is not `w`'s own, so the members before the real one are read
    // rather than merely named as displaced.
    const { members, refusals } = readBody(
      `world w is sprout.World {
  :faulty }
  visitors are P
  visitors arrive at y
}
`,
      'world',
    );
    expect(members.map((m) => m.kind)).toEqual(['visitors-are', 'visitors-arrive-at']);
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
    const { members, refusals } = readBody(
      `world w is sprout.World {
  :alpha 0
  }
  visitors are P
  visitors arrive at y
}
`,
      'world',
    );
    expect(named(members)).toEqual(['alpha']);
    expect(refusals.map((d) => d.message)).toEqual([
      '`visitors` is written after the `}` that ends `w`.',
    ]);
  });
});

describe('a body never closed', () => {
  it('says so where the file ends', () => {
    const { refusals } = readBody('kind K {\n  :a 1\n', 'kind', 'k.sprout');
    expect(refusals.map((d) => [d.message, d.remedy])).toEqual([
      ['`K` is never closed.', 'Add a } after what the kind is made of.'],
    ]);
  });

  it('says nothing more when a comment or a passage never closed took its `}`', () => {
    for (const text of [
      'kind K {\n  :a 1\n  /* the rest\n}\n',
      'kind K {\n  passage greeting { Hello, {actor.\n}\n',
    ]) {
      const { refusals } = readBody(text, 'kind', 'k.sprout');
      expect(refusals, text).toHaveLength(1);
      expect(refusals[0]!.message, text).toMatch(/never closed/);
      expect(refusals[0]!.message, text).not.toMatch(/`K`/);
    }
  });

  it('names the passage it ends with, whose slot may have taken its `}`', () => {
    const text = 'kind K {\n  passage greeting { A {slot.\n  }\n}\nenum Ward { oak }\n';
    const { read, p, refusals } = readBody(text, 'kind', 'k.sprout');
    // The slot that took the passage's `}` reads on past its line, and
    // what it reads is said where it stands.
    expect(refusals.map((d) => [locationOf(d.at), d.message, d.remedy])).toEqual([
      [
        'k.sprout:3:3',
        'A dot needs the name of something to read after it.',
        'Write what to read, as in `self.count` or `self.get(:wear)`.',
      ],
      [
        'k.sprout:5:1',
        '`K` is never closed.',
        'Add a } after what the kind is made of. If there is one, a { inside the passage `greeting` has no } of its own, and took it.',
      ],
    ]);
    expect(read).toBeNull();
    expect(rest(p)).toBe('enum Ward { oak }\n');
  });
});

describe('objects written in a body', () => {
  it('are held apart from its members, each holding what is written in its own', () => {
    const { read, members, objects, refusals } = readBody(
      `world w is sprout.World {
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
`,
      'world',
    );
    expect(refusals).toEqual([]);
    expect(members.map((m) => m.kind)).toEqual(['visitors-are', 'visitors-arrive-at']);
    expect(objects.map((o) => o.name.text)).toEqual(['hall', 'yard']);
    const hall = objects[0]!;
    expect(hall.members.map((m) => m.kind)).toEqual(['property']);
    expect(hall.objects.map((o) => o.name.text)).toEqual(['chest', 'bench']);
    expect(hall.objects[0]!.objects.map((o) => o.name.text)).toEqual(['key']);
    expect(unspanned(read)).toEqual([]);
  });

  it('are read in a kind’s body too, where the declaration layer says what it makes of them', () => {
    const { members, objects, refusals } = readBody(
      'kind Lantern {\n  contains\n  object wick is Wick\n}\n',
    );
    expect(refusals).toEqual([]);
    expect(members.map((m) => m.kind)).toEqual(['contains']);
    expect(objects.map((o) => o.name.text)).toEqual(['wick']);
  });

  it('leave what follows an object’s `}` to the body around it, where it was written', () => {
    const { members, objects, refusals } = readBody(
      'world w is sprout.World {\n  object hall is Room { :lit true }\n  :season 1\n  visitors are P\n}\n',
      'world',
    );
    expect(refusals).toEqual([]);
    expect(members.map((m) => m.kind)).toEqual(['property', 'visitors-are']);
    expect(objects[0]!.members.map((m) => m.kind)).toEqual(['property']);
  });

  it('are where stepping over a member that could not be read stops', () => {
    const { members, objects, refusals } = readBody(
      'world w is sprout.World {\n  :faulty Zeta [oak]\n  object hall is Room\n  :after 1\n}\n',
      'world',
    );
    expect(refusals.length).toBeGreaterThan(0);
    expect(objects.map((o) => o.name.text)).toEqual(['hall']);
    expect(named(members)).toEqual(['after']);
  });
});
