import { saveBreaks } from '@overstory/sprout/lang';

import { runCommand } from '../turns.js';
import { runView } from '../views.js';
import { equal, ok } from './check.js';
import {
  LAMPLIGHT,
  LAMPLIGHT_LATER,
  LAMPLIT_ATTIC,
  LAMPLIT_HALL,
  LAMPLIT_LAMP,
  MARTA,
  played,
  propertyOf,
  seeded,
  storedIn,
  type EngineCase,
} from './worlds.js';

// The suite's saves across versions (the spec's The runtime › State ›
// Across versions): what a world stored under one build is handed to an
// engine made for a later build the check finds keeps it, and is played on
// as that build reads it.

/** Marta's `text`, typed at `now` with seed 1. */
const command = (text: string, now = 0) => ({ visit: MARTA, text, seed: 1, mayHold: null, now });

export const versionCases: EngineCase[] = [
  {
    name: 'a save is played on by a later build that keeps it',
    proves:
      'a store written under one build is read by an engine made for a later compatible build: what it held stays, a property the later build adds reads its default, and a place it adds is there to go to',
    async run(make) {
      equal(
        saveBreaks(LAMPLIGHT.host.catalogue, LAMPLIGHT_LATER.host.catalogue),
        [],
        'what the check finds would break a save',
      );
      const store = await seeded(LAMPLIGHT, [[MARTA, LAMPLIT_HALL, 'Marta']]);
      ok(
        (await runCommand(store, 'w', played(make, LAMPLIGHT), command('light lamp'))).committed,
        'lighting the lamp under 0.1.0 commits',
      );

      const later = played(make, LAMPLIGHT_LATER);
      const polled = await runView(store, 'w', later, MARTA, 0);
      equal(polled.view.description, ['The hall is bright.'], 'the hall under 0.1.1');
      equal(
        await propertyOf(store, LAMPLIT_LAMP, 'polished', false),
        false,
        'the polish it never had',
      );
      ok(
        (await runCommand(store, 'w', later, command('polish lamp', 1))).committed,
        'polishing it under 0.1.1 commits',
      );
      equal(
        await propertyOf(store, LAMPLIT_LAMP, 'polished', false),
        true,
        'the polish it has now',
      );
      equal(await propertyOf(store, LAMPLIT_LAMP, 'lit', false), true, 'the light it kept');
      ok(
        (await runCommand(store, 'w', later, command('go up', 2))).committed,
        'going up to the attic commits',
      );
      const stored = await storedIn(store);
      const marta = stored.visitors.find((one) => one.visit === MARTA)!;
      equal(
        stored.instances.find((one) => one.id === marta.instance)?.container,
        LAMPLIT_ATTIC,
        'where Marta stands',
      );
    },
  },
];
