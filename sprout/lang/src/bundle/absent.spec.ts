import { describe, expect, it } from 'vitest';

import { ABSENT_TABLE, absenceRule, type ReferenceKind } from './absent.js';

describe('the absent table is the spec’s, whole', () => {
  const references: ReferenceKind[] = [
    'kind-in-composition',
    'kind-in-role',
    'verb',
    'message',
    'passage',
    'place-in-exit',
    'place-underfoot',
    'place-of-arrival',
    'world',
    'visitor-kind',
    'extension',
  ];

  it('has a row for every reference the spec names, in its order', () => {
    expect(ABSENT_TABLE.map((row) => row.reference)).toEqual(references);
  });

  it('says what happens for each one', () => {
    for (const row of ABSENT_TABLE) expect(row.consequence.length).toBeGreaterThan(16);
  });

  it('names each reference once', () => {
    expect(new Set(ABSENT_TABLE.map((r) => r.reference)).size).toBe(ABSENT_TABLE.length);
  });

  it('finds a row by its reference', () => {
    expect(absenceRule('verb').consequence).toContain('do not parse');
    expect(absenceRule('message').consequence).toContain('go nowhere');
  });

  it('throws for a reference that is not one, because the table is complete', () => {
    expect(() => absenceRule('room' as ReferenceKind)).toThrow(/No absence rule/);
  });
});

describe('somebody is told through the passage the spec names, where it names one', () => {
  it('tells a displaced visitor through `displaced`', () => {
    expect(absenceRule('place-underfoot').told).toBe('displaced');
  });

  it('tells a visitor once, on entry, about an extension the host cannot supply', () => {
    expect(absenceRule('extension').told).toBe('missing');
  });

  it('names no passage for a world that cannot admit anyone, because the host says so outside it', () => {
    // Entry fails as a host matter, the way a crash does: nobody was
    // admitted, so no passage of the world's has anyone to tell, and
    // `displaced` in particular is not true of somebody who never stood
    // anywhere.
    const rule = absenceRule('place-of-arrival');
    expect(rule.told).toBeNull();
    expect(rule.consequence).toContain('entry fails as a host matter');
    expect(rule.consequence).toContain('the host says so outside the world');
  });

  it('names no passage for a bundle with no `world` declaration, the same as no arrival place', () => {
    const rule = absenceRule('world');
    expect(rule.told).toBeNull();
    expect(rule.consequence).toContain('does not admit anyone');
  });

  it('names no passage for an absent visitor kind, the same as no `world` declaration', () => {
    const rule = absenceRule('visitor-kind');
    expect(rule.told).toBeNull();
    expect(rule.consequence).toBe(absenceRule('world').consequence);
  });

  it('names no passage for the rest, because there is nobody there to tell', () => {
    for (const reference of [
      'kind-in-composition',
      'kind-in-role',
      'verb',
      'message',
      'passage',
      'place-in-exit',
    ] as const) {
      expect(absenceRule(reference).told, reference).toBeNull();
    }
  });

  it("names only passages the spec's own standard library declares", () => {
    const declared = new Set(['displaced', 'missing', 'fault', 'unseen', 'nothing_happens']);
    for (const row of ABSENT_TABLE) {
      if (row.told !== null) expect(declared.has(row.told), row.told).toBe(true);
    }
  });
});

describe('an object whose kind is not there', () => {
  it('is absent, and what it holds waits for the kind', () => {
    const rule = absenceRule('kind-in-composition').consequence;
    expect(rule).toContain('the object is absent');
    expect(rule).toContain('what it holds is unreachable until the kind returns');
  });
});

describe('the one row where absence is not simply tolerated', () => {
  it('says a description left empty by an absent passage is refused at publish', () => {
    expect(absenceRule('passage').consequence).toContain('refused at publish');
  });
});
