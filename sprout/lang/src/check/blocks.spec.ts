import { describe, expect, it } from 'vitest';

import type { Block, KindDeclaration } from '../syntax/ast.js';
import { Diagnostics } from '../source/diagnostics.js';
import { parseDeclarations } from '../syntax/parse.js';
import { locationOf, SourceFile } from '../source/source.js';
import { integer } from '../declare/types.js';
import { bodyOf, KEY, VESSEL, at } from '../fixtures/check.js';
import { roleBinding, valueOf } from './bindings.js';
import { checkBlock, type BodyKind } from './blocks.js';
import { PassageSites } from './speech.js';
import type { ResolvedPassage } from '../declare/passages.js';
import { readProseText } from '../fixtures/parse.js';

/** A passage `full` for a kind to have, as composing resolves one. */
const FULL: ResolvedPassage = (() => {
  const { prose, source } = readProseText('No room.');
  const at = source.span(0, 0);
  return {
    name: 'full',
    origin: 'shop.Vessel',
    yields: false,
    body: { kind: 'passage-body', at, text: 'No room.', prose },
    at,
  };
})();

/** The block a play writes, as `permit { … }` holds it. The parse must succeed. */
function blockOf(statements: string): Block {
  const diagnostics = new Diagnostics();
  const [declared] = parseDeclarations(
    new SourceFile(
      'b.sprout',
      `kind B {\n  as target for pull { permit {\n    ${statements}\n  } }\n}`,
    ),
    diagnostics,
  ) as [KindDeclaration];
  expect(
    diagnostics.refusals.map((d) => d.message),
    statements,
  ).toEqual([]);
  const play = declared.members[0];
  if (play?.kind !== 'play' || play.permit === null) throw new Error('no block');
  return play.permit;
}

/**
 * Check `statements` as the body `kind` allows, in a vessel's body, with a
 * withheld tool and no verbs to act.
 */
function check(statements: string, kind: BodyKind) {
  const context = bodyOf(VESSEL);
  const tool = roleBinding(
    'tool',
    { fills: 'kind', kind: KEY },
    null,
    at('tool'),
    new Diagnostics(),
  )!;
  context.scope.withhold(
    {
      name: 'tool',
      at: at('tool'),
      unread: { message: '`tool` may be missing here.', remedy: 'Ask `bound tool` first.' },
      bound: { bindable: true, binding: tool },
    },
    context.diagnostics,
  );
  const acting = { verbs: { qualified: () => null, unqualified: () => null, all: () => [] } };
  checkBlock(blockOf(statements), { ...context, acting }, kind);
  return context.diagnostics.refusals.map((d) => [locationOf(d.at), d.message]);
}

const GUARD: BodyKind = { body: 'guard', guard: 'depart' };
const PERMIT: BodyKind = { body: 'permit' };
const DO: BodyKind = { body: 'do' };

describe('a deciding body only reads and decides', () => {
  const doing =
    'self.set(:inked, true)\n    say "Hi."\n    spawn Vessel in self\n    destroy self\n    move actor to self\n    act purr ()\n    wake in 3 hours';

  it('names a guard in what it refuses, and the guard in a `say`', () => {
    expect(check(doing, GUARD).map(([, message]) => message)).toEqual([
      '`self.set` writes, and a guard only reads and decides.',
      '`say` has nobody to speak to inside `depart`.',
      '`spawn` makes a new thing, and a guard only reads and decides.',
      '`destroy self` removes something, and a guard only reads and decides.',
      '`move` moves something, and a guard only reads and decides.',
      '`act` performs a verb, and a guard only reads and decides.',
      '`wake` asks for a wake, and a guard only reads and decides.',
    ]);
  });

  it('names a `permit` in what it refuses', () => {
    expect(check(doing, PERMIT)).toEqual([
      ['b.sprout:3:5', '`self.set` writes, and a `permit` only reads and decides.'],
      ['b.sprout:4:5', '`say` speaks, and a `permit` only decides.'],
      ['b.sprout:5:5', '`spawn` makes a new thing, and a `permit` only reads and decides.'],
      ['b.sprout:6:5', '`destroy self` removes something, and a `permit` only reads and decides.'],
      ['b.sprout:7:5', '`move` moves something, and a `permit` only reads and decides.'],
      ['b.sprout:8:5', '`act` performs a verb, and a `permit` only reads and decides.'],
      ['b.sprout:9:5', '`wake` asks for a wake, and a `permit` only reads and decides.'],
    ]);
  });

  it('refuses a `connect`, which writes where a link leads', () => {
    expect(check('connect onward to self', GUARD)).toEqual([
      ['b.sprout:3:5', '`connect` writes where a link leads, and a guard only reads and decides.'],
    ]);
    expect(check('connect onward to self', PERMIT)[0]![1]).toBe(
      '`connect` writes where a link leads, and a `permit` only reads and decides.',
    );
  });

  it('takes `refuse` and `allow`', () => {
    expect(check('if (self.count > 1) { refuse "Full." } else { allow }', PERMIT)).toEqual([]);
  });

  it('takes an `each`, which only reads, and holds its body to what the body it stands in allows', () => {
    expect(
      check('each thing in self { if (thing == actor) { refuse "Not you." } }', PERMIT),
    ).toEqual([]);
    expect(check('each thing in self { move thing to self }', GUARD)).toEqual([
      ['b.sprout:3:26', '`move` moves something, and a guard only reads and decides.'],
    ]);
    expect(check('each thing in self { move thing to self }', DO)).toEqual([]);
  });

  it('binds an `each`’s variable inside its body and nowhere after it', () => {
    expect(check('each thing in self { }\n    if (thing == actor) { allow }', PERMIT)).toHaveLength(
      1,
    );
  });
});

