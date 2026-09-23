import { describe, expect, it } from 'vitest';

import type { KindDeclaration } from '../syntax/ast.js';
import type { VerbDeclaration } from '../syntax/ast-verbs.js';
import { Diagnostics } from '../source/diagnostics.js';
import { parseDeclarations } from '../syntax/parse.js';
import { locationOf, SourceFile } from '../source/source.js';
import { EnumTable } from '../declare/enums.js';
import { KindTable } from '../declare/kinds.js';
import { VerbNames } from '../declare/roles.js';
import { VerbTable } from '../declare/verbs.js';
import { checkPlay } from './roles.js';

/** The standard library's part: what an actor is, and a person. */
const SPROUT_TEXT = 'kind Actor { contains :capacity 8 }\nkind Visitor is Actor { }\n';

/** The verbs every case here may play. */
const VERBS = `enum Topic { bridge, toll, weather }
verb unlock { role target  role tool  "unlock [target] with [tool]"  "unlock [target]" }
verb pull { role target  "pull [target]" }
verb ask { role target  role topic: symbol  "ask [target] about [topic]" }
verb dial { role target  role number: integer  "dial [number] on [target]" }
verb throw { role target  role tools many  "throw [target] using [tools]" }
verb nudge { role target  role tool optional }
verb sit { role target }
kind Visitor is sprout.Visitor { :score 0 }
`;

/**
 * Every play in `text` checked against the kind that wrote it, after the
 * verbs above. What was said, as location, message and remedy.
 */
function checked(text: string): string[][] {
  const setup = new Diagnostics();
  const sprout = parseDeclarations(new SourceFile('sprout.sprout', SPROUT_TEXT), setup);
  const shop = parseDeclarations(new SourceFile('shop.sprout', `${VERBS}${text}`), setup);
  const enums = new EnumTable();
  enums.add(
    'shop',
    shop.filter((d) => d.kind === 'enum'),
    setup,
  );
  const verbDeclarations = shop.filter((d): d is VerbDeclaration => d.kind === 'verb');
  const names = new VerbNames();
  names.add('shop', verbDeclarations);
  const kinds = new KindTable();
  kinds.add(
    'sprout',
    sprout.filter((d): d is KindDeclaration => d.kind === 'kind'),
    setup,
  );
  kinds.add(
    'shop',
    shop.filter((d): d is KindDeclaration => d.kind === 'kind'),
    setup,
  );
  kinds.resolve('shop', enums, setup, undefined, { verbs: names });
  const verbs = new VerbTable();
  verbs.add('shop', verbDeclarations, { kinds, enums, diagnostics: setup });
  expect(
    setup.all.map((d) => d.message),
    'the fixture resolves',
  ).toEqual([]);

  const diagnostics = new Diagnostics();
  for (const kind of kinds.all()) {
    for (const plays of kind.plays.values()) {
      for (const play of plays) {
        if (play.origin === `${kind.library}.${kind.name}`) {
          checkPlay(play, kind, { kinds, verbs, diagnostics });
        }
      }
    }
  }
  return diagnostics.all.map((d) => [locationOf(d.at), d.message, d.remedy ?? '']);
}

/** Only the words of what was said, for a case about the words. */
const messages = (said: string[][]) => said.map(([, message]) => message);

describe('a role’s body is read in the scope of a participant', () => {
  it('takes the spec’s own `Warded` and `Key`, the tool read under `bound`', () => {
    expect(
      checked(`kind Key { :wear 0 min 0 max 99
  as tool for unlock {
    permit { if (self.get(:wear) >= 99) { refuse "The bit is worn smooth. It turns nothing." } }
    do     { self.adjust(:wear, 1) }
  }
}
kind Warded {
  :sealed false
  passage opened { The bolt slides back. }
  as target for unlock {
    permit {
      if (bound tool) {
        if (!tool.is(Key)) { refuse "{tool} is not a key." }
      } else {
        refuse "You need something to turn the lock with."
      }
    }
    do { self.set(:sealed, false)  say opened }
  }
}`),
    ).toEqual([]);
  });

  it('types `actor` as `sprout.Actor`, since a person or an NPC may be acting', () => {
    const read = (condition: string) =>
      `kind Lever { as target for pull { permit { if (${condition}) { allow } } } }`;
    expect(checked(read('actor.get(:capacity) > 3'))).toEqual([]);
    // What only the visitor kind declares is read once `is()` has narrowed it.
    expect(
      checked(
        'kind Lever { as target for pull { permit { if (actor.is(Visitor)) { if (actor.get(:score) > 3) { allow } } } } }',
      ),
    ).toEqual([]);
    expect(
      checked(read('actor.get(:score) > 3')).map(([, message, remedy]) => [message, remedy]),
    ).toEqual([
      [
        '`sprout.Actor` has no `:score`.',
        "`:score` is a `Visitor`'s. Read it as one first: `if (actor.is(Visitor)) { … actor.get(:score) … }`.",
      ],
    ]);
    // What nothing of the world's declares keeps the list of what it has.
    expect(checked(read('actor.get(:scroe) > 3')).map(([, , remedy]) => remedy)).toEqual([
      'It has `:capacity`.',
    ]);
  });

  it('binds `here`, and the other roles by name, typed by what fills them', () => {
    expect(
      checked(
        `kind Key { as tool for unlock { permit { if (target.is(Key) && here != self) { allow } } } }`,
      ),
    ).toEqual([]);
  });

  it('binds a set role for every participant, its own filler too', () => {
    expect(
      checked(`kind Rib { as tools for throw { permit { if (tools.count(Rib) > 1) { refuse "One rib." } } } }
kind Pot { as target for throw { permit { if (tools.count > 2) { refuse "Too many." } } } }`),
    ).toEqual([]);
  });

  it('refuses a name for a value that takes a role’s name', () => {
    expect(
      messages(checked('kind Key { as tool for unlock { permit { let target = 1 } } }')),
    ).toEqual(["`target` already names this verb's role here."]);
  });
});

