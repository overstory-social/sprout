import { describe, expect, it } from 'vitest';

import { HALL } from '../fixtures/tally.js';
import { PollFaultEntry, pollFaultEntry } from './poll-fault.js';

describe('a poll’s fault in the log', () => {
  const fault = {
    name: 'BudgetExhausted',
    detail: 'pollSteps',
    object: HALL,
    engine: false,
    extension: null,
  };

  it('keeps the fault, against the object it names, and the instant of the poll', () => {
    const entry = pollFaultEntry(fault, 12);
    expect(entry).toEqual({ kind: 'poll-fault', now: 12, fault });
    expect(PollFaultEntry.parse(entry)).toEqual(entry);
    expect(Object.keys(entry)).not.toContain('visit');
  });

  it('refuses an instant that is not whole host seconds', () => {
    expect(() => pollFaultEntry(fault, 0.5)).toThrow(/whole seconds/);
  });
});