describe('a deciding body draws nothing', () => {
  it('refuses `chance`, `random` and `{one of}` in a guard, naming the guard', () => {
    expect(
      check(
        'if (chance(2)) { refuse "No." }\n    let n = random(6)\n    refuse "{one of}No.{or}Not now.{/one of}"',
        GUARD,
      ),
    ).toEqual([
      [
        'b.sprout:3:9',
        '`depart` may not use `chance`: a guard is asked as part of a decision it must not change.',
      ],
      [
        'b.sprout:4:13',
        '`depart` may not use `random`: a guard is asked as part of a decision it must not change.',
      ],
      [
        'b.sprout:5:13',
        '`depart` may not use `{one of}`: a guard is asked as part of a decision it must not change.',
      ],
    ]);
  });

  it('refuses them in a `permit`, inside every branch', () => {
    expect(check('if (self.count > 1) { if (random(3) == 0) { allow } }', PERMIT)).toEqual([
      [
        'b.sprout:3:31',
        'A `permit` may not use `random`: a `permit` is asked as part of a decision it must not change.',
      ],
    ]);
  });

  it('refuses a `tell` or `text` that draws once, for standing there at all, and not again for drawing', () => {
    expect(check('tell "{one of}Hi.{or}Ho.{/one of}"', GUARD)).toEqual([
      ['b.sprout:3:5', '`tell` speaks, and `depart` only reads and decides.'],
    ]);
    expect(check('tell self "{one of}Hi.{or}Ho.{/one of}"', PERMIT)).toEqual([
      ['b.sprout:3:5', '`tell` speaks, and a `permit` only decides.'],
    ]);
    expect(check('text "{one of}Hi.{or}Ho.{/one of}"', GUARD)).toEqual([
      ['b.sprout:3:5', '`text` gives a `describe` its words, and this is `depart`.'],
    ]);
  });

  it('takes them in a `do`', () => {
    expect(
      check('if (chance(2)) { say "{one of}Yes.{or}Aye.{/one of}" }\n    let n = random(6)', DO),
    ).toEqual([]);
  });
});

