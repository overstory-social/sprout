import { describe, expect, it } from 'vitest';

import { sha256 } from '@overstory/sprout/lang';

import { atDepth, canonical, digestOf, LoggedDigest } from './depth.js';
import type { LogEntry } from './entry.js';
import type { LoggedEffect } from './parts.js';

const BUDGETS = {
  steps: 1,
  pollSteps: 1,
  output: 1,
  events: 1,
  cascadeDepth: 1,
  passageDepth: 1,
  setRoleObjects: 1,
  spawnsPerTurn: 1,
  shortestWakeSeconds: 1,
  pendingWakesPerObject: 1,
  peoplePerPlace: null,
  extensionEffects: null,
  nicknameCharacters: 1,
  wallClockMs: null,
};

const said = (words: string): LoggedEffect => ({
  kind: 'said',
  level: 'prose',
  from: 'w.hall',
  actor: 'w.marta',
  to: 'w.marta',
  visit: 'visit:marta',
  paragraphs: [words],
});

const tick = (effects: LoggedEffect[]): LogEntry => ({
  kind: 'tick',
  level: 'info',
  seed: 1,
  mayHold: null,
  now: 5,
  budgets: BUDGETS,
  place: 'w.hall',
  fault: null,
  effects,
  cutShort: [],
});

describe('the depth a log keeps a turn at', () => {
  it('keeps every effect whole at debug depth', () => {
    const entry = tick([said('Dust settles.')]);
    expect(atDepth(entry, 'debug')).toBe(entry);
  });

  it('keeps at play depth everything but the effects, and how many there were and their digest in their place', () => {
    const effects = [said('Dust settles.'), said('A draught.')];
    expect(atDepth(tick(effects), 'play')).toEqual({
      ...tick([]),
      digest: { count: 2, sha256: sha256(JSON.stringify(canonical(effects))) },
    });
  });

  it('keeps an entry that holds no effects, or is at play depth already, as it is', () => {
    const publish: LogEntry = { kind: 'publish', level: 'info', now: 0, bundle: 'abc' };
    expect(atDepth(publish, 'play')).toBe(publish);
    const played = atDepth(tick([said('Dust settles.')]), 'play');
    expect(atDepth(played, 'play')).toBe(played);
  });
});

describe('the digest of a turn’s effects', () => {
  it('is the same whatever order an effect’s fields were written in, and a valid digest', () => {
    const one = said('Dust settles.');
    const reordered = Object.fromEntries(Object.entries(one).reverse()) as LoggedEffect;
    expect(digestOf([reordered])).toEqual(digestOf([one]));
    expect(LoggedDigest.parse(digestOf([one]))).toEqual(digestOf([one]));
  });

  it('tells apart effects that differ in a word, or in their order', () => {
    const a = said('Dust settles.');
    const b = said('A draught.');
    expect(digestOf([a]).sha256).not.toBe(digestOf([said('Dust settled.')]).sha256);
    expect(digestOf([a, b]).sha256).not.toBe(digestOf([b, a]).sha256);
    expect(digestOf([]).count).toBe(0);
  });
});