describe('the role played is `self`, and not bound by its own name', () => {
  it('refuses a read of it, saying to write `self`', () => {
    expect(
      checked('kind Lever { as target for pull { permit { if (target == self) { allow } } } }'),
    ).toEqual([
      ['shop.sprout:10:48', '`target` is `self` in `as target for pull`.', 'Write `self`.'],
    ]);
  });
});

describe('an optional tool is read only inside `if (bound …)`', () => {
  it('refuses a read outside the test, naming the phrase that leaves it out', () => {
    expect(
      checked(`kind Door { as target for unlock { permit { if (tool.is(Door)) { allow } } } }`),
    ).toEqual([
      [
        'shop.sprout:10:49',
        '`tool` may be missing here: `"unlock [target]"` leaves it out.',
        'Read it inside `if (bound tool) { … }`.',
      ],
    ]);
  });

  it('refuses it in the `else` of the test, and after it', () => {
    expect(
      messages(
        checked(`kind Door { as target for unlock {
  permit { if (bound tool) { allow } else { if (tool.is(Door)) { allow } } }
  do { if (tool.is(Door)) { } }
} }`),
      ),
    ).toEqual([
      '`tool` may be missing here: `"unlock [target]"` leaves it out.',
      '`tool` may be missing here: `"unlock [target]"` leaves it out.',
    ]);
  });

  it('says a tool of a verb with no phrases is missing because the verb marks it', () => {
    expect(
      messages(checked('kind Box { as target for nudge { do { if (tool == self) { } } } }')),
    ).toEqual(['`tool` may be missing here: `nudge` marks it `optional`.']);
  });

  it('refuses `bound` on a tool every phrase fills, a set, or anything that is not a tool', () => {
    expect(
      checked(`kind Key { as tool for unlock { permit { if (bound target) { allow } } } }
kind Pot { as target for throw { permit { if (bound tools) { allow } } } }
kind Box { as target for pull { permit { if (bound actor) { allow } } } }`),
    ).toEqual([
      [
        'shop.sprout:10:52',
        '`target` is filled by every phrase of `unlock`, so there is nothing for `bound` to ask.',
        'Take the `if` out and read `target` directly.',
      ],
      [
        'shop.sprout:11:53',
        '`tools` is a set, and a phrase that leaves it out binds it empty, so it is never missing.',
        'Ask whether it holds anything with `tools.count > 0`.',
      ],
      [
        'shop.sprout:12:52',
        "`bound` asks whether a verb's tool was given, and `actor` is whoever is acting.",
        'Ask it of a tool some phrase of `pull` leaves out, as in `if (bound tool) { … }`.',
      ],
    ]);
  });

  it('refuses `bound` on the role played, which is always there', () => {
    expect(
      messages(
        checked('kind Box { as target for pull { permit { if (bound target) { allow } } } }'),
      ),
    ).toEqual(['`target` is `self` in `as target for pull`, and is always there.']);
  });
});

describe('a value tool binds only the options its role-player hears', () => {
  it('types a symbol tool by the list `from` names, read under `bound`', () => {
    expect(
      checked(`kind Guard {
  :knows [Topic] default [bridge, toll]
  passage toll_speech { Two coppers. }
  as target for ask {
    topic from :knows
    do {
      if (bound topic) {
        if (topic == :toll) { say toll_speech }
      } else {
        say "The guard has nothing to say about that."
      }
    }
  }
}`),
    ).toEqual([]);
  });

  it('checks an option against the list’s enum, and says a value tool may be none of them', () => {
    expect(
      messages(
        checked(`kind Guard { :knows [Topic] default [toll]
  as target for ask { topic from :knows  do { if (bound topic) { if (topic == :tol) { } } if (topic == :toll) { } } } }`),
      ),
    ).toEqual([
      '`Topic` has no option `tol`. Did you mean `toll`?',
      '`topic` may be missing here: what a visitor names may be none of the options `Guard` hears.',
    ]);
  });

  it('bounds an integer tool by a range written out', () => {
    expect(
      checked(
        `kind Safe { as target for dial { number from 1 to 12  permit { if (bound number) { if (number > 6) { allow } } } } }`,
      ),
    ).toEqual([]);
  });

  it('never binds a value tool with no `from`, read or asked about', () => {
    expect(
      checked(`kind Guard { as target for ask { do { if (bound topic) { } } } }
kind Safe { as target for dial { do { if (number > 1) { } } } }`),
    ).toEqual([
      [
        'shop.sprout:10:49',
        '`topic` has no options here, so it is never bound.',
        'Write `topic from :<a list property>` in this body, naming the options `Guard` hears.',
      ],
      [
        'shop.sprout:11:43',
        '`number` has no numbers here, so it is never bound.',
        'Write `number from :<an integer property>` or `number from 1 to 12` in this body, naming the numbers `Safe` hears.',
      ],
    ]);
  });

  it('refuses a `from` on a role a thing fills', () => {
    expect(
      messages(
        checked(
          'kind Knot { :knows [Topic] default []  as tool for unlock { target from :knows  do { } } }',
        ),
      ),
    ).toEqual(['`target` is filled by a thing, so there is nothing for `from` to narrow.']);
  });
});

