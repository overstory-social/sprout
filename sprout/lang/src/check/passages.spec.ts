import { describe, expect, it } from 'vitest';

import type { KindDeclaration } from '../syntax/ast.js';
import type { VerbDeclaration } from '../syntax/ast-verbs.js';
import { GUARD_NAMES } from '../syntax/ast.js';
import { Diagnostics, type Diagnostic } from '../source/diagnostics.js';
import { parseDeclarations } from '../syntax/parse.js';
import { locationOf, SourceFile } from '../source/source.js';
import { EnumTable } from '../declare/enums.js';
import { kindName, KindTable } from '../declare/kinds.js';
import { hereKindOf } from '../declare/places.js';
import { VerbNames } from '../declare/roles.js';
import { VerbTable } from '../declare/verbs.js';
import { checkGuard } from './guards.js';
import { checkPlay } from './roles.js';
import { checkPassages } from './passages.js';
import { PassageSites } from './speech.js';

/** The standard library's part: an actor, a person, the world's lines and a place's notices. */
const SPROUT_TEXT = `kind Actor { contains }
kind Visitor is Actor { }
kind World {
  contains
  passage unreachable default { You cannot reach {thing} from here. }
  passage fault default { Something has gone wrong. }
}
kind Place { contains actors  passage arrives default { {item} arrives. } }
`;

const VERBS = `verb take { role target  "take [target]" }
verb unlock { role target  role tool  "unlock [target] with [tool]"  "unlock [target]" }
verb peer { role target  "peer at [target]" }
`;

/**
 * Every body in `text` checked against the kind that wrote it, recording
 * what each says, and then every passage against where it is said: what
 * was said, in order.
 */
function diagnosed(text: string): Diagnostic[] {
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
    setup.refusals.map((d) => d.message),
    'the fixture resolves',
  ).toEqual([]);

  const diagnostics = new Diagnostics();
  const sites = new PassageSites();
  const here = hereKindOf(kinds.all(), kinds);
  for (const kind of kinds.all()) {
    const own = kindName(kind);
    const setting = { kinds, here, verbs, diagnostics, speech: { sites } };
    for (const name of GUARD_NAMES) {
      for (const guard of kind.guards[name]) {
        if (guard.origin === own) checkGuard(guard.declaration, kind, setting);
      }
    }
    for (const plays of kind.plays.values()) {
      for (const play of plays) if (play.origin === own) checkPlay(play, kind, setting);
    }
  }
  checkPassages({
    speakers: kinds.all().map((kind) => ({ kind })),
    kinds,
    here,
    diagnostics,
    sites,
  });
  return diagnostics.sorted();
}

/** What was said of `text`, as location and message. */
const checked = (text: string): string[][] =>
  diagnosed(text).map((d) => [locationOf(d.at), d.message]);

/** The remedy of each thing said of `text`. */
const remediesOf = (text: string): string[] => diagnosed(text).map((d) => d.remedy ?? '');

describe('`here` is a `sprout.Place` where every kind holding actors composes it', () => {
  it('walks and counts `here` without narrowing it, in a body and in a line the engine says', () => {
    expect(
      checked(`kind Hand is sprout.Actor {
  :seen 0 min 0 max 99
  as actor for take { do { self.set(:seen, here.count)  say look } }
  passage look { {for thing in here}{thing}{/for} }
}
kind Loud { passage fault { {for thing in here}{thing} shakes.{/for} } }
kind Hall is sprout.Place { }`),
    ).toEqual([]);
  });

  it('is the object type where a kind holds actors without composing it, and says which', () => {
    const text = `kind Hand is sprout.Actor {
  as actor for take { do { say look } }
  passage look { {for thing in here}{thing}{/for} }
}
kind Loud { passage fault { {for thing in here}{thing} shakes.{/for} } }
kind Room { contains actors }`;
    expect(checked(text)).toEqual([
      ['shop.sprout:6:32', 'Sprout does not know whether this holds anything.'],
      ['shop.sprout:8:43', 'Sprout does not know whether this holds anything.'],
    ]);
    const remedy =
      '`Room` holds actors without composing `sprout.Place`, so `here` may be a place that is not one: compose `sprout.Place` into `Room`, or narrow `here` first with `is()`.';
    expect(remediesOf(text)).toEqual([remedy, remedy]);
  });
});

