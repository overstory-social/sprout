import { describe, expect, it } from 'vitest';

import { compiledWorld } from '../../fixtures/bundle.js';
import { commandContext, type Study } from '../../fixtures/parser.js';
import { setOn, turn } from '../../fixtures/reading.js';
import { declaredId, type InstanceId } from '../ids.js';
import { readCommand } from '../parser.js';
import { addressOf } from './address.js';
import { fillSlot } from './fill.js';
import { slotSpans } from './match.js';
import { offeredOutOfReach } from './offered.js';
import { reachOf } from './reach.js';

/** A single quote, as an import's specifier is written between them. */
const Q = "'";

/**
 * A clearing, and behind the house a window whose own synonym makes
 * `enter` a word for `go_through`, and a shut box holding a hatch whose
 * synonym makes `climb` one.
 */
const HOUSE = compiledWorld('house', {
  'house.sprout': [
    `import * as sprout from ${Q}sprout${Q}`,
    '',
    'world house is sprout.World {',
    '  visitors are Person',
    '  visitors arrive at clearing',
    '',
    '  object clearing is sprout.Place {',
    '    grammar { article the }',
    '    object box is sprout.Container {',
    '      :open false',
    '      grammar { article the }',
    '      object hatch is Pane {',
    '        grammar { article the }',
    '        synonyms go_through: "climb"',
    '      }',
    '    }',
    '  }',
    '  object behind_house is sprout.Place {',
    '    grammar { article the }',
    '    object window is Pane {',
    '      grammar { article the  nouns "pane" }',
    '      synonyms go_through: "enter"',
    '    }',
    '    object door is Pane { grammar { article the } }',
    '  }',
    '}',
    '',
    'verb go_through { role target: Pane  "go through [target]" }',
    '',
    'kind Person is sprout.Visitor { }',
    'kind Pane { as target for go_through { do { say "You climb through." } } }',
    '',
  ].join('\n'),
});

const CLEARING = declaredId('house', ['clearing']);
const BOX = declaredId('house', ['clearing', 'box']);
const HATCH = declaredId('house', ['clearing', 'box', 'hatch']);
const BEHIND = declaredId('house', ['behind_house']);
const WINDOW = declaredId('house', ['behind_house', 'window']);

function house(where: InstanceId = CLEARING): Study {
  const one = turn(HOUSE, [where]);
  return { ...one, nicknames: new Map([[one.people[0]!, 'Marta']]) };
}

/**
 * Whether `line`, typed by Marta in `one`, is one `offered`'s phrase would
 * read with `offered` in reach, and the steps asking it spent.
 */
function asking(
  one: Study,
  line: string,
  offered: InstanceId,
): { readonly named: boolean; readonly steps: number } {
  const context = commandContext(one, []);
  const words = line.split(' ');
  const phrase = context.catalogue.phrases.find((typed) => typed.only === offered)!;
  const fill = {
    candidates: reachOf(one.people[0]!, context),
    exits: [],
    budget: context.budget,
    referents: [],
  };
  const address = (id: InstanceId) =>
    addressOf(one.draft.instance(id)!, { world: one.draft.world, nicknames: one.nicknames });
  const [spans] = [...slotSpans(phrase.parts, words)];
  if (spans === undefined) return { named: false, steps: 0 };
  const fills = spans.map((span) =>
    fillSlot(phrase.verb.roles[span.role]!, words.slice(span.start, span.end), fill),
  );
  const before = context.budget.spentSteps;
  const named = offeredOutOfReach(phrase, spans, fills, words, { state: one.draft, address, fill });
  return { named, steps: context.budget.spentSteps - before };
}

const asked = (one: Study, line: string, offered: InstanceId) => asking(one, line, offered).named;

const answerTo = (one: Study, line: string) => {
  const outcome = readCommand(line, one.people[0]!, commandContext(one, []));
  return 'answer' in outcome ? outcome.answer : 'understood';
};

describe('an object’s synonym typed where the object is out of reach', () => {
  it('would read the line where its noun names the object, by any of its nouns', () => {
    expect(asked(house(), 'enter window', WINDOW)).toBe(true);
    expect(asked(house(), 'enter the pane', WINDOW)).toBe(true);
    expect(asked(house(), 'climb hatch', HATCH)).toBe(true);
  });

  it('would not where the noun names something else, or nothing at all', () => {
    expect(asked(house(), 'enter door', WINDOW)).toBe(false);
    expect(asked(house(), 'enter zebra', WINDOW)).toBe(false);
  });

  it('would not where the object is no longer in the world', () => {
    const one = house();
    one.draft.remove(WINDOW);
    expect(asked(one, 'enter window', WINDOW)).toBe(false);
  });

  it('spends a step on the noun it tries, and none where it names something in reach', () => {
    expect(asking(house(), 'enter window', WINDOW).steps).toBeGreaterThan(0);
    expect(asking(house(BEHIND), 'enter window', WINDOW)).toEqual({ named: false, steps: 0 });
  });
});

describe('the answer to it', () => {
  it('is `not_here` where the object is out of reach, and the reading where it is in reach', () => {
    expect(answerTo(house(), 'enter window')).toBe('not_here');
    expect(answerTo(house(BEHIND), 'enter window')).toBe('understood');
  });

  it('is `not_here` for an object behind a lid, which says nothing of the lid', () => {
    expect(answerTo(house(), 'climb hatch')).toBe('not_here');
    const open = house();
    setOn(open, BOX, { open: true });
    expect(answerTo(open, 'climb hatch')).toBe('understood');
  });

  it('is still `unknown` where the noun is not the object’s, in reach or not', () => {
    expect(answerTo(house(), 'enter door')).toBe('unknown');
    expect(answerTo(house(BEHIND), 'enter door')).toBe('unknown');
    expect(answerTo(house(), 'enter zebra')).toBe('unknown');
  });

  it('is `unknown` where the object has left the world', () => {
    const one = house();
    one.draft.remove(WINDOW);
    expect(answerTo(one, 'enter window')).toBe('unknown');
  });
});