describe('`as actor` is played by an actor', () => {
  it('refuses a kind that does not compose `sprout.Actor`, naming the verb’s roles', () => {
    expect(checked('kind Bench { as actor for sit { do { } } }')).toEqual([
      [
        'shop.sprout:10:17',
        'Only an actor acts, and `Bench` does not compose `sprout.Actor`.',
        "Compose `sprout.Actor` into `Bench`, or play one of `sit`'s roles instead: `target`.",
      ],
    ]);
    expect(checked('kind Sitter is sprout.Actor { as actor for sit { do { } } }')).toEqual([]);
  });
});

describe('a `permit` decides and a `do` acts', () => {
  it('refuses a write, a `say`, a `spawn` and a `destroy` in a `permit`', () => {
    expect(
      checked(`kind Lever { :up true  contains
  as target for pull { permit {
    self.set(:up, false)
    say "Clunk."
    spawn Lever in self
    destroy self
  } }
}`),
    ).toEqual([
      [
        'shop.sprout:12:5',
        '`self.set` writes, and a `permit` only reads and decides.',
        'Move it to `do`; a `permit` ends in `allow` or `refuse`.',
      ],
      [
        'shop.sprout:13:5',
        '`say` speaks, and a `permit` only decides.',
        'Move it to `do`, or make it the words of a `refuse`.',
      ],
      [
        'shop.sprout:14:5',
        '`spawn` makes a new thing, and a `permit` only reads and decides.',
        'Move it to `do`; a `permit` ends in `allow` or `refuse`.',
      ],
      [
        'shop.sprout:15:5',
        '`destroy self` removes something, and a `permit` only reads and decides.',
        'Move it to `do`; a `permit` ends in `allow` or `refuse`.',
      ],
    ]);
  });

  it('refuses `refuse` and `allow` in a `do`, and takes what a `do` does', () => {
    expect(
      checked(`kind Lever { :up true  contains  passage clunk { Clunk. }
  as target for pull { do {
    refuse "No."
    allow
    self.set(:up, false)
    say clunk
    let spare = spawn Lever in self
    if (spare != self) { destroy self }
  } }
}`),
    ).toEqual([
      [
        'shop.sprout:12:5',
        '`refuse` decides, and a `do` acts.',
        'Move it to `permit`, where the deciding is done.',
      ],
      [
        'shop.sprout:13:5',
        '`allow` decides, and a `do` acts.',
        'Take it out: a `do` runs once every `permit` has allowed.',
      ],
    ]);
  });

  it('refuses a spawn of what visitors are made of, and takes an NPC’s kind', () => {
    const text = `kind Porter is sprout.Actor { }
kind Bell { as target for pull { do { spawn Porter in here  spawn Visitor in here } } }`;
    const refused = [
      '`Visitor` composes `sprout.Visitor`, what a person is made of, and nothing spawns a visitor: each one is a person who arrives.',
    ];
    expect(messages(checked(text))).toEqual(refused);
  });

  it('says a passage a `say` names must be the kind’s', () => {
    expect(checked('kind Lever { as target for pull { do { say clunck } } }')).toEqual([
      [
        'shop.sprout:10:44',
        '`Lever` has no passage `clunck`.',
        'Write `passage clunck { … }` in `Lever`, or give the words in quotes, as in `say "The bolt slides back."`.',
      ],
    ]);
  });
});

describe('a `do` performs verbs with `act`', () => {
  it('checks each `act` against the bundle’s verbs and whether its kind is an actor', () => {
    for (const cat of ['sprout.Actor', 'Visitor']) {
      expect(
        checked(`kind Cat is ${cat} { as actor for sit { do { act pull (target: self) } } }`),
        cat,
      ).toEqual([]);
    }
    expect(
      checked('kind Lever { as target for pull { do { act sit (target: self) } } }').map(
        ([at, message]) => [at, message],
      ),
    ).toEqual([
      ['shop.sprout:10:40', 'Only an actor acts, and `Lever` does not compose `sprout.Actor`.'],
    ]);
  });
});
