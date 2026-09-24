import { describe, expect, it } from 'vitest';

import type { KindDeclaration, KindMember } from '../syntax/ast.js';
import { writtenPass } from '../syntax/ast-events.js';
import { Diagnostics } from '../source/diagnostics.js';
import { locationOf, SourceFile } from '../source/source.js';
import { parseDeclarations } from '../syntax/parse.js';
import { EnumTable } from './enums.js';
import { KindTable, type KindRef } from './kinds.js';
import { MessageTable } from './messages.js';
import { composePassRules, NO_PASS_RULES, ownPassRules } from './passes.js';

function composed(text: string) {
  const diagnostics = new Diagnostics();
  const declared = parseDeclarations(
    new SourceFile('k.sprout', `message :illuminating with boolean\n${text}`),
    diagnostics,
  );
  const messages = new MessageTable();
  messages.add(
    'shop',
    declared.filter((d) => d.kind === 'message'),
    new EnumTable(),
    diagnostics,
  );
  const kinds = new KindTable();
  kinds.add(
    'shop',
    declared.filter((d): d is KindDeclaration => d.kind === 'kind'),
    diagnostics,
  );
  kinds.resolve('shop', new EnumTable(), diagnostics, undefined, { messages });
  return {
    kind: (name: string): KindRef => kinds.qualified('shop', name)!,
    said: diagnostics.refusals.map((d) => [locationOf(d.at), d.message, d.remedy]),
    messages,
  };
}

/** A kind's rules as origin per head: `pass any` and each `pass :m`. */
const rules = (kind: KindRef): string[] => [
  ...(kind.passes.any === null ? [] : [`pass any ${kind.passes.any.origin}`]),
  ...[...kind.passes.messages].map(([key, rule]) => `${key} ${rule.origin}`),
];

describe('pass rules compose as an exclusive member', () => {
  it('a kind with none relays, and its composer takes the one it composes', () => {
    const { kind, said } = composed(
      'kind Box { contains }\nkind Glass { contains pass :illuminating (true) pass any (false) }\nkind Case is Glass { }',
    );
    expect(said).toEqual([]);
    expect(kind('Box').passes).toEqual(NO_PASS_RULES);
    expect(rules(kind('Case'))).toEqual(['pass any shop.Glass', 'shop.illuminating shop.Glass']);
  });

  it('the composer’s own replaces what it composes', () => {
    const { kind, said } = composed(
      'kind Glass { contains pass any (false) }\nkind Case is Glass { pass any (true) }',
    );
    expect(said).toEqual([]);
    expect(rules(kind('Case'))).toEqual(['pass any shop.Case']);
  });

  it('two sources are refused at the kind that brought the second, and the first is kept', () => {
    const { kind, said } = composed(
      'kind Glass { contains pass any (true) }\nkind Oak { contains pass any (false) }\nkind Case is Glass, Oak { }',
    );
    expect(said).toEqual([
      [
        'k.sprout:4:21',
        '`Case` gets `pass any` from both `Glass` and `Oak`, and a container has one rule for each message.',
        'Write `pass any (…)` in `Case` to say which applies.',
      ],
    ]);
    expect(rules(kind('Case'))).toEqual(['pass any shop.Glass']);
  });

  it('one origin by two paths is one rule', () => {
    const { said } = composed(
      'kind Lid { contains pass any (false) }\nkind A is Lid { }\nkind B is Lid { }\nkind C is A, B { }',
    );
    expect(said).toEqual([]);
  });

  it('one written twice in a body is refused at the second', () => {
    const { said } = composed('kind Case { contains pass any (true) pass any (false) }');
    expect(said.map(([, message]) => message)).toEqual(['`Case` writes `pass any` twice.']);
  });

  it('is what `ownPassRules` and `composePassRules` build', () => {
    const { messages } = composed('');
    const diagnostics = new Diagnostics();
    const [declared] = parseDeclarations(
      new SourceFile('k.sprout', 'kind K { pass :illuminating (true) }'),
      diagnostics,
    ) as [KindDeclaration];
    const own = ownPassRules('K', declared.members as KindMember[], 'shop.K', {
      library: 'shop',
      messages,
      diagnostics,
    });
    const built = composePassRules('K', [], own, (origin) => origin, diagnostics);
    expect([...built.messages.values()].map((rule) => writtenPass(rule.declaration))).toEqual([
      'pass :illuminating',
    ]);
    expect(built.any).toBeNull();
  });
});
