import { describe, expect, it } from 'vitest';

import {
  actorOf,
  gatehouse,
  gateHost,
  GUARD,
  HARE,
  INES,
  KEYPAD,
  MARTA,
  PEBBLE,
  pollingIn,
  PURSE,
  SENTRY,
  TOWER,
  YARD,
} from '../fixtures/view.js';
import { Draft } from '../runtime/draft.js';
import { visitKey } from '../runtime/ids.js';
import { SproutList } from '../runtime/lists.js';
import { saveWorld } from '../runtime/load.js';
import { STOCK_LINES } from '../runtime/engine-lines.js';
import { viewOf } from '../runtime/view.js';
import { pollReadings, pollScene, pollView, renderView } from './view.js';
import type { Catalogue } from '../runtime/catalogue.js';
import {
  gallery,
  galleryCatalogue,
  galleryHost,
  HALL,
  MARTA as GALLERY_MARTA,
} from '../fixtures/gallery.js';

const OPEN = [[YARD, 'gate_open', true]] as const;

describe('polling a visitor’s view', () => {
  it('renders their place’s description for them, with no draws', () => {
    const polled = pollView(gatehouse(undefined, [], OPEN), gateHost(), MARTA);
    expect(polled.fault).toBeNull();
    expect(polled.visit).toBe(MARTA);
    expect(polled.view.description).toEqual(['A cobbled yard.', 'The gate stands open.']);
  });

  it('carries the exits that apply, who else is there and what they carry, named for them', () => {
    const state = gatehouse(
      [
        [MARTA, 'Marta', YARD],
        [INES, 'Ines', YARD],
      ],
      [PEBBLE],
    );
    const { view } = pollView(state, gateHost(), MARTA);
    expect(view.exits).toEqual([{ direction: 'up', label: 'up the ladder', to: TOWER }]);
    expect(view.occupants).toEqual([
      { id: GUARD, name: 'a guard' },
      { id: SENTRY, name: 'a sentry' },
      { id: actorOf(state, INES), name: 'Ines' },
      { id: HARE, name: 'a hare' },
    ]);
    expect(view.carried).toEqual([{ id: PEBBLE, name: 'a pebble' }]);
  });

  it('offers each reading with its refusal in the refusing participant’s words, and its options as typed', () => {
    const knows = gatehouse().instances.get(SENTRY)!.properties.get('knows');
    if (!(knows instanceof SproutList)) throw new Error('the sentry knows no list');
    const learnt = gatehouse(undefined, [], [[SENTRY, 'knows', knows.add('old_road')]]);
    const { view } = pollView(learnt, gateHost(), MARTA);
    const vouched = view.readings.find((one) => one.typed === 'vouch to guard before sentry for …');
    expect(vouched).toMatchObject({ verb: 'gatehouse.vouch', refused: ['Not before me.'] });
    expect(view.readings.find((one) => one.typed === 'ask sentry about …')).toEqual({
      verb: 'sprout.ask',
      typed: 'ask sentry about …',
      refused: null,
      fillers: [
        { role: 'target', binds: 'object', id: SENTRY, name: 'a sentry' },
        { role: 'topic', binds: 'unbound' },
      ],
      options: [
        {
          role: 'topic',
          takes: 'symbol',
          options: [
            { value: 'bridge', words: 'bridge' },
            { value: 'toll', words: 'toll' },
            { value: 'old_road', words: 'old road' },
          ],
        },
      ],
    });
    expect(view.readings.find((one) => one.typed === 'turn dial to …')?.options).toEqual([
      { role: 'notch', takes: 'integer', ranges: [{ min: 0, max: 9 }] },
    ]);
  });

  it('gives what fills each role in the order the verb declares them', () => {
    const { view } = pollView(gatehouse(), gateHost(), MARTA);
    const filled = (typed: string) => view.readings.find((one) => one.typed === typed)?.fillers;
    // Two objects and a value role: the value role is unbound, its options beside.
    expect(filled('vouch to guard before sentry for …')).toEqual([
      { role: 'target', binds: 'object', id: GUARD, name: 'a guard' },
      { role: 'witness', binds: 'object', id: SENTRY, name: 'a sentry' },
      { role: 'topic', binds: 'unbound' },
    ]);
    // A set role offered one member at a time.
    expect(filled('juggle pebble')).toEqual([
      { role: 'things', binds: 'set', ids: [PEBBLE], names: ['a pebble'] },
    ]);
    // A tool the phrase leaves out is unbound.
    expect(filled('daub pebble')).toEqual([
      { role: 'target', binds: 'object', id: PEBBLE, name: 'a pebble' },
      { role: 'paint', binds: 'unbound' },
    ]);
    // An exit, with its direction; a link has none and is told by its label.
    expect(filled('go up')).toEqual([
      { role: 'way', binds: 'exit', direction: 'up', label: 'up the ladder', to: TOWER },
    ]);
    // Declared order, not the order the phrase types them in: `punch [code] on [pad]` declares the pad first.
    expect(filled('punch … on keypad')).toEqual([
      { role: 'pad', binds: 'object', id: KEYPAD, name: 'a keypad' },
      { role: 'code', binds: 'unbound' },
    ]);
  });

  it('names a filler as its reader reads it, a visitor by nickname', () => {
    const state = gatehouse([
      [MARTA, 'Marta', YARD],
      [INES, 'Ines', YARD],
    ]);
    const { view } = pollView(state, gateHost(), MARTA);
    expect(view.readings.find((one) => one.typed === 'examine Ines')?.fillers).toEqual([
      { role: 'target', binds: 'object', id: actorOf(state, INES), name: 'Ines' },
    ]);
  });

  it('is the world’s `unseen`, keeping the parts it derived before it ran out, laid against the place', () => {
    const polled = pollView(gatehouse(), gateHost(20), MARTA);
    expect(polled.view).toEqual({
      description: ['Too much happens here to take in.'],
      effects: [],
      exits: [{ direction: 'up', label: 'up the ladder', to: TOWER }],
      occupants: [],
      carried: [],
      readings: [],
    });
    expect(polled.fault).toMatchObject({ name: 'BudgetExhausted', object: YARD, engine: false });
    expect(polled.fault?.detail).toContain('pollSteps');
  });

  it('keeps who is there and what is carried too, where the poll got that far before it ran out', () => {
    const polled = pollView(gatehouse(undefined, [PEBBLE]), gateHost(29), MARTA);
    expect(polled.view).toEqual({
      description: ['Too much happens here to take in.'],
      effects: [],
      exits: [{ direction: 'up', label: 'up the ladder', to: TOWER }],
      occupants: [
        { id: GUARD, name: 'a guard' },
        { id: SENTRY, name: 'a sentry' },
        { id: HARE, name: 'a hare' },
      ],
      carried: [{ id: PEBBLE, name: 'a pebble' }],
      readings: [],
    });
    expect(polled.fault).toMatchObject({ name: 'BudgetExhausted', engine: false });
  });

  it('is `unseen` where its description is more than the one looking may read', () => {
    const host = gateHost();
    const polled = pollView(
      gatehouse(),
      { ...host, budgets: { ...host.budgets, output: 10 } },
      MARTA,
    );
    expect(polled.view.readings).toEqual([]);
    expect(polled.fault?.name).toBe('BudgetExhausted');
    expect(polled.fault?.detail).toContain('output');
  });

  it('says `unseen` in the stock words where rendering the world’s own cannot be afforded either', () => {
    const polled = pollView(gatehouse(), gateHost(0), MARTA);
    expect(polled.view.description).toEqual([STOCK_LINES.unseen]);
    expect(polled.fault?.name).toBe('BudgetExhausted');
  });

  it('tells a visitor whose place is gone what their next command will, and offers nothing', () => {
    const base = gatehouse();
    const draft = new Draft(base);
    draft.place(actorOf(base, MARTA), PURSE);
    const polled = pollView(draft.commit().state, gateHost(), MARTA);
    expect(polled.fault).toBeNull();
    expect(polled.view.description).toEqual([STOCK_LINES.displaced]);
    expect(polled.view.readings).toEqual([]);
    expect(polled.view.exits).toEqual([]);
  });

  it('writes nothing, and reads the same state the same way every time', () => {
    const state = gatehouse(undefined, [PEBBLE], OPEN);
    const before = saveWorld(state);
    const first = pollView(state, gateHost(), MARTA);
    expect(pollView(state, gateHost(), MARTA)).toEqual(first);
    expect(saveWorld(state)).toEqual(before);
  });

  it('is the host’s defect for a visitor who is away or never came', () => {
    const state = gatehouse([
      [MARTA, 'Marta', YARD],
      [INES, 'Ines', null],
    ]);
    expect(() => pollView(state, gateHost(), INES)).toThrow(/not in this world/);
    expect(() => pollView(state, gateHost(), visitKey('v-nobody'))).toThrow(/never visited/);
  });
});

