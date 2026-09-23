import { describe, expect, it } from 'vitest';

import type { KindDeclaration, KindMember } from '../syntax/ast.js';
import { Diagnostics } from '../source/diagnostics.js';
import { parseDeclarations } from '../syntax/parse.js';
import { SourceFile } from '../source/source.js';
import { EnumTable } from './enums.js';
import { KindTable, type KindRef } from './kinds.js';
import { MessageTable } from './messages.js';
import {
  composeHandlers,
  namedMessage,
  ownHandlers,
  ownHooks,
  writesHandler,
  writesHook,
} from './handlers.js';

const MESSAGES = 'message :stir\nmessage :gust\n';

/** Every kind in `text`, in the library `shop`, composed with its messages; what was said. */
function composed(text: string, library = 'shop') {
  const diagnostics = new Diagnostics();
  const declared = parseDeclarations(new SourceFile('k.sprout', `${MESSAGES}${text}`), diagnostics);
  const messages = new MessageTable();
  messages.add(
    library,
    declared.filter((d) => d.kind === 'message'),
    new EnumTable(),
    diagnostics,
  );
  const kinds = new KindTable();
  kinds.add(
    library,
    declared.filter((d): d is KindDeclaration => d.kind === 'kind'),
    diagnostics,
  );
  kinds.resolve(library, new EnumTable(), diagnostics, undefined, { messages });
  return {
    kind: (name: string): KindRef => kinds.qualified(library, name)!,
    messages: diagnostics.refusals.map((d) => d.message),
    table: messages,
  };
}

/** Which kinds' handlers a kind runs for `key`, in order. */
const runs = (kind: KindRef, key: string): string[] =>
  (kind.handlers.get(key) ?? []).map((one) => one.origin);

describe('handlers compose', () => {
  it('all run, in closure order, the composer’s own last', () => {
    const { kind, messages } = composed(
      [
        'kind A { on :stir { } }',
        'kind B is A { on :stir { } }',
        'kind C is A { on :stir { } }',
        'kind D is B, C { on :stir { } }',
      ].join('\n'),
    );
    expect(messages).toEqual([]);
    expect(runs(kind('D'), 'shop.stir')).toEqual(['shop.A', 'shop.B', 'shop.C', 'shop.D']);
  });

  it('are keyed by the message as it resolved, an engine message by its bare name', () => {
    const { kind } = composed('kind Room { contains on :entered (item, from) { } on :gust { } }');
    expect([...kind('Room').handlers.keys()]).toEqual(['entered', 'shop.gust']);
  });

  it('leave out what `without` names, and only from the kind that wrote it', () => {
    const { kind, messages } = composed(
      [
        'kind Bellows { on :stir { } }',
        'kind Forge is Bellows { without on :stir from Bellows  on :stir { } }',
      ].join('\n'),
    );
    expect(messages).toEqual([]);
    expect(runs(kind('Forge'), 'shop.stir')).toEqual(['shop.Forge']);
  });

  it('refuse one message answered twice in one body, and a message nothing declares', () => {
    const { messages } = composed('kind Cat { on :stir { } on :stir { } on :stirr { } }');
    expect(messages).toEqual([
      '`Cat` writes `on :stir` twice.',
      'Nothing declares a message `:stirr`. Did you mean `:stir`?',
    ]);
  });

  it('are what `ownHandlers` and `composeHandlers` build, told of an unknown one by the hook given', () => {
    const { table } = composed('');
    const diagnostics = new Diagnostics();
    const told: string[] = [];
    const [declared] = parseDeclarations(
      new SourceFile('k.sprout', 'kind K { on :stir { } on :nothing { } }'),
      diagnostics,
    ) as [KindDeclaration];
    const own = ownHandlers('K', declared.members as KindMember[], 'shop.K', {
      library: 'shop',
      messages: table,
      diagnostics,
      onUnknownMessage: (written) => told.push(written.text),
    });
    expect(told).toEqual(['nothing']);
    expect(diagnostics.refusals).toEqual([]);
    expect([...composeHandlers([], [], [], own).keys()]).toEqual(['shop.stir']);
  });

  it('say which kind wrote one, for `without` to find', () => {
    const { kind } = composed(
      'kind A { on :stir { } :lit false changed :lit { } }\nkind B is A { }',
    );
    expect(writesHandler(kind('B').handlers, 'stir', 'shop.A')).toBe(true);
    expect(writesHandler(kind('B').handlers, 'stir', 'shop.B')).toBe(false);
    expect(writesHook(kind('B').hooks, 'lit', 'shop.A')).toBe(true);
  });
});

describe('hooks compose', () => {
  it('all run, by the property they watch', () => {
    const { kind } = composed(
      'kind A { :lit false changed :lit { } }\nkind B is A { changed :lit { } }',
    );
    expect((kind('B').hooks.get('lit') ?? []).map((one) => one.origin)).toEqual([
      'shop.A',
      'shop.B',
    ]);
  });

  it('refuse one property watched twice in one body', () => {
    const diagnostics = new Diagnostics();
    const [declared] = parseDeclarations(
      new SourceFile('k.sprout', 'kind K { changed :lit { } changed :lit { } }'),
      diagnostics,
    ) as [KindDeclaration];
    ownHooks('K', declared.members as KindMember[], 'shop.K', diagnostics);
    expect(diagnostics.refusals.map((d) => d.message)).toEqual([
      '`K` writes `changed :lit` twice.',
    ]);
  });
});

describe('a message a member names', () => {
  it('is the engine’s, then the library’s own, and refused where nothing declares it', () => {
    const { table } = composed('');
    const diagnostics = new Diagnostics();
    const setting = { library: 'shop', messages: table, diagnostics };
    const ident = (text: string) => ({
      kind: 'ident' as const,
      text,
      at: new SourceFile('m.sprout', text).span(0, text.length),
    });
    expect(namedMessage(ident('tick'), setting)).toMatchObject({ engine: { name: 'tick' } });
    expect(namedMessage(ident('gust'), setting)).toMatchObject({ declared: { name: 'gust' } });
    expect(namedMessage(ident('nope'), setting)).toBeNull();
    expect(diagnostics.refusals.map((d) => d.message)).toEqual([
      'Nothing declares a message `:nope`.',
    ]);
  });
});
