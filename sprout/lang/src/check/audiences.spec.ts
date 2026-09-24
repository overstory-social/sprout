import { describe, expect, it } from 'vitest';

import type { RefuseStatement, Statement } from '../syntax/ast.js';
import { compileBundle } from '../bundle/compile/compile.js';
import { Diagnostics } from '../source/diagnostics.js';
import { locationOf } from '../source/source.js';
import { integer } from '../declare/types.js';
import { readStatement } from '../fixtures/parse.js';
import { bodyOf, KEY, VESSEL, at } from '../fixtures/check.js';
import { refusals, world, worldFiles, worldLine } from '../fixtures/compile.js';
import { actorBinding, letBinding, setRoleBinding, valueOf } from './bindings.js';
import type { BodyKind } from './blocks.js';
import { checkPassage, checkSpoken, type Spoken } from './audiences.js';
import { PassageSites } from './speech.js';
import { Scope } from './bindings.js';

const GUARD: BodyKind = { body: 'guard', guard: 'depart' };
const PERMIT: BodyKind = { body: 'permit' };
const DO: BodyKind = { body: 'do' };
const HANDLER: BodyKind = { body: 'handler', written: 'on :gust' };
const DESCRIBE: BodyKind = { body: 'describe' };

/** The statement `text` reads as, which must read. */
function statementOf(text: string): Statement {
  const { statement, refusals } = readStatement(text);
  expect(
    refusals.map((d) => d.message),
    text,
  ).toEqual([]);
  return statement!;
}

/**
 * `text` checked where `kind` stands, in a vessel's body with a set role
 * `tools`, a count `n`, and `actor` withheld where the body is a handler's.
 */
function spoken(text: string, kind: BodyKind) {
  const base = bodyOf(
    VESSEL,
    setRoleBinding('tools', KEY, at('tools')),
    letBinding('n', valueOf(integer(0, 9)), at('n')),
  );
  let scope = base.scope;
  if (kind.body === 'handler') {
    // A handler binds no `actor`: withheld, as `check/handlers.ts` withholds it.
    scope = Scope.root();
    for (const binding of base.scope.bound()) {
      if (binding.name !== 'actor') scope.introduce(binding, new Diagnostics());
    }
    const words = { message: '`actor` is not bound inside `on :gust`.', remedy: 'Name it.' };
    scope.withhold(
      {
        name: 'actor',
        at: actorBinding(null, at('actor')).at,
        unread: words,
        bound: { bindable: false, words },
      },
      new Diagnostics(),
    );
  }
  const context = { ...base, scope };
  checkSpoken(statementOf(text) as Spoken, context, kind);
  return context.diagnostics.refusals.map((d) => [locationOf(d.at), d.message, d.remedy]);
}

describe('`say` speaks to the actor, and stands only in a `do`', () => {
  it('is checked in a `do`, and refused everywhere nobody is spoken to', () => {
    expect(spoken('say "You fill {self}."', DO)).toEqual([]);
    expect(spoken('say "Hi."', HANDLER)).toEqual([
      [
        'body.sprout:1:1',
        '`say` has nobody to speak to inside `on :gust`.',
        'Use `tell` to speak to the room, or `tell p` to one person.',
      ],
    ]);
    expect(spoken('say "Hi."', GUARD).map(([, message]) => message)).toEqual([
      '`say` has nobody to speak to inside `depart`.',
    ]);
    expect(spoken('say "Hi."', PERMIT).map(([, message]) => message)).toEqual([
      '`say` speaks, and a `permit` only decides.',
    ]);
  });
});

describe('`tell` speaks to the place or to one person, in a `do` or a handler', () => {
  it('is checked in a `do` and a handler, words and all', () => {
    expect(spoken('tell "{actor} fills {self}."', DO)).toEqual([]);
    expect(spoken('tell self "You are filled."', DO)).toEqual([]);
    expect(spoken('tell "The wind picks up in the eaves."', HANDLER)).toEqual([]);
    expect(spoken('tell "{nothing}"', HANDLER).map(([, message]) => message)).toEqual([
      'Nothing here is called `nothing`.',
    ]);
  });

  it('refuses `{actor}` where nobody is acting, in the words the handler withholds it in', () => {
    expect(spoken('tell "{actor} shivers."', HANDLER).map(([, message]) => message)).toEqual([
      '`actor` is not bound inside `on :gust`.',
    ]);
    expect(spoken('tell actor "You shiver."', HANDLER).map(([, message]) => message)).toEqual([
      '`actor` is not bound inside `on :gust`.',
    ]);
  });

  it('refuses it in a guard and a `permit`, which only decide', () => {
    expect(spoken('tell "Hi."', GUARD)).toEqual([
      [
        'body.sprout:1:1',
        '`tell` speaks, and `depart` only reads and decides.',
        'Move it to a handler or a `do`; a guard ends in `allow` or `refuse`.',
      ],
    ]);
    expect(spoken('tell self "Hi."', PERMIT)).toEqual([
      [
        'body.sprout:1:1',
        '`tell` speaks, and a `permit` only decides.',
        'Move it to `do`; a `permit` ends in `allow` or `refuse`.',
      ],
    ]);
  });

  it('refuses telling a set or a value, which is not one person', () => {
    const remedy =
      'Tell one person a body has bound, as in `tell actor "…"`, or tell the place, as in `tell "{actor} pulls the lever."`.';
    expect(spoken('tell tools "Hi."', DO)).toEqual([
      [
        'body.sprout:1:6',
        '`tools` holds several things, and `tell tools` speaks to one person.',
        remedy,
      ],
    ]);
    expect(spoken('tell n "Hi."', DO)).toEqual([
      ['body.sprout:1:6', '`tell` speaks to one person, and `n` is integer 0 to 9.', remedy],
    ]);
  });
});

