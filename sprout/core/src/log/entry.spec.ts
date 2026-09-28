import { describe, expect, it } from 'vitest';

import { memoryStore } from '../memory-store.js';
import { LogEntry, Logged, readLog, wholeLog } from './entry.js';

const publish = (now: number) => ({ kind: 'publish', level: 'info', now, bundle: 'a1' }) as const;

describe('the log’s entries', () => {
  it('reads each kind by its `kind`, and refuses a kind it does not hold', () => {
    expect(LogEntry.parse(publish(1))).toEqual(publish(1));
    expect(LogEntry.safeParse({ ...publish(1), kind: 'poll' }).success).toBe(false);
    expect(Logged.safeParse({ seq: 0, entry: publish(1) }).success).toBe(false);
  });

  it('carries the level its kind fixes, and no other', () => {
    // A poll's fault is an error; every other entry is info, whatever
    // the effects, faults and readers cut short inside it are at.
    expect(LogEntry.safeParse({ ...publish(1), level: 'error' }).success).toBe(false);
    expect(LogEntry.safeParse({ ...publish(1), level: undefined }).success).toBe(false);
    const fault = {
      level: 'error',
      name: 'BudgetExhausted',
      detail: 'd',
      object: null,
      engine: false,
      extension: null,
    };
    const pollFault = { kind: 'poll-fault', level: 'error', now: 1, fault };
    expect(LogEntry.safeParse(pollFault).success).toBe(true);
    expect(LogEntry.safeParse({ ...pollFault, level: 'info' }).success).toBe(false);
    expect(
      LogEntry.safeParse({ ...pollFault, fault: { ...fault, level: 'warning' } }).success,
    ).toBe(false);
  });

  it('reads a page after a number, oldest first, and the whole log a page at a time', async () => {
    const store = memoryStore();
    await store.transaction('w', async (tx) => {
      for (let now = 1; now <= 5; now++) await tx.appendLog(publish(now));
    });
    expect(await readLog(store, 'w', { after: 3, limit: 1 })).toEqual([
      { seq: 4, entry: publish(4) },
    ]);
    const whole = await wholeLog(store, 'w', 2);
    expect(whole.map((one) => one.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(await wholeLog(store, 'empty', 2)).toEqual([]);
    await expect(wholeLog(store, 'w', 0)).rejects.toThrow(/at least 1/);
  });
});
