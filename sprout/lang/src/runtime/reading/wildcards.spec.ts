// A wildcard play as a reading runs it: `as tool for any` for whatever a
// thing fills after the first role, `as target for any` for the first,
// each before the participant's plays for the verb, and the order across
// participants unchanged, so the target still refuses before its tool.

import { describe, expect, it } from 'vitest';

import { BENCH, BRASS_KEY, GAUGE, SHELF, bench } from '../../fixtures/bench.js';
import { acted, contextOf, lines, reading, refused, setOn, words } from '../../fixtures/reading.js';
import type { InstanceId } from '../ids.js';
import { runReading } from '../reading.js';

/** `prop <target> with <tool>`, by Marta, who holds the gauge. */
function prop(flags: { stuck?: boolean; bent?: boolean; wobbly?: boolean }, target = SHELF) {
  const one = bench([[GAUGE, null]]);
  setOn(one, GAUGE, { stuck: flags.stuck ?? false, bent: flags.bent ?? false });
  setOn(one, SHELF, { wobbly: flags.wobbly ?? false });
  const read = reading(BENCH, 'prop', one.people[0]!, {
    target: { object: target },
    tool: { object: GAUGE },
  });
  return runReading(read, contextOf(one));
}

describe('a wildcard, as a reading runs it', () => {
  it('runs a participant’s wildcard permit before its permit for the verb', () => {
    expect(words(refused(prop({ stuck: true, bent: true })).said)).toBe('The gauge is stuck.');
    expect(words(refused(prop({ bent: true })).said)).toBe('The gauge is bent.');
    expect(lines(acted(prop({})))).toEqual([[SHELF, 'The shelf stays put.']]);
  });

  it('keeps the order across participants: the target refuses before its tool', () => {
    const refusal = refused(prop({ stuck: true, wobbly: true }));
    expect(words(refusal.said)).toBe('The shelf wobbles.');
    expect(refusal).toMatchObject({ by: SHELF, role: 'target', origin: 'bench.Shelf' });
  });

  it('runs `as target for any` for the first role whatever the verb calls it, and never for a tool', () => {
    const one = bench([[GAUGE, null]]);
    const marta = one.people[0]!;
    setOn(one, SHELF, { wobbly: true });
    setOn(one, GAUGE, { stuck: true });
    const take = (thing: InstanceId) =>
      runReading(
        reading(BENCH, 'take', marta, { target: { object: thing } }, 'sprout'),
        contextOf(one),
      );
    expect(words(refused(take(SHELF)).said)).toBe('The shelf wobbles.');
    // The gauge guards only where it is a tool, so dropping it is untouched.
    const drop = reading(BENCH, 'drop', marta, { target: { object: GAUGE } }, 'sprout');
    expect('refused' in runReading(drop, contextOf(one))).toBe(false);
    // Nor does a key that must be held refuse being taken up.
    expect('refused' in take(BRASS_KEY)).toBe(false);
  });
});