describe('a `do` acts', () => {
  it('takes the writes, `say`, `spawn`, `destroy`, `move`, `wake` and a `let` naming a spawn', () => {
    expect(
      check(
        'self.set(:inked, true)\n    say "Hi."\n    let v = spawn Vessel in self\n    move v to actor\n    wake in 3 hours\n    if (v != self) { destroy self }',
        DO,
      ),
    ).toEqual([]);
  });

  it('checks a `move` as a statement, which reads a withheld tool only once it is bound', () => {
    expect(check('move tool to self', DO)).toEqual([
      ['b.sprout:3:10', '`tool` may be missing here.'],
    ]);
    expect(check('if (bound tool) { move tool to self }', DO)).toEqual([]);
  });

  it('checks an `act` as a statement, against the verbs it is given and the kind acting', () => {
    // No verbs, and a vessel is no actor: both are said, of the one `act`.
    expect(check('act purr ()', DO)).toEqual([
      ['b.sprout:3:5', 'Only an actor acts, and `Vessel` does not compose `sprout.Actor`.'],
      ['b.sprout:3:9', 'Nothing declares a verb `purr`.'],
    ]);
  });

  it('checks a `connect` as a statement, against the links `self` has', () => {
    expect(check('connect onward to self', DO)).toEqual([
      ['b.sprout:3:13', '`Vessel` has no link `onward`, so there is nothing to connect.'],
      [
        'b.sprout:3:23',
        '`Vessel` does not hold actors, so nobody could stand where this link leads.',
      ],
    ]);
  });

  it('checks a `wake` as a statement, whose wait must fit what `elapsed` carries', () => {
    expect(check('wake in 999999 hours', DO)).toEqual([
      ['b.sprout:3:13', '`wake in 999999 hours` waits longer than a wake can.'],
    ]);
  });

  it('refuses `refuse` and `allow`, where the deciding is done', () => {
    expect(check('refuse "No."\n    allow', DO)).toEqual([
      ['b.sprout:3:5', '`refuse` decides, and a `do` acts.'],
      ['b.sprout:4:5', '`allow` decides, and a `do` acts.'],
    ]);
  });
});

describe('a condition opens the branch it guards', () => {
  it('binds a withheld tool inside `if (bound tool)`, and nowhere else', () => {
    expect(check('if (bound tool) { if (tool.get(:wear) > 3) { allow } }', PERMIT)).toEqual([]);
    expect(
      check('if (bound tool) { allow } else { if (tool.is(Vessel)) { allow } }', PERMIT),
    ).toEqual([['b.sprout:3:42', '`tool` may be missing here.']]);
    expect(check('if (bound tool && tool.is(Vessel)) { allow }', PERMIT)).toEqual([
      ['b.sprout:3:23', '`tool` may be missing here.'],
    ]);
  });

  it('types a withheld tool as its binding says, in the branch alone', () => {
    const context = bodyOf(VESSEL);
    const range = { narrows: 'range' as const, min: 1, max: 12, at: at('n') };
    const n = roleBinding('n', { fills: 'integer' }, range, at('n'), new Diagnostics())!;
    const words = { message: 'no', remedy: 'no' };
    context.scope.withhold(
      { name: 'n', at: at('n'), unread: words, bound: { bindable: true, binding: n } },
      context.diagnostics,
    );
    expect(context.scope.bounding(n).lookup('n')!.type).toEqual(valueOf(integer(1, 12)));
    expect(context.scope.lookup('n')).toBeNull();
    expect(context.scope.withheld('n')!.unread).toBe(words);
  });
});

describe('a handler or a hook acts, with nobody to answer or speak to', () => {
  const HANDLER: BodyKind = { body: 'handler', written: 'on :gust' };

  it('writes, spawns and destroys, as a `do` does', () => {
    expect(
      check('self.set(:inked, true)\n    spawn Vessel in self\n    destroy self', HANDLER),
    ).toEqual([]);
  });

  it('tells, the place or one it has bound, and never gives a `describe`’s `text`', () => {
    expect(check('tell "Hi."\n    tell self "Hi."', HANDLER)).toEqual([]);
    expect(check('tell "Hi."\n    text "Hi."', DO).map(([, m]) => m)).toEqual([
      '`text` gives a `describe` its words, and this is a `do`.',
    ]);
    expect(check('tell "Hi."', GUARD).map(([, m]) => m)).toEqual([
      '`tell` speaks, and `depart` only reads and decides.',
    ]);
  });

  it('refuses `say`, `refuse` and `allow`, naming the handler', () => {
    expect(check('say "Hi."\n    refuse "No."\n    allow', HANDLER).map(([, m]) => m)).toEqual([
      '`say` has nobody to speak to inside `on :gust`.',
      '`refuse` answers someone, and nobody waits on `on :gust` for an answer.',
      '`allow` answers someone, and nobody waits on `on :gust` for an answer.',
    ]);
  });
});

