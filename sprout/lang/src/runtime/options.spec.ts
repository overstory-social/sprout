import { describe, expect, it } from 'vitest';

import {
  actorOf,
  DIAL,
  gatehouse,
  GATE_CATALOGUE,
  GATEHOUSE,
  GUARD,
  KEYPAD,
  MARTA,
  pollingIn,
  SENTRY,
} from '../fixtures/view.js';
import { SproutList } from './lists.js';
import { valueOptions } from './options.js';
import type { Bound, Reading } from './reading.js';
import type { WorldState } from './state.js';

const verb = (library: string, name: string) => {
  const found = GATEHOUSE.verbs.qualified(library, name);
  if (found === null) throw new Error(`no verb \`${library}.${name}\``);
  return found;
};

const reading = (
  state: WorldState,
  library: string,
  name: string,
  bindings: Record<string, Bound>,
): Reading => ({
  verb: verb(library, name),
  actor: actorOf(state, MARTA),
  bindings: new Map(Object.entries(bindings)),
});

const topics = (state: WorldState, ...known: string[]) => {
  const guard = state.instances.get(SENTRY)!;
  const list = guard.properties.get('knows');
  if (!(list instanceof SproutList)) throw new Error('the sentry knows no list');
  return SproutList.of(list.holds, known, GATE_CATALOGUE.caps);
};

describe('the options a value role offers', () => {
  it('are the options its target’s list property holds now, in order', () => {
    const state = gatehouse();
    const asked = reading(state, 'sprout', 'ask', { target: { object: GUARD } });
    expect(valueOptions(asked, pollingIn(state))).toEqual([
      { role: 'topic', takes: 'symbol', options: ['bridge', 'toll'] },
    ]);
  });

  it('follow what the list holds when the poll runs, not its declared default', () => {
    const base = gatehouse();
    const state = gatehouse(undefined, [], [[SENTRY, 'knows', topics(base, 'old_road')]]);
    const asked = reading(state, 'sprout', 'ask', { target: { object: SENTRY } });
    expect(valueOptions(asked, pollingIn(state))).toEqual([
      { role: 'topic', takes: 'symbol', options: ['old_road'] },
    ]);
  });

  it('gather every participant’s, first heard first, each option once', () => {
    const base = gatehouse();
    const state = gatehouse(undefined, [], [[SENTRY, 'knows', topics(base, 'toll', 'weather')]]);
    const vouched = reading(state, 'gatehouse', 'vouch', {
      target: { object: GUARD },
      witness: { object: SENTRY },
    });
    expect(valueOptions(vouched, pollingIn(state))).toEqual([
      { role: 'topic', takes: 'symbol', options: ['bridge', 'toll', 'weather'] },
    ]);
  });

  it('are a range for an integer role: the one written out, or the property’s', () => {
    const state = gatehouse();
    const punched = reading(state, 'gatehouse', 'punch', { pad: { object: KEYPAD } });
    expect(valueOptions(punched, pollingIn(state))).toEqual([
      { role: 'code', takes: 'integer', ranges: [{ min: 1, max: 12 }] },
    ]);
    const turned = reading(state, 'gatehouse', 'turn', { knob: { object: DIAL } });
    expect(valueOptions(turned, pollingIn(state))).toEqual([
      { role: 'notch', takes: 'integer', ranges: [{ min: 0, max: 9 }] },
    ]);
  });

  it('are none where nobody in the reading narrows the role, and absent for a verb with no value role', () => {
    const state = gatehouse();
    // The keypad plays no part in `ask`, so nobody hears a topic.
    const asked = reading(state, 'sprout', 'ask', { target: { object: KEYPAD } });
    expect(valueOptions(asked, pollingIn(state))).toEqual([
      { role: 'topic', takes: 'symbol', options: [] },
    ]);
    const taken = reading(state, 'sprout', 'take', { target: { object: KEYPAD } });
    expect(valueOptions(taken, pollingIn(state))).toEqual([]);
  });

  it('charge a step for each `from` asked', () => {
    const state = gatehouse();
    const context = pollingIn(state);
    const vouched = reading(state, 'gatehouse', 'vouch', {
      target: { object: GUARD },
      witness: { object: SENTRY },
    });
    valueOptions(vouched, context);
    expect(context.budget.spentSteps).toBe(2);
  });
});