describe('rendering a view', () => {
  it('names each occupant and each thing carried as its reader reads it', () => {
    const state = gatehouse(
      [
        [MARTA, 'Marta', YARD],
        [INES, 'Ines', YARD],
      ],
      [PURSE],
    );
    const ines = actorOf(state, INES);
    const context = { ...pollingIn(state), draws: null, actor: ines };
    const seen = renderView(viewOf(ines, context), context);
    expect(seen.occupants.map((one) => one.name)).toEqual([
      'a guard',
      'a sentry',
      'Marta',
      'a hare',
    ]);
    expect(seen.carried).toEqual([]);
  });
});

describe('what a description’s extension statements record into the view', () => {
  const polled = (catalogue: Catalogue) =>
    pollView(gallery(catalogue), galleryHost(catalogue), GALLERY_MARTA);

  it('is beside the description’s words, with its payload and its transcript line', () => {
    const { view, fault } = polled(galleryCatalogue());
    expect(fault).toBeNull();
    expect(view.description).toEqual(['A bright hall.']);
    expect(view.effects).toEqual([
      {
        extension: 'media',
        statement: 'show',
        payload: { src: 'hall.png', caption: 'the hall', self: HALL },
        transcript: '[A picture: the hall]',
      },
    ]);
  });

  it('is nothing where the extension is absent, and the words are the same', () => {
    const { view } = polled(galleryCatalogue([]));
    expect(view.description).toEqual(['A bright hall.']);
    expect(view.effects).toEqual([]);
  });
});