describe('a passage uses the bindings of the body that says it', () => {
  it('renders a role where the body saying it plays that verb', () => {
    expect(
      checked(`kind Hand is sprout.Actor {
  as actor for take { do { say taken } }
  passage taken { You take {target}, in {here}, as {actor}. }
}`),
    ).toEqual([]);
  });

  it('is refused where it is said from a body that does not bind what it renders', () => {
    expect(
      checked(`kind Crate {
  contains
  accept (item, from) { if (self.count > 1) { refuse full } }
  passage full { There is no room for {target} beside {item}. }
}`),
    ).toEqual([
      [
        'shop.sprout:6:54',
        'The passage `full` renders `{target}`, and nothing here is called `target`.',
      ],
    ]);
  });

  it('is checked against every place it is said from, each exactly', () => {
    const said = checked(`kind Lock {
  as target for unlock { do { say turned } }
  as target for peer { do { say turned } }
  passage turned { The lock turns under {tool}. }
}`);
    expect(said).toEqual([
      // Said where `peer` is played, which has no tool.
      [
        'shop.sprout:6:33',
        'The passage `turned` renders `{tool}`, and nothing here is called `tool`.',
      ],
      // Said where `unlock` is played, where a phrase leaves the tool out.
      ['shop.sprout:7:42', '`tool` may be missing here: `"unlock [target]"` leaves it out.'],
    ]);
  });

  it('carries a `let` in reach where it is said', () => {
    expect(
      checked(`kind Crate {
  contains
  as target for peer { do { let n = self.count  say counted } }
  passage counted { {n} things, {self.count} held. }
}`),
    ).toEqual([]);
  });

  it('checks a composer’s own line against the bodies of its closure that say it', () => {
    const said = checked(`kind Hand is sprout.Actor {
  as actor for take { do { say taken } }
  passage taken default { You take {target}. }
}
kind Grip is Hand {
  passage taken { Got {target} with {tool}. }
}`);
    // Refused where `Hand`'s play says it, which `Grip` runs.
    expect(said).toEqual([
      [
        'shop.sprout:5:32',
        'The passage `taken` renders `{tool}`, and nothing here is called `tool`.',
      ],
    ]);
  });

  it('checks a passage said from nowhere with `self` alone', () => {
    expect(
      checked(`kind Mirror {
  passage greeting { Hello from {self}. }
  passage stare { {actor} stares. }
}`),
    ).toEqual([['shop.sprout:6:20', 'Nothing here is called `actor`.']]);
  });

  it('says a mistake in a passage said from many places once', () => {
    const said = checked(`kind Crate {
  contains
  as target for peer { do { say told } }
  as target for take { do { say told } }
  passage told { {self.count + 1} }
}`);
    expect(said.map(([, message]) => message)).toEqual([
      'A passage reads what is there and does no arithmetic.',
    ]);
  });
});

describe('a passage a slot renders is run with its own `self`, and `actor` and `here` beside it', () => {
  it('takes `actor` from where it is rendered', () => {
    expect(
      checked(`kind Bell { passage ring { {actor} rings {self}. } }
kind Tower {
  contains
  as target for peer { do { say "{for b: Bell in self}{b.ring}{/for}" } }
}`),
    ).toEqual([]);
  });

  it('is refused where it is rendered when it wants a role the slot does not give it', () => {
    expect(
      checked(`kind Bell { passage ring { {target} rings. } }
kind Tower {
  contains
  as target for peer { do { say "{for b: Bell in self}{b.ring}{/for}" } }
}`),
    ).toEqual([
      [
        'shop.sprout:7:58',
        'The passage `ring` renders `{target}`, and nothing it is rendered with is called `target`.',
      ],
    ]);
  });

  it('reaches the passage of that name on every kind composing the slot’s', () => {
    expect(
      checked(`kind Bell { passage ring { A bell. } }
kind Gong is Bell { passage ring { {target} booms. } }
kind Tower {
  contains
  as target for peer { do { say "{for b: Bell in self}{b.ring}{/for}" } }
}`).map(([, message]) => message),
    ).toEqual([
      'The passage `ring` renders `{target}`, and nothing it is rendered with is called `target`.',
    ]);
  });
});

