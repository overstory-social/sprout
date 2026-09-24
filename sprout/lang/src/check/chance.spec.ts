import { describe, expect, it } from 'vitest';

import { Diagnostics } from '../source/diagnostics.js';
import { locationOf, textOf } from '../source/source.js';
import { readExpression, readProseText } from '../fixtures/parse.js';
import { at } from '../fixtures/check.js';
import {
  drawIn,
  firstDraw,
  refuseDraw,
  refuseDrawingPassage,
  DRAWS,
  type Undrawn,
} from './chance.js';

const EVERY: readonly Undrawn[] = [
  { by: 'guard', guard: 'accept' },
  { by: 'permit' },
  { by: 'describe' },
  { by: 'when' },
  { by: 'pass', written: 'pass any' },
  { by: 'poll', line: 'unseen' },
];

describe('the draws', () => {
  it('are `chance` and `random`, the only free calls', () => {
    expect([...DRAWS]).toEqual(['chance', 'random']);
  });
});

describe('what a passage draws, found in the order it is written', () => {
  const first = (text: string) => {
    const drawn = firstDraw(readProseText(text).prose);
    return drawn === null ? null : [drawn.written, textOf(drawn.at)];
  };

  it('finds a `{one of}` at its opening, and a draw in a slot, a condition or what a loop walks', () => {
    expect(first('a {one of}b{or}c{/one of}')).toEqual(['{one of}', '{one of}']);
    expect(first('{random(6)}')).toEqual(['random', 'random']);
    expect(first('{if self.count > 1}x{else if chance(3)}y{/if}')).toEqual(['chance', 'chance']);
    expect(first('{if a}x{else}{one of}p{or}q{/one of}{/if}')).toEqual(['{one of}', '{one of}']);
    expect(first('{for t in self}{if chance(2)}{t}{/if}{/for}')).toEqual(['chance', 'chance']);
  });

  it('finds the first of several, and nothing where nothing draws', () => {
    expect(first('{random(2)} and {if chance(3)}x{/if}')).toEqual(['random', 'random']);
    expect(first('{self} {if a}b{/if} {for t in self}{t}{/for}')).toBeNull();
  });

  it('does not look into the passage a slot renders, which is said of where it is rendered', () => {
    expect(first('{pot.greeting}')).toBeNull();
  });

  it('finds a draw in an expression however deep, the leftmost first', () => {
    const drawn = (text: string) => {
      const found = drawIn(readExpression(text).expr!);
      return found === null ? null : found.written;
    };
    expect(drawn('self.get(:n) > 1 && (random(3) == 1 || chance(2))')).toBe('random');
    expect(drawn('!chance(2)')).toBe('chance');
    expect(drawn('self.holds(target) && self.count > 1')).toBeNull();
    const long = Array.from({ length: 5000 }, () => '1').join(' + ');
    expect(drawn(`${long} + random(2) > 3`)).toBe('random');
  });
});

describe('a draw where nothing draws is refused, naming why', () => {
  it('names each body that draws nothing, and why, with what to write instead', () => {
    const said = EVERY.map((undrawn) => {
      const diagnostics = new Diagnostics();
      refuseDraw({ written: 'chance', at: at('self') }, undrawn, diagnostics);
      return diagnostics.refusals.map((d) => [d.message, d.remedy]);
    });
    expect(said).toEqual([
      [
        [
          '`accept` may not use `chance`: a guard is asked as part of a decision it must not change.',
          'Roll in a `do`, a handler or a tick, keep what it gave on a property, and read that here.',
        ],
      ],
      [
        [
          'A `permit` may not use `chance`: a `permit` is asked as part of a decision it must not change.',
          'Roll in a `do`, a handler or a tick, keep what it gave on a property, and read that here.',
        ],
      ],
      [
        [
          'A `describe` may not use `chance`: it is run whenever anyone looks, so a roll would change the thing while nobody acts.',
          'Roll in a `do`, a handler or a tick, keep what it gave on a property, and read that here.',
        ],
      ],
      [
        [
          "An exit's `when` may not use `chance`: it is asked to show a visitor the ways out, so a roll would offer a way that vanishes when taken.",
          'Roll in a `do`, a handler or a tick, keep what it gave on a property, and read that here.',
        ],
      ],
      [
        [
          '`pass any` may not use `chance`: a pass rule is asked whenever range is walked, by a poll too, and a poll draws nothing.',
          'Roll in a `do`, a handler or a tick, keep what it gave on a property, and read that here.',
        ],
      ],
      [
        [
          "The world's `unseen` may not use `chance`: a poll says it, and a poll draws nothing.",
          'Write words that are the same every time; to vary them, read what the world holds in an `{if}`.',
        ],
      ],
    ]);
  });

  it('refuses a passage that draws where it is said or rendered, naming the passage and the draw', () => {
    const diagnostics = new Diagnostics();
    const drawn = { written: '{one of}', at: at('tool') };
    refuseDrawingPassage('full', drawn, 'said', at('self'), { by: 'permit' }, diagnostics);
    refuseDrawingPassage('ring', drawn, 'rendered', at('here'), EVERY[0]!, diagnostics);
    expect(diagnostics.refusals.map((d) => [locationOf(d.at), d.message])).toEqual([
      [
        locationOf(at('self')),
        'The passage `full` uses `{one of}`, and it is said from a `permit`, which may not: a `permit` is asked as part of a decision it must not change.',
      ],
      [
        locationOf(at('here')),
        'The passage `ring` uses `{one of}`, and it is rendered from `accept`, which may not: a guard is asked as part of a decision it must not change.',
      ],
    ]);
    expect(diagnostics.refusals[0]!.remedy).toBe(
      'Say words here that do not vary, or keep the variation on a property a `do` or a tick sets, and read that in an `{if}`.',
    );
  });
});