describe('`text` gives a `describe` its words, and stands nowhere else', () => {
  it('is checked in a `describe`, words and all, as `say` is in a `do`', () => {
    expect(spoken('text "{actor} sees {self}, {n} times."', DESCRIBE)).toEqual([]);
    expect(spoken('text "{nothing}"', DESCRIBE).map(([, message]) => message)).toEqual([
      'Nothing here is called `nothing`.',
    ]);
  });

  it('is the only one of the three a `describe` takes', () => {
    expect(spoken('say "Hi."', DESCRIBE)).toEqual([
      [
        'body.sprout:1:1',
        '`say` speaks to the one acting, and a `describe` is read by whoever looks.',
        'Write `text` in its place, as in `text "A lever, waist high."`.',
      ],
    ]);
    expect(spoken('tell self "Hi."', DESCRIBE).map(([, message]) => message)).toEqual([
      '`tell` speaks to the room, and a `describe` is read by whoever looks, and only reads.',
    ]);
  });

  it('is refused in every body with what to write there instead', () => {
    expect(spoken('text "Hi."', DO)).toEqual([
      [
        'body.sprout:1:1',
        '`text` gives a `describe` its words, and this is a `do`.',
        'Use `say` to speak to the actor, or `tell` to speak to the room.',
      ],
    ]);
    expect(spoken('text greeting', HANDLER)).toEqual([
      [
        'body.sprout:1:1',
        '`text` gives a `describe` its words, and this is `on :gust`.',
        'Use `tell` to speak to the room, or `tell p` to one person.',
      ],
    ]);
    expect(spoken('text "Hi."', GUARD).map(([, message]) => message)).toEqual([
      '`text` gives a `describe` its words, and this is `depart`.',
    ]);
    expect(spoken('text "Hi."', PERMIT)).toEqual([
      [
        'body.sprout:1:1',
        '`text` gives a `describe` its words, and this is a `permit`.',
        'Take it out; the words a refusal gives go after `refuse`, as in `refuse "No room here."`.',
      ],
    ]);
  });
});

describe('a passage said by name', () => {
  it('is recorded with what is in reach, and refused where the kind has none by that name', () => {
    const context = bodyOf(VESSEL);
    const sites = new PassageSites();
    const body = statementOf('refuse full') as RefuseStatement;
    const speaking = { ...context, speech: { sites, body } };
    checkPassage(statementOf('tell self pulled') as Spoken & { kind: 'tell' }, speaking);
    expect(context.diagnostics.refusals.map((d) => [d.message, d.remedy])).toEqual([
      [
        '`Vessel` has no passage `pulled`.',
        'Write `passage pulled { … }` in `Vessel`, or give the words in quotes, as in `tell self "{actor} pulls the lever."`.',
      ],
    ]);
    expect(sites.of(body)).toEqual([]);
  });
});

describe('`tell <x>` names someone a body has bound', () => {
  /** What compiling a world whose lever says `statement` in a `do` refuses. */
  function refusedIn(statement: string): string[][] {
    const files = worldFiles(
      `${worldLine('object lever is Lever')}\nverb pull { role target  "pull [target]" }`,
      `kind Lever {\n  as target for pull { do {\n    say "It gives."\n    ${statement}\n  } }\n}`,
    );
    const { diagnostics } = compileBundle(world({ files }));
    return refusals(diagnostics).map((d) => [locationOf(d.at), d.message]);
  }

  it('reaches a binding', () => {
    expect(refusedIn('tell actor "You pull it."')).toEqual([]);
    expect(refusedIn('tell self "Pulled."')).toEqual([]);
  });

  it('refuses an object of the world, by its identifier or down a path, since none is a person', () => {
    const message =
      'is an object of the world, which is never a person, so nobody would read what it is told.';
    expect(refusedIn('tell hall "Hi."')).toEqual([['lever.sprout:4:10', `\`hall\` ${message}`]]);
    expect(refusedIn('tell printers_shop.hall "Hi."')).toEqual([
      ['lever.sprout:4:10', `\`printers_shop.hall\` ${message}`],
    ]);
  });

  it('refuses a name that is nothing, in the words any name is', () => {
    expect(refusedIn('tell nobody "Hi."').map(([, said]) => said)).toEqual([
      expect.stringContaining('Nothing here is called `nobody`.'),
    ]);
  });
});