describe('the engine says its own lines with what it binds for each', () => {
  it('gives the world’s lines and a place’s notices their names, and nothing else', () => {
    expect(checked(`kind Hall is sprout.Place { passage arrives { {item} comes in. } }`)).toEqual(
      [],
    );
    expect(checked(`kind Hall is sprout.Place { passage arrives { {actor} comes in. } }`)).toEqual([
      [
        'shop.sprout:4:48',
        'The engine says `arrives` with `{item}` bound, and nothing is called `actor` there.',
      ],
    ]);
  });

  it('says a line it binds nothing for with nothing but `self`', () => {
    expect(checked(`kind Loud { passage unseen { {item} broke. } }`)).toEqual([
      [
        'shop.sprout:4:31',
        'The engine says `unseen` with nothing bound, and nothing is called `item` there.',
      ],
    ]);
  });

  it('gives a line said to the one acting `actor`, as a body that binds one has it, and `here`', () => {
    expect(checked(`kind Loud { passage nothing_happens { {actor} shrugs in {here}. } }`)).toEqual(
      [],
    );
    expect(checked(`kind Loud { passage fault { {actor} feels {here} shake. } }`)).toEqual([]);
    expect(checked(`kind Loud { passage unseen { {here} shakes. } }`)).toEqual([
      [
        'shop.sprout:4:31',
        'The engine says `unseen` with nothing bound, and nothing is called `here` there.',
      ],
    ]);
  });
});

describe('a passage said where nothing draws may not draw', () => {
  const GUARD_WHY = 'a guard is asked as part of a decision it must not change';

  it('is refused where a guard says it, and taken where a `do` says it', () => {
    const said = checked(`kind Crate {
  contains
  accept (item, from) { if (self.count > 1) { refuse full } }
  as target for peer { do { say full } }
  passage full { {one of}No room.{or}It is full.{/one of} }
}`);
    expect(said).toEqual([
      [
        'shop.sprout:6:54',
        `The passage \`full\` uses \`{one of}\`, and it is said from \`accept\`, which may not: ${GUARD_WHY}.`,
      ],
    ]);
  });

  it('is refused where a `permit` says it, for a draw in a condition or a slot', () => {
    const said = checked(`kind Lock {
  as target for unlock { permit { refuse stuck } }
  as target for peer { permit { refuse jammed } }
  passage stuck { {if chance(2)}Stuck.{else}Jammed.{/if} }
  passage jammed { Jammed {random(3)} times. }
}`);
    expect(said.map(([at, message]) => [at, message!.split(',')[0]])).toEqual([
      ['shop.sprout:5:42', 'The passage `stuck` uses `chance`'],
      ['shop.sprout:6:40', 'The passage `jammed` uses `random`'],
    ]);
  });

  it('follows a slot to the passage it renders, and refuses where the slot is', () => {
    const said = checked(`kind Bell { passage ring { {one of}Ding.{or}Dong.{/one of} } }
kind Tower {
  contains
  accept (item, from) { refuse "{for b: Bell in self}{b.ring}{/for}" }
  as target for peer { do { say "{for b: Bell in self}{b.ring}{/for}" } }
}`);
    expect(said).toEqual([
      [
        'shop.sprout:7:57',
        `The passage \`ring\` uses \`{one of}\`, and it is rendered from \`accept\`, which may not: ${GUARD_WHY}.`,
      ],
    ]);
  });

  it('follows a passage said from a guard through the slots it renders', () => {
    const said = checked(`kind Bell { passage ring { Ding {random(2)}. } }
kind Tower {
  contains
  accept (item, from) { refuse full }
  passage full { {for b: Bell in self}{b.ring}{/for} }
}`);
    expect(said.map(([at, message]) => [at, message!.split(',')[0]])).toEqual([
      ['shop.sprout:8:42', 'The passage `ring` uses `random`'],
    ]);
  });

  it('refuses a draw in a line a poll says, at the draw, and takes one in a line a command says', () => {
    expect(
      checked(`kind Loud { passage unseen { {one of}Too much.{or}A blur.{/one of} } }`),
    ).toEqual([
      [
        'shop.sprout:4:30',
        "The world's `unseen` may not use `{one of}`: a poll says it, and a poll draws nothing.",
      ],
    ]);
    expect(
      checked(
        `kind Loud { passage nothing_happens { {one of}Nothing.{or}Still nothing.{/one of} } }`,
      ),
    ).toEqual([]);
  });

  it('says a passage said from two deciding bodies once for each place it is said', () => {
    const said = checked(`kind Crate {
  contains
  accept (item, from) { refuse full }
  depart (to) { refuse full }
  passage full { {if chance(2)}Full.{/if} }
}`);
    expect(said.map(([at]) => at)).toEqual(['shop.sprout:6:32', 'shop.sprout:7:24']);
  });
});
