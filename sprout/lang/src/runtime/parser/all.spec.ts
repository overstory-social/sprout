import { describe, expect, it } from 'vitest';

import { typedWords } from '../../declare/addressing.js';
import { compiledWorld } from '../../fixtures/bundle.js';
import {
  BRASS_KEY,
  CHEST,
  DIAL,
  DOOR,
  GONG,
  GUARD,
  HALL,
  IRON_KEY,
  LAMP,
  LAMP_OIL,
  PEBBLE_A,
  PEBBLE_B,
  study,
  STUDY,
} from '../../fixtures/parser.js';
import { contextOf, reading, turn } from '../../fixtures/reading.js';
import { Budget } from '../budget.js';
import { DEFAULT_LIMITS } from '../../bundle/limits.js';
import { declaredId, type InstanceId } from '../ids.js';
import { addressOf } from './address.js';
import { allIn, allowedOf, onlyTheActorPlays } from './all.js';
import type { Filled } from './fill.js';

const one = study();
const actor = one.people[0]!;
const addressing = { world: one.draft.world, nicknames: one.nicknames };
const REACHED = [
  actor,
  BRASS_KEY,
  IRON_KEY,
  LAMP,
  LAMP_OIL,
  GONG,
  PEBBLE_A,
  PEBBLE_B,
  CHEST,
  GUARD,
  DIAL,
  DOOR,
];
const candidates = REACHED.map((id: InstanceId, near) => {
  const instance = one.draft.instance(id)!;
  return { instance, address: addressOf(instance, addressing), near, carried: false };
});
const context = (setRoleObjects = DEFAULT_LIMITS.budgets.setRoleObjects) => ({
  candidates,
  budget: new Budget({ ...DEFAULT_LIMITS.budgets, setRoleObjects }),
  referents: [],
  actor,
  here: HALL,
  kinds: one.catalogue.kinds.values(),
});
const verb = (name: string, library = 'study') => STUDY.verbs.qualified(library, name)!;
const all = (line: string, verbName: string, role: string, library = 'study', cap?: number) => {
  const of = verb(verbName, library);
  return allIn(
    typedWords(line),
    of.roles.find((one) => one.name === role)!,
    of,
    context(cap),
  );
};
const ids = (filled: Filled | null) =>
  filled?.fills === 'all'
    ? filled.things.map(({ bound }) => ('object' in bound ? bound.object : null))
    : filled?.fills === 'options'
      ? filled.options.map(({ bound }) => ('set' in bound ? bound.set : null))
      : filled;

