import { describe, expect, it } from 'vitest';

import type { Block, KindDeclaration } from '../syntax/ast.js';
import { Diagnostics } from '../source/diagnostics.js';
import { parseDeclarations } from '../syntax/parse.js';
import { locationOf, SourceFile } from '../source/source.js';
import { integer } from '../declare/types.js';
import { bodyOf, KEY, VESSEL, at } from '../fixtures/check.js';
import { roleBinding, valueOf } from './bindings.js';
import { checkBlock, type BodyKind } from './blocks.js';

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

  it('takes `refuse` and `allow`', () => {
    expect(check('if (self.count > 1) { refuse "Full." } else { allow }', PERMIT)).toEqual([]);
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

  it('refuses `say`, `refuse` and `allow`, naming the handler', () => {
    expect(check('say "Hi."\n    refuse "No."\n    allow', HANDLER).map(([, m]) => m)).toEqual([
      '`say` has nobody to speak to inside `on :gust`.',
      '`refuse` answers someone, and nobody waits on `on :gust` for an answer.',
      '`allow` answers someone, and nobody waits on `on :gust` for an answer.',
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