describe('a `describe` only reads, and gives its words with `text`', () => {
  const DESCRIBE: BodyKind = { body: 'describe' };
  const doing =
    'self.set(:inked, true)\n    spawn Vessel in self\n    destroy self\n    move actor to self\n    act purr ()\n    connect onward to self\n    wake in 3 hours';

  it('refuses everything that changes the world, naming the `describe`', () => {
    expect(check(doing, DESCRIBE).map(([, message]) => message)).toEqual([
      '`self.set` writes, and a `describe` only reads.',
      '`spawn` makes a new thing, and a `describe` only reads.',
      '`destroy self` removes something, and a `describe` only reads.',
      '`move` moves something, and a `describe` only reads.',
      '`act` performs a verb, and a `describe` only reads.',
      '`connect` writes where a link leads, and a `describe` only reads.',
      '`wake` asks for a wake, and a `describe` only reads.',
    ]);
  });

  it('takes `text`, `let` and `if`, and refuses `refuse`, `allow`, `say` and `tell`', () => {
    expect(
      check('let n = self.count\n    if (n > 1) { text "Full." } else { text "Empty." }', DESCRIBE),
    ).toEqual([]);
    expect(
      check('refuse "No."\n    allow\n    say "Hi."\n    tell "Hi."', DESCRIBE).map(([, m]) => m),
    ).toEqual([
      '`refuse` decides, and a `describe` only says what is there.',
      '`allow` decides, and a `describe` only says what is there.',
      '`say` speaks to the one acting, and a `describe` is read by whoever looks.',
      '`tell` speaks to the room, and a `describe` is read by whoever looks, and only reads.',
    ]);
  });

  it('draws nothing, in every branch', () => {
    expect(
      check(
        'if (true) { text "{one of}A{or}B{/one of}" } else { let d = random(6) }',
        DESCRIBE,
      ).map(([, m]) => m),
    ).toEqual([
      'A `describe` may not use `{one of}`: it is run whenever anyone looks, so a roll would change the thing while nobody acts.',
      'A `describe` may not use `random`: it is run whenever anyone looks, so a roll would change the thing while nobody acts.',
    ]);
  });
});

describe('a guard or a `permit` sends nothing', () => {
  it('refuses `send` and `broadcast`, which queue a message, as doing', () => {
    expect(check('send self :creak\n    broadcast :creak', GUARD).map(([, m]) => m)).toEqual([
      '`send` sends a message, and a guard only reads and decides.',
      '`broadcast` sends a message, and a guard only reads and decides.',
    ]);
    expect(check('send self :creak', PERMIT).map(([, m]) => m)).toEqual([
      '`send` sends a message, and a `permit` only reads and decides.',
    ]);
  });
});

describe('what a body says is prose, checked where it stands or where it is said from', () => {
  /** `statements` checked in a `do` of a vessel whose kind has the passage `full`, recording what it says. */
  function speaking(statements: string, absent?: (name: string) => boolean) {
    const withFull = { ...VESSEL, passages: new Map([['full', FULL]]) };
    const context = bodyOf(withFull);
    const sites = new PassageSites();
    const body = { kind: 'play', at: at('self') };
    const speech = {
      sites,
      body,
      ...(absent === undefined ? {} : { absent: (_: unknown, name: string) => absent(name) }),
    };
    checkBlock(blockOf(statements), { ...context, speech }, DO);
    return {
      said: context.diagnostics.refusals.map((d) => [locationOf(d.at), d.message]),
      sites: sites.of(body),
      rendered: sites.rendered,
    };
  }

  it('checks words in quotes as a one-line passage, in the scope they stand in', () => {
    expect(speaking('say "You fill {self}, {actor} watching."').said).toEqual([]);
    expect(speaking('say "{self.get(:inked)}"').said).toEqual([
      ['b.sprout:3:11', 'This slot is true or false, and a passage says what that means in words.'],
    ]);
    expect(speaking('let n = self.count\n    say "{n} {nothing}"').said).toEqual([
      ['b.sprout:4:15', 'Nothing here is called `nothing`.'],
    ]);
  });

  it('records a passage said by name, with what is in reach where it is said', () => {
    const { said, sites } = speaking('let n = self.count\n    say full');
    expect(said).toEqual([]);
    expect(sites.map((site) => site.name)).toEqual(['full']);
    expect(sites[0]!.scope.names().sort()).toEqual(['actor', 'here', 'n', 'self']);
  });

  it('leaves a passage its kind lacks to be told of where its `.prose` file is gone, and refuses it otherwise', () => {
    expect(speaking('say ful', (name) => name === 'ful').said).toEqual([]);
    expect(speaking('say ful').said.map(([, message]) => message)).toEqual([
      '`Vessel` has no passage `ful`. Did you mean `full`?',
    ]);
  });
});
