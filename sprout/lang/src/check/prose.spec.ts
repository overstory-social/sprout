import { describe, expect, it } from 'vitest';

import type { Node } from '../source/nodes.js';
import { textOf } from '../source/source.js';
import type { ResolvedPassage } from '../declare/passages.js';
import { readProseText } from '../fixtures/parse.js';
import { at, bodyOf, saidBy, vessel, VESSEL, warded, WARDED } from '../fixtures/check.js';
import type { CheckContext } from './check.js';
import { checkProse } from './prose.js';
import type { PassageRendered } from './speech.js';

/** `text` checked as prose in `context`, with what it recorded. */
function checked(text: string, context: CheckContext) {
  const { prose, refusals } = readProseText(text);
  if (refusals.length > 0) throw new Error(`\`${text}\` did not read: ${refusals[0]!.message}`);
  const rendered: PassageRendered[] = [];
  const options: Node[] = [];
  checkProse(prose, context, {
    render: (site) => rendered.push(site),
    option: (slot) => options.push(slot),
  });
  return { said: saidBy(context), rendered, options: options.map((slot) => textOf(slot.at)) };
}

/** A passage of `name` for a kind to have, as composing resolves one. */
function passage(name: string): ResolvedPassage {
  const { prose, source } = readProseText(`the words of ${name}`);
  return {
    name,
    origin: 'shop.Vessel',
    yields: false,
    body: { kind: 'passage-body', at: source.span(0, 0), text: '', prose },
    at: source.span(0, 0),
  };
}

describe('a slot renders an object, an option, a number, a string, or a passage', () => {
  it('takes each of them, and records which render an option', () => {
    const { said, options } = checked(
      '{self} {actor} {self.get(:ward)} {self.get(:note)} {self.count} {"quoted"}',
      bodyOf({ ...WARDED, contains: true }),
    );
    expect(said).toEqual([]);
    expect(options).toEqual(['{self.get(:ward)}']);
  });

  it('refuses a boolean, which an `{if}` says in words', () => {
    expect(checked('{self.get(:sealed)}', warded()).said).toEqual([
      'This slot is true or false, and a passage says what that means in words. Write an `{if}`: `{if <condition>}…{else}…{/if}`.',
    ]);
  });

  it('refuses a whole list and a whole set, whose joining is the author’s', () => {
    expect(checked('{self.get(:row)}', warded()).said).toEqual([
      'A slot does not render [Ward] whole: how its elements are joined, and what is said when there are none, is yours. Walk it: `{for x of <list>}{x}{if $last}.{else}, {/if}{/for}`.',
    ]);
    expect(checked('{tools}', vessel()).said).toEqual([
      'A slot does not render a set of shop.Rib whole: how its things are joined, and what is said when there are none, is yours. Walk it: `{for x of <set>}{x}{if $last}.{else}, {/if}{/for}`.',
    ]);
  });

  it('refuses arithmetic, in a slot and in a condition, and takes a negative number as a number', () => {
    const said = checked(
      '{self.count + 1}{if self.count > -1}x{/if}{if -self.count < 0}y{/if}',
      vessel(),
    ).said;
    expect(said).toEqual([
      'A passage reads what is there and does no arithmetic. Render a number as it is held, as in `{self.count}`, and let an `{if}` choose the words around it.',
      'A passage reads what is there and does no arithmetic. Render a number as it is held, as in `{self.count}`, and let an `{if}` choose the words around it.',
    ]);
  });

  it('refuses a write, which a passage never makes', () => {
    expect(checked('{self.set(:inked, true)}', vessel()).said).toEqual([
      'A passage only reads, and `set` writes. Write it in the body that says the passage, before the passage is said.',
    ]);
    expect(checked('{if actor.remember(:seen, true)}x{/if}', vessel()).said).toEqual([
      'A passage only reads, and `remember` writes. Write it in the body that says the passage, before the passage is said.',
    ]);
  });
});

describe('a slot that renders a passage names it through a thing of a kind that has it', () => {
  const withPassage = { ...VESSEL, passages: new Map([['greeting', passage('greeting')]]) };

  it('records the passage, the kind it is read through, and only `actor` and `here` to run it with', () => {
    const { said, rendered } = checked('{self.greeting}', bodyOf(withPassage));
    expect(said).toEqual([]);
    expect(rendered.map((site) => [site.name, site.kind.name, textOf(site.at)])).toEqual([
      ['greeting', 'Vessel', 'greeting'],
    ]);
    expect(rendered[0]!.scope.names().sort()).toEqual(['actor', 'here']);
  });

  it('refuses a passage the kind does not have, offering the nearest', () => {
    expect(checked('{self.greting}', bodyOf(withPassage)).said).toEqual([
      '`Vessel` has no passage `greting`. Did you mean `greeting`? Write `passage greting { … }` in `Vessel`, or render one it has: `greeting`.',
    ]);
  });

  it('refuses a passage of what is not a thing, and of a thing whose kind is not known', () => {
    expect(checked('{self.get(:capacity).greeting}', bodyOf(withPassage)).said).toEqual([
      'Only a thing in the world has passages, and this is integer 0 to 9. Name a binding that holds a thing in the world, as in `{pot.greeting}`.',
    ]);
    expect(checked('{target.greeting}', vessel()).said).toEqual([
      'Sprout does not know what this is, so it cannot render one of its passages. Narrow it first, as in `{if thing.is(Pot)}{thing.greeting}{/if}`.',
    ]);
  });
});