describe('polling a visitor’s scene', () => {
  it('is the view but its readings, with each verb that could be offered and the phrases that type it', () => {
    const state = gatehouse(undefined, [PEBBLE], OPEN);
    const { readings, ...placed } = pollView(state, gateHost(), MARTA).view;
    const polled = pollScene(state, gateHost(), MARTA);
    expect(polled.fault).toBeNull();
    const { verbs, ...scene } = polled.scene;
    expect(scene).toEqual(placed);
    const offering = [...new Set(readings.map((one) => one.verb))];
    expect(verbs.map((one) => one.verb).filter((verb) => offering.includes(verb))).toEqual(
      offering,
    );
    expect(verbs.find((one) => one.verb === 'sprout.take')?.phrases).toContain('take …');
  });

  it('is the world’s `unseen` where it runs out, keeping what it derived, laid against the place', () => {
    const polled = pollScene(gatehouse(), gateHost(20), MARTA);
    expect(polled.scene).toEqual({
      description: ['Too much happens here to take in.'],
      effects: [],
      exits: [{ direction: 'up', label: 'up the ladder', to: TOWER }],
      occupants: [],
      carried: [],
      verbs: [],
    });
    expect(polled.fault).toMatchObject({ name: 'BudgetExhausted', object: YARD, engine: false });
  });

  it('lists no verb to a visitor whose place is gone', () => {
    const base = gatehouse();
    const draft = new Draft(base);
    draft.place(actorOf(base, MARTA), PURSE);
    const polled = pollScene(draft.commit().state, gateHost(), MARTA);
    expect(polled.scene.description).toEqual([STOCK_LINES.displaced]);
    expect(polled.scene.verbs).toEqual([]);
  });
});

describe('polling one verb’s readings', () => {
  it('gives the view’s readings of that verb, rendered as the view renders them', () => {
    const state = gatehouse(undefined, [PEBBLE], OPEN);
    const { readings } = pollView(state, gateHost(), MARTA).view;
    const { verbs } = pollScene(state, gateHost(), MARTA).scene;
    const apart = verbs.flatMap(
      ({ verb }) => pollReadings(state, gateHost(), MARTA, verb).readings,
    );
    expect(apart).toEqual(readings);
  });

  it('gives none where the poll runs out, its fault laid against the place', () => {
    const polled = pollReadings(gatehouse(), gateHost(3), MARTA, 'sprout.take');
    expect(polled).toMatchObject({ verb: 'sprout.take', readings: [] });
    expect(polled.fault).toMatchObject({ name: 'BudgetExhausted', object: YARD, engine: false });
  });

  it('runs under a budget of its own, so a scene too large to offer whole still offers each verb', () => {
    const state = gatehouse(undefined, [PEBBLE], OPEN);
    const whole = pollView(state, gateHost(), MARTA).view.readings.length;
    let steps = 1;
    while (pollView(state, gateHost(steps), MARTA).view.readings.length < whole) steps += 1;
    const tight = gateHost(steps - 1);
    expect(pollView(state, tight, MARTA).fault).not.toBeNull();
    const { verbs } = pollScene(state, tight, MARTA).scene;
    const apart = verbs.map(({ verb }) => pollReadings(state, tight, MARTA, verb));
    expect(apart.every((one) => one.fault === null)).toBe(true);
    expect(apart.flatMap((one) => one.readings)).toHaveLength(whole);
  });

  it('offers nothing to a visitor whose place is gone, and is the host’s defect for a verb the world lacks', () => {
    const base = gatehouse();
    const draft = new Draft(base);
    draft.place(actorOf(base, MARTA), PURSE);
    const displaced = draft.commit().state;
    expect(pollReadings(displaced, gateHost(), MARTA, 'sprout.take')).toMatchObject({
      readings: [],
      fault: null,
    });
    expect(() => pollReadings(base, gateHost(), MARTA, 'sprout.juggle')).toThrow(
      /types no verb `sprout.juggle`/,
    );
  });
});
