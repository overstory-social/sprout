import { describe, expect, it } from 'vitest';

import { compileBundle } from '../bundle/compile/compile.js';
import { locationOf } from '../source/source.js';
import { parseStatement } from '../syntax/parse.js';
import { Diagnostics } from '../source/diagnostics.js';
import { SourceFile } from '../source/source.js';
import type { Block } from '../syntax/ast.js';
import { file, refusals, world, worldFiles, worldLine } from '../fixtures/compile.js';
import { textsIn } from './describe.js';

/** What compiling a world whose lamp writes `members` refuses, as location, message and remedy. */
function refusedIn(
  members: string,
  mode: 'publish' | 'load' = 'publish',
): (string | undefined)[][] {
  const files = worldFiles(
    `${worldLine('object lamp is Lamp')}\nmessage :lit\nenum Topic { oil, wick }`,
    `kind Lamp {\n  :lit false\n  :wicks 1 min 0 max 3\n  ${members}\n}`,
  );
  const { diagnostics } = compileBundle(world({ files }), { mode });
  return refusals(diagnostics).map((d) => [locationOf(d.at), d.message, d.remedy]);
}

const messages = (members: string): string[] => refusedIn(members).map(([, message]) => message!);

describe('a describe', () => {
  it('reads `self`, the one looking as `actor` and their place as `here`, and names a `let` for its lines', () => {
    expect(
      refusedIn(
        [
          'describe {',
          '    let n = self.get(:wicks)',
          '    if (self.get(:lit)) { text "It burns, {actor}." } else { text dark }',
          '    if (n > 1) { text "It has {n} wicks, in {here}." }',
          '    if (actor.is(Person)) { text "It is yours to light." }',
          '  }',
          '  passage dark { The lamp is dark, and {actor} cannot see {here}. }',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('with no `text` anywhere in it is refused, since a text client would read nothing', () => {
    expect(refusedIn('describe { let n = self.get(:wicks) }')).toEqual([
      [
        'lamp.sprout:4:3',
        'This `describe` has no `text`, so whoever looks at `Lamp` would read nothing.',
        'Give it its words with `text`, as in `describe { text "Slat-sided, heavier than it looks." }`.',
      ],
    ]);
    // A `text` in any branch is a `text`; what it renders when is the world's.
    expect(refusedIn('describe { if (self.get(:lit)) { text "It burns." } }')).toEqual([]);
    expect(
      refusedIn('describe { if (self.get(:lit)) { } else if (true) { } else { text "Dark." } }'),
    ).toEqual([]);
  });

  it('refuses `say` and `tell`, whose words are for the one acting and the room', () => {
    expect(refusedIn('describe { text "A lamp."  say "Hello." }')).toEqual([
      [
        'lamp.sprout:4:30',
        '`say` speaks to the one acting, and a `describe` is read by whoever looks.',
        'Write `text` in its place, as in `text "A lever, waist high."`.',
      ],
    ]);
    expect(refusedIn('describe { text "A lamp."  tell "It glows." }')).toEqual([
      [
        'lamp.sprout:4:30',
        '`tell` speaks to the room, and a `describe` is read by whoever looks, and only reads.',
        'Write `text` for the words the one looking reads; tell the room from a `do` or a handler.',
      ],
    ]);
  });

  it('refuses `refuse` and `allow`, since it decides nothing', () => {
    expect(refusedIn('describe { text "A lamp."  refuse "No." }')).toEqual([
      [
        'lamp.sprout:4:30',
        '`refuse` decides, and a `describe` only says what is there.',
        'Move it to a `permit` or a guard, which decide; here, give the words with `text`.',
      ],
    ]);
    expect(messages('describe { text "A lamp."  allow }')).toEqual([
      '`allow` decides, and a `describe` only says what is there.',
    ]);
  });

  it('refuses everything that changes the world, since it only reads', () => {
    for (const [statement, said] of [
      ['self.set(:lit, true)', '`self.set` writes, and a `describe` only reads.'],
      ['move self to actor', '`move` moves something, and a `describe` only reads.'],
      ['spawn Lamp in here', '`spawn` makes a new thing, and a `describe` only reads.'],
      ['let l = spawn Lamp in here', '`spawn` makes a new thing, and a `describe` only reads.'],
      ['destroy self', '`destroy self` removes something, and a `describe` only reads.'],
      ['send self :lit', '`send` sends a message, and a `describe` only reads.'],
      ['broadcast :lit', '`broadcast` sends a message, and a `describe` only reads.'],
      ['wake in 3 seconds', '`wake` asks for a wake, and a `describe` only reads.'],
    ] as const) {
      const refused = refusedIn(`describe { text "A lamp."\n    ${statement} }`);
      expect(
        refused.map(([, message]) => message),
        statement,
      ).toEqual([said]);
      expect(refused[0]![2], statement).toBe(
        'Move it to a `do` or a handler; a `describe` reads what is there and gives its words with `text`.',
      );
    }
  });

  it('draws nothing: `chance`, `random` and `{one of}` are refused, in it and in a passage it says', () => {
    const refusal =
      'A `describe` may not use `chance`: it is run whenever anyone looks, so a roll would change the thing while nobody acts.';
    expect(
      messages('describe { if (chance(2)) { text "It flickers." } else { text "Steady." } }'),
    ).toEqual([refusal]);
    expect(messages('describe { text "{one of}It hums.{or}It ticks.{/one of}" }')).toEqual([
      'A `describe` may not use `{one of}`: it is run whenever anyone looks, so a roll would change the thing while nobody acts.',
    ]);
    expect(
      refusedIn('describe { text hum }\n  passage hum { {one of}It hums.{or}It ticks.{/one of} }'),
    ).toEqual([
      [
        'lamp.sprout:4:19',
        'The passage `hum` uses `{one of}`, and it is said from a `describe`, which may not: it is run whenever anyone looks, so a roll would change the thing while nobody acts.',
        'Say words here that do not vary, or keep the variation on a property a `do` or a tick sets, and read that in an `{if}`.',
      ],
    ]);
  });

  it('gives a passage it says only what it binds, as any body does', () => {
    expect(messages('describe { text lit }\n  passage lit { {target} is lit. }')).toEqual([
      'The passage `lit` renders `{target}`, and nothing here is called `target`.',
    ]);
  });

  it('names a passage its kind has, refused where there is none', () => {
    expect(refusedIn('describe { text glow }')).toEqual([
      [
        'lamp.sprout:4:19',
        '`Lamp` has no passage `glow`.',
        'Write `passage glow { … }` in `Lamp`, or give the words in quotes, as in `text "A lever, waist high."`.',
      ],
    ]);
  });
});

describe('a describe whose `.prose` file is absent', () => {
  function compiled(mode: 'publish' | 'load', describe: string) {
    const files = [
      ...worldFiles(
        worldLine('object mirror is Mirror'),
        `kind Mirror {\n  prose "mirror.prose"\n  ${describe}\n}`,
      ),
    ];
    const source = world({
      files,
      manifest: { files: [...files.map((f) => f.name), 'mirror.prose'] },
    });
    return compileBundle(source, { mode });
  }

  it('is refused at publish when every `text` in it names a passage that file holds', () => {
    const { bundle, diagnostics } = compiled('publish', 'describe { text greeting }');
    expect(bundle).toBeNull();
    expect(
      refusals(diagnostics)
        .filter((d) => d.message.startsWith('This `describe`'))
        .map((d) => [locationOf(d.at), d.message, d.remedy]),
    ).toEqual([
      [
        'mirror.sprout:3:3',
        "This `describe` says nothing while `Mirror`'s `.prose` file is absent: every `text` in it names a passage that file holds.",
        'Restore the file, or give the description words of its own in quotes, as in `text "A lever, waist high."`.',
      ],
    ]);
  });

  it('is not refused for it where one `text` gives words of its own', () => {
    const { diagnostics } = compiled('publish', 'describe { text greeting  text "Glass." }');
    expect(refusals(diagnostics).map((d) => d.message)).not.toContainEqual(
      expect.stringContaining('This `describe`'),
    );
  });

  it('loads, each passage it names a gap where it is said', () => {
    const { bundle, diagnostics } = compiled('load', 'describe { text greeting }');
    expect(refusals(diagnostics)).toEqual([]);
    expect(bundle!.absent.map((gap) => [gap.kind, gap.what])).toContainEqual([
      'passage',
      'greeting',
    ]);
  });
});

describe('the `text`s a describe holds', () => {
  const block = (text: string): Block => {
    const read = parseStatement(new SourceFile('b.sprout', `if (true) ${text}`), new Diagnostics());
    if (read === null || read.kind !== 'if') throw new Error('not an if');
    return read.then;
  };

  it('are every one, in every branch of every `if` and the body of every `each`, in the order written', () => {
    const found = textsIn(
      block(
        '{ text "a"  if (x) { text "b" } else if (y) { text "c" } else { if (z) { text "d" } }  each t in self { text "e" }  text "f" }',
      ),
    );
    expect(
      found.map((one) => (one.said.kind === 'prose-literal' ? one.said.value : one.said.text)),
    ).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(textsIn(block('{ let n = 1 }'))).toEqual([]);
  });
});

void file;