describe('`all` in a slot', () => {
  it('is no `all` where the words do not begin with it, or the role takes a value', () => {
    expect(all('key', 'take', 'target', 'sprout')).toBeNull();
    expect(all('all', 'turn', 'number')).toBeNull();
  });

  it('takes, for a role only the actor plays, every thing in reach but people, in the order reached', () => {
    expect(ids(all('all', 'take', 'target', 'sprout', 20))).toEqual([
      BRASS_KEY,
      IRON_KEY,
      LAMP,
      LAMP_OIL,
      GONG,
      PEBBLE_A,
      PEBBLE_B,
      CHEST,
      GUARD,
      DIAL,
      DOOR,
    ]);
  });

  it('takes, for a role of a kind, what composes the kind, and for a set role all at once', () => {
    expect(ids(all('all', 'unlock', 'tool'))).toEqual([BRASS_KEY, IRON_KEY]);
    expect(ids(all('all', 'juggle', 'things'))).toEqual([
      [BRASS_KEY, IRON_KEY, LAMP, LAMP_OIL, GONG, PEBBLE_A, PEBBLE_B, CHEST],
    ]);
  });

  it('takes, for an open role a kind plays, what plays a part in the verb', () => {
    expect(ids(all('all', 'ask', 'target', 'sprout'))).toEqual([GUARD]);
  });

  it('leaves out what `except` names, by name, noun or kind, and is `nothing` where it names nothing', () => {
    expect(ids(all('all except the brass key and pebble', 'unlock', 'tool'))).toEqual([IRON_KEY]);
    expect(ids(all('all except metal', 'unlock', 'tool'))).toEqual({
      fills: 'nothing',
      start: 0,
      end: 3,
    });
    expect(all('all except zebra', 'unlock', 'tool')).toEqual({
      fills: 'nothing',
      start: 2,
      end: 3,
    });
    expect(all('all except', 'unlock', 'tool')).toEqual({ fills: 'unfit', things: [] });
    expect(all('all the keys', 'unlock', 'tool')).toEqual({ fills: 'unfit', things: [] });
  });

  it('leaves out, of what `except` names, only what it is the whole name of where it is one', () => {
    // The lamp oil answers to `lamp` as well, and is still taken.
    const taken = ids(all('all except lamp', 'take', 'target', 'sprout', 20));
    expect(taken).toContain(LAMP_OIL);
    expect(taken).not.toContain(LAMP);
  });

  it('takes, for a carried role, only what the actor carries', () => {
    const of = verb('unlock');
    const tool = { ...of.roles.find((one) => one.name === 'tool')!, carried: true };
    const carrying = candidates.map((one) => ({
      ...one,
      carried: one.instance.id === IRON_KEY || one.instance.id === GONG,
    }));
    expect(ids(allIn(typedWords('all'), tool, of, { ...context(), candidates: carrying }))).toEqual(
      [IRON_KEY],
    );
    const nothing = allIn(typedWords('all'), tool, of, context());
    expect(nothing).toEqual({ fills: 'nothing', start: 0, end: 1 });
  });

  it('takes, for a set role, no more than it may bind', () => {
    expect(ids(all('all', 'juggle', 'things', 'study', 3))).toEqual([[BRASS_KEY, IRON_KEY, LAMP]]);
  });

  it('takes, for a role that takes one thing, everything, left to `allowedOf` to cap', () => {
    expect(ids(all('all', 'take', 'target', 'sprout', 3))).toHaveLength(11);
  });
});

/** A single quote, as an import's specifier is written between them. */
const Q = "'";

// A hall where one kind plays `examine`'s target and a world verb's, one
// refuses `examine`, and one plays nothing.
const GALLERY = compiledWorld('gallery', {
  'gallery.sprout': [
    `import {examine} from ${Q}sprout${Q}`,
    'world gallery is sprout.World { visitors are Person visitors arrive at hall',
    '  object hall is sprout.Place {',
    '    object apple is Plain',
    '    object bell is Shiny',
    '    object lamp is Glare',
    '    object pear is Plain',
    '  }',
    '}',
    'verb polish { role target  "polish [target]" }',
    'kind Plain { }',
    'kind Shiny {',
    '  as target for examine { permit { allow } }',
    '  as target for polish { do { say "It gleams." } }',
    '}',
    'kind Glare { as target for examine { permit { refuse "Too bright." } } }',
  ].join('\n'),
  'person.sprout': 'kind Person is sprout.Visitor { }\n',
});
const GALLERY_HALL = declaredId('gallery', ['hall']);
const [APPLE, BELL, GLARE_LAMP, PEAR] = ['apple', 'bell', 'lamp', 'pear'].map((name) =>
  declaredId('gallery', ['hall', name]),
) as [InstanceId, InstanceId, InstanceId, InstanceId];

/** What `all` fills `role` of `verb` with in the gallery, each thing carried where `carried` says. */
function inGallery(
  library: string,
  verbName: string,
  carried: (id: InstanceId) => boolean = () => false,
  carriedRole = false,
) {
  const gallery = turn(GALLERY, [GALLERY_HALL]);
  const visitor = gallery.people[0]!;
  const reached = [visitor, APPLE, BELL, GLARE_LAMP, PEAR].map((id, near) => {
    const instance = gallery.draft.instance(id)!;
    const address = addressOf(instance, { world: gallery.draft.world, nicknames: new Map() });
    return { instance, address, near, carried: carried(id) };
  });
  const of = GALLERY.verbs.qualified(library, verbName)!;
  const role = { ...of.roles.find((one) => one.name === 'target')!, carried: carriedRole };
  return allIn(typedWords('all'), role, of, {
    candidates: reached,
    budget: new Budget(DEFAULT_LIMITS.budgets),
    referents: [],
    actor: visitor,
    here: GALLERY_HALL,
    kinds: gallery.catalogue.kinds.values(),
  });
}