describe('a condition compares, narrows, and tests identity', () => {
  it('takes a boolean, and narrows a thing with `is()` in the branch it guards', () => {
    const { said } = checked(
      '{if target.is(Vessel)}{target.get(:capacity)}{else}{target}{/if}{if target != self}x{/if}',
      vessel(),
    );
    expect(said).toEqual([]);
  });

  it('refuses a condition that is not true or false', () => {
    expect(checked('{if self.count}x{/if}', vessel()).said).toEqual([
      'A condition is true or false, and this is integer. Compare it, as in `self.get(:wear) >= 99`, or narrow it with `is()`.',
    ]);
  });

  it('keeps the narrowing to its branch', () => {
    expect(
      checked('{if target.is(Vessel)}x{else}{target.get(:capacity)}{/if}', vessel()).said[0],
    ).toMatch(/^Sprout does not know what this is/);
  });
});

describe('a loop walks contents, a kind among them, a list or a set', () => {
  it('types what it binds by what it walks', () => {
    const { said, options } = checked(
      [
        '{for thing in self}{thing}{/for}',
        '{for v: Vessel in self}{v.get(:capacity)}{/for}',
        '{for rib of tools}{rib.get(:cracked)}{/for}',
      ].join(''),
      vessel(),
    );
    expect(said).toEqual([
      'This slot is true or false, and a passage says what that means in words. Write an `{if}`: `{if <condition>}…{else}…{/if}`.',
    ]);
    expect(options).toEqual([]);
    expect(checked('{for w of self.get(:row)}{w}{/for}', warded()).options).toEqual(['{w}']);
  });

  it('binds the loop’s own names inside it, and nowhere else', () => {
    expect(
      checked(
        '{for t in self}{$index} of {$count}{if $first}!{/if}{if !$last}, {/if}{/for}',
        vessel(),
      ).said,
    ).toEqual([]);
    expect(checked('{$index}', vessel()).said).toEqual([
      "`$index` is a loop's own, and only a `{for}` binds it. Use it between `{for …}` and the `{/for}` that closes it.",
    ]);
  });

  it('refuses a walk of contents over what holds nothing, or might not, or is no thing', () => {
    expect(checked('{for t in actor}{t}{/for}', warded()).said).toEqual([]);
    expect(checked('{for t in self}{t}{/for}', warded()).said).toEqual([
      '`Warded` holds nothing, so there is nothing to walk. Containment is a declaration: a kind that holds things writes `contains`.',
    ]);
    expect(checked('{for t in target}{t}{/for}', vessel()).said).toEqual([
      'Sprout does not know whether this holds anything. Narrow it first, as in `{if thing.is(sprout.Container)}…{/if}`.',
    ]);
    expect(checked('{for t in self.count}{t}{/for}', vessel()).said).toEqual([
      '`{for … in}` walks what a thing holds, and this is integer. Walk a list or a role marked `many` with `{for x of …}`.',
    ]);
  });

  it('refuses a walk of a list over what is not one, and a filter naming no kind', () => {
    expect(checked('{for t of self}{t}{/for}', vessel()).said).toEqual([
      '`{for … of}` walks a list or a set role, and this is `Vessel`. To walk what it holds, write `{for t in …}`.',
    ]);
    expect(checked('{for t: Nope in self}{t}{/for}', vessel()).said).toEqual([
      'Nothing here is a `Nope`. Write a kind this world declares, or one a library it uses exports.',
    ]);
  });

  it('refuses a loop variable that takes a name already in reach', () => {
    expect(checked('{for tools in self}x{/for}', vessel()).said).toEqual([
      "`tools` already names this verb's role here. Two things answering to one name is the opposite of what naming is for. Give this one another name.",
    ]);
  });
});

describe('a name in a slot is a binding in reach, or an object named from where it is written', () => {
  it('refuses a name nothing answers to, listing what is in reach', () => {
    const said = checked('{target}', bodyOf(VESSEL)).said;
    expect(said[0]).toMatch(/^Nothing here is called `target`\./);
    expect(at('target').source.name).toBe('shop.sprout');
  });
});

describe('a `{one of}` checks each of its choices', () => {
  it('checks what every choice holds, each in a scope of its own', () => {
    const { said } = checked(
      '{one of}{for t in self}{t}{/for}{or}{t}{or}{self.get(:ward)}{/one of}',
      bodyOf({ ...WARDED, contains: true }),
    );
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('Nothing here is called `t`.');
  });

  it('is refused where the prose draws nothing, and still checks its choices', () => {
    const context: CheckContext = { ...warded(), undrawn: { by: 'permit' } };
    expect(checked('{one of}a{or}{nobody}{/one of}', context).said).toEqual([
      'A `permit` may not use `{one of}`: a `permit` is asked as part of a decision it must not change. Roll in a `do`, a handler or a tick, keep what it gave on a property, and read that here.',
      expect.stringContaining('Nothing here is called `nobody`.'),
    ]);
  });

  it('hands a slot it renders the prose’s reason to draw nothing', () => {
    const withPassage = { ...VESSEL, passages: new Map([['greeting', passage('greeting')]]) };
    const guarded: CheckContext = {
      ...bodyOf(withPassage),
      undrawn: { by: 'guard', guard: 'accept' },
    };
    expect(checked('{self.greeting}', guarded).rendered.map((site) => site.undrawn)).toEqual([
      { by: 'guard', guard: 'accept' },
    ]);
    expect(
      checked('{self.greeting}', bodyOf(withPassage)).rendered.map((site) => site.undrawn),
    ).toEqual([null]);
  });
});
