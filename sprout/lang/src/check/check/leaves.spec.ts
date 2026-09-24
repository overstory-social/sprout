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
import { bindingType, leafType } from './leaves.js';

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

  it('refuses a free call that is not a draw, and a draw not given one number written out', () => {
    const context = vessel();
    expect(read('roll(30)', context).type).toBeNull();
    expect(context.diagnostics.refusals[0]!.message).toContain('`roll`');
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

  it('types a free call as the draw it is, and refuses any other', () => {
    const context = checking(vessel());
    expect(leafType(expression('random(6)'), context)).toEqual(valueOf(integer(0, 5)));
    expect(leafType(expression('chance(3)'), context)).toEqual(valueOf(BOOLEAN));
    expect(saidBy(context)).toEqual([]);
    expect(leafType(expression('roll(6)'), context)).toBeNull();
    expect(saidBy(context)).toEqual([
      'Sprout does not know how to read `roll` here. The calls written with nothing before them are `chance(…)` and `random(…)`; a reading is written on what it reads, as in `self.get(:wear)`.',
    ]);
  });
});

describe('a name withheld, and `bound`', () => {
  const withholding = (bindable: boolean) => {
    const context = bodyOf(VESSEL);
    const words = { message: '`topic` has no options here.', remedy: 'Write `topic from :knows`.' };
    const binding = loopBinding('topic', null, at('topic'));
    context.scope.withhold(
      {
        name: 'topic',
        at: at('topic'),
        unread: words,
        bound: bindable ? { bindable: true, binding } : { bindable: false, words },
      },
      context.diagnostics,
    );
    return context;
  };

  it('refuses a read of a withheld name in its own words', () => {
    const context = withholding(true);
    expect(read('topic', context).said).toEqual([
      '`topic` has no options here. Write `topic from :knows`.',
    ]);
  });

  it('types `bound` of a tool that may be bound as boolean, and refuses one that never is', () => {
    expect(read('bound topic', withholding(true)).type).toEqual(valueOf(BOOLEAN));
    const never = withholding(false);
    expect(read('bound topic', never).type).toBeNull();
    expect(saidBy(never)).toEqual(['`topic` has no options here. Write `topic from :knows`.']);
  });

  it('refuses `bound` outside a role, on what is not a tool, and on a name nothing answers to', () => {
    const outside = bodyOf(VESSEL);
    expect(read('bound self', outside).said).toEqual([
      "`bound` asks whether a verb's tool was given, and `self` is the role-player. Ask it inside a role's `permit` or `do`, of a tool some phrase leaves out.",
    ]);
    expect(read('bound shelf', bodyOf(VESSEL)).said.join(' ')).toContain(
      'Nothing here is called `shelf`.',
    );
  });
});
