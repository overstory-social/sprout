// The bottom of a spine: literals, names in scope, and what is written
// where a value is wanted but is not one.

import { describe, expect, it } from 'vitest';

import { loopBinding, objectOf, valueOf } from '../bindings.js';
import { BOOLEAN, integer, STRING } from '../../declare/types.js';
import { Diagnostics } from '../../source/diagnostics.js';
import { parseExpression } from '../../syntax/parse.js';
import { SourceFile } from '../../source/source.js';
import {
  at,
  bodyOf,
  checking,
  expression,
  read,
  saidBy,
  VESSEL,
  vessel,
  warded,
} from '../../fixtures/check.js';
import { bindingType, FREE_CALLS, leafType } from './leaves.js';

describe('the names a statement reads through', () => {
  const written = (text: string) =>
    parseExpression(new SourceFile('b.sprout', text), new Diagnostics())!;

  it('types a name by what it is bound to, and refuses one nothing answers to', () => {
    const context = vessel();
    const name = (text: string) => {
      const expr = written(text);
      if (expr.kind !== 'binding') throw new Error(`${text} is not a name`);
      return expr.name;
    };
    expect(bindingType(name('self'), context)).toEqual({ binds: 'object', kind: VESSEL });
    expect(bindingType(name('shelf'), context)).toBeNull();
    expect(saidBy(context).join(' ')).toContain('Nothing here is called `shelf`.');
  });
});

describe('it never guesses, and never dies', () => {
  it('refuses a bare option and a bare kind, which are not values', () => {
    const option = vessel();
    expect(read(':wet', option).type).toBeNull();
    expect(saidBy(option).join(' ')).toContain('does not say which enum');

    const bare = vessel();
    expect(read('Key', bare).type).toBeNull();
    expect(saidBy(bare).join(' ')).toContain('is a kind, not a value');
  });

  it('refuses a free call, because `chance` and `random` are not read yet', () => {
    const context = vessel();
    expect(read('chance(30)', context).type).toBeNull();
    expect(context.diagnostics.refusals[0]!.message).toContain('`chance`');
  });

  it('suggests a name in reach when one is misspelt', () => {
    const context = bodyOf(VESSEL, loopBinding('thing', null, at('thing')));
    expect(read('thnig', context).type).toBeNull();
    expect(saidBy(context).join(' ')).toContain('Did you mean `thing`?');
  });
});

describe('the bottom of a spine, asked directly', () => {
  it('types a literal as what it is, and a name as what it is bound to', () => {
    const context = checking(vessel());
    expect(leafType(expression('true'), context)).toEqual(valueOf(BOOLEAN));
    expect(leafType(expression('12'), context)).toEqual(valueOf(integer()));
    expect(leafType(expression('"a line"'), context)).toEqual(valueOf(STRING));
    expect(leafType(expression('self'), context)).toEqual(objectOf(VESSEL));
    expect(context.diagnostics.refusals).toEqual([]);
  });

  it('checks `sym == x` against its right, the one binary a spine ends on', () => {
    const context = checking(warded());
    expect(leafType(expression(':oak == self.get(:ward)'), context)).toEqual(valueOf(BOOLEAN));
    expect(context.diagnostics.refusals).toEqual([]);
  });

  it('reads no free call yet, and says so for every one', () => {
    // B33 fills the table with `chance` and `random`.
    expect(FREE_CALLS.size).toBe(0);
    const context = checking(vessel());
    expect(leafType(expression('random(6)'), context)).toBeNull();
    expect(saidBy(context)).toEqual([
      'Sprout does not know how to read `random` here. This compiler reads nothing.',
    ]);
  });
});