describe('`all` in an engine verb’s open role', () => {
  it('takes every thing but people and the actor’s place, though some kind plays the role', () => {
    expect(ids(inGallery('sprout', 'examine'))).toEqual([APPLE, BELL, GLARE_LAMP, PEAR]);
  });

  it('is unlike a world verb’s open role some kind plays, which takes only what plays it', () => {
    expect(ids(inGallery('gallery', 'polish'))).toEqual([BELL]);
  });

  it('takes, where the role is carried, only what the actor carries', () => {
    const carried = (id: InstanceId) => id === PEAR || id === BELL;
    expect(ids(inGallery('sprout', 'examine', carried, true))).toEqual([BELL, PEAR]);
  });
});

describe('what of `all` is left to run', () => {
  const gallery = turn(GALLERY, [GALLERY_HALL]);
  const visitor = gallery.people[0]!;
  const examining = (id: InstanceId) =>
    reading(GALLERY, 'examine', visitor, { target: { object: id } }, 'sprout');

  it('is each reading whose consent pass allows, in order, leaving out one refused', () => {
    const left = allowedOf([APPLE, BELL, GLARE_LAMP, PEAR].map(examining), {
      ...contextOf(gallery),
      state: gallery.draft,
    });
    expect(left.map((one) => one.bindings.get('target'))).toEqual([
      { object: APPLE },
      { object: BELL },
      { object: PEAR },
    ]);
  });

  it('is capped at what a set role may bind after the refused are left out, asking no pass past it', () => {
    const capped = turn(
      GALLERY,
      [GALLERY_HALL],
      new Budget({ ...DEFAULT_LIMITS.budgets, setRoleObjects: 2 }),
    );
    const who = capped.people[0]!;
    const of = (id: InstanceId) =>
      reading(GALLERY, 'examine', who, { target: { object: id } }, 'sprout');
    const left = allowedOf([GLARE_LAMP, APPLE, BELL, PEAR].map(of), {
      ...contextOf(capped),
      state: capped.draft,
    });
    expect(left.map((one) => one.bindings.get('target'))).toEqual([
      { object: APPLE },
      { object: BELL },
    ]);
  });

  it('is nothing where every reading is refused, and each pass is charged to the turn', () => {
    const before = gallery.budget.spentSteps;
    expect(
      allowedOf([examining(GLARE_LAMP)], { ...contextOf(gallery), state: gallery.draft }),
    ).toEqual([]);
    expect(gallery.budget.spentSteps).toBeGreaterThan(before);
  });
});

describe('what `all` costs', () => {
  it('is a step for each kind asked whether it plays the role, and each thing `except` is weighed against', () => {
    const plain = context();
    const of = verb('take', 'sprout');
    allIn(typedWords('all'), of.roles[0]!, of, plain);
    const excepting = context();
    allIn(typedWords('all except gong'), of.roles[0]!, of, excepting);
    expect(plain.budget.spentSteps).toBeGreaterThan(candidates.length);
    expect(excepting.budget.spentSteps).toBeGreaterThan(
      plain.budget.spentSteps + candidates.length,
    );
  });
});

describe('a role only the actor plays', () => {
  it('is one no kind there is plays, each kind asked a step', () => {
    const budget = new Budget(DEFAULT_LIMITS.budgets);
    const take = verb('take', 'sprout');
    expect(onlyTheActorPlays(take, take.roles[0]!, one.catalogue.kinds.values(), budget)).toBe(
      true,
    );
    expect(budget.spentSteps).toBe(one.catalogue.kinds.size);
    const turn = verb('turn');
    expect(
      onlyTheActorPlays(
        turn,
        turn.roles[0]!,
        one.catalogue.kinds.values(),
        new Budget(DEFAULT_LIMITS.budgets),
      ),
    ).toBe(false);
  });
});
