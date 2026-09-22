import { describe, expect, it } from 'vitest';

import {
  capsExceeding,
  capsWithin,
  DEFAULT_LIMITS,
  LIMIT_TABLE,
  LimitsError,
  limitsFrom,
  type LimitName,
  type RuntimeBudgetName,
  type StaticCapName,
} from './limits.js';

describe('the defaults are the spec’s two tables and nothing else', () => {
  it('carries every static cap the spec gives a figure for', () => {
    expect(DEFAULT_LIMITS.caps).toMatchObject({
      optionsPerEnum: 100,
      rolesPerVerb: 8,
      phrasesPerVerb: 8,
      phraseCharacters: 80,
      nounsPerObject: 8,
      nounCharacters: 40,
      exitsPerPlace: 8,
      listElements: 16,
      literalCharacters: 600,
    });
  });

  it('carries every runtime budget the spec gives a figure for', () => {
    expect(DEFAULT_LIMITS.budgets).toMatchObject({
      steps: 50_000,
      pollSteps: 10_000,
      output: 8_000,
      events: 256,
      cascadeDepth: 20,
      passageDepth: 8,
      setRoleObjects: 8,
      spawnsPerTurn: 8,
      spawnsPerHour: 200,
      liveInstances: 2_000,
      wakesPerObject: 1,
      shortestWakeSeconds: 60,
    });
  });

  it('invents no figure where the spec says the host says', () => {
    expect(DEFAULT_LIMITS.caps.places).toBeNull();
    expect(DEFAULT_LIMITS.caps.objects).toBeNull();
    expect(DEFAULT_LIMITS.caps.kinds).toBeNull();
    expect(DEFAULT_LIMITS.caps.files).toBeNull();
    expect(DEFAULT_LIMITS.caps.sourceBytes).toBeNull();
  });

  it('invents no figure for the wall clock, which is a backstop and not a limit', () => {
    expect(DEFAULT_LIMITS.budgets.wallClockMs).toBeNull();
  });

  it('has no cap on statements in a body, because the step budget does that work', () => {
    expect(Object.keys(DEFAULT_LIMITS.caps)).not.toContain('statementsPerBody');
    expect(LIMIT_TABLE.map((l) => String(l.name))).not.toContain('statementsPerBody');
  });

  it('has no cap on nesting, because the compiler bounds its own recursion', () => {
    // The spec's Limits: that bound is the compiler's, not a figure a
    // host sets, so a host that offers one is offering something the
    // language does not have.
    expect(Object.keys(DEFAULT_LIMITS.caps)).not.toContain('nesting');
    expect(LIMIT_TABLE.map((l) => String(l.name))).not.toContain('nesting');
    expect(() => limitsFrom({ caps: { nesting: 8 } as never })).toThrow(/is not a limit/);
  });
});

describe('every limit says what it is and what exceeding it means', () => {
  const described = new Set(LIMIT_TABLE.map((l) => l.name));

  it('describes every static cap, as a refusal', () => {
    for (const name of Object.keys(DEFAULT_LIMITS.caps) as StaticCapName[]) {
      const row = LIMIT_TABLE.find((l) => l.name === name);
      expect(row, `${name} has no row in LIMIT_TABLE`).toBeDefined();
      expect(row!.kind).toBe('cap');
      expect(row!.exceeded).toBe('refusal');
    }
  });

  it('describes every runtime budget, as a fault', () => {
    for (const name of Object.keys(DEFAULT_LIMITS.budgets) as RuntimeBudgetName[]) {
      const row = LIMIT_TABLE.find((l) => l.name === name);
      expect(row, `${name} has no row in LIMIT_TABLE`).toBeDefined();
      expect(row!.kind).toBe('budget');
      expect(row!.exceeded).toBe('fault');
    }
  });

  it('describes nothing that is not a limit', () => {
    const real = new Set<string>([
      ...Object.keys(DEFAULT_LIMITS.caps),
      ...Object.keys(DEFAULT_LIMITS.budgets),
    ]);
    for (const name of described) expect(real.has(String(name))).toBe(true);
  });

  it('counts the options cap against one enum, and refuses when it is passed', () => {
    const row = LIMIT_TABLE.find((l) => l.name === 'optionsPerEnum');
    expect(row).toMatchObject({
      kind: 'cap',
      scope: 'enum',
      exceeded: 'refusal',
      bounds: 'options on one enum',
    });
  });

  it('names each one once, and says what it bounds', () => {
    expect(described.size).toBe(LIMIT_TABLE.length);
    for (const row of LIMIT_TABLE) expect(row.bounds.length).toBeGreaterThan(8);
  });
});

describe('the numbers are the host’s', () => {
  it('is the spec’s table when the host says nothing', () => {
    expect(limitsFrom()).toEqual(DEFAULT_LIMITS);
    expect(limitsFrom({})).toEqual(DEFAULT_LIMITS);
  });

  it('takes the host’s figure for any one limit and the spec’s for the rest', () => {
    const limits = limitsFrom({ budgets: { steps: 30_000 } });
    expect(limits.budgets.steps).toBe(30_000);
    expect(limits.budgets.events).toBe(DEFAULT_LIMITS.budgets.events);
    expect(limits.caps).toEqual(DEFAULT_LIMITS.caps);
  });

  it('takes the host’s figure for the options an enum may hold', () => {
    expect(limitsFrom({ caps: { optionsPerEnum: 3 } }).caps.optionsPerEnum).toBe(3);
    expect(limitsFrom().caps.optionsPerEnum).toBe(100);
  });

  it('lets a host set a limit the spec left to it', () => {
    expect(limitsFrom({ caps: { sourceBytes: 64 * 1024 } }).caps.sourceBytes).toBe(65_536);
    expect(limitsFrom({ budgets: { wallClockMs: 5_000 } }).budgets.wallClockMs).toBe(5_000);
  });

  it('lets a host raise a limit as readily as lower it: the language sets no ceiling', () => {
    expect(limitsFrom({ budgets: { steps: 10_000_000 } }).budgets.steps).toBe(10_000_000);
    expect(limitsFrom({ caps: { optionsPerEnum: 64 } }).caps.optionsPerEnum).toBe(64);
  });

  it('lets a host unset only what the spec gave no figure for', () => {
    expect(limitsFrom({ caps: { places: null } }).caps.places).toBeNull();
    expect(() => limitsFrom({ budgets: { steps: null as unknown as number } })).toThrow(
      LimitsError,
    );
  });

  it('gives back a fresh object, so nothing can edit the defaults', () => {
    const limits = limitsFrom({ budgets: { steps: 1 } });
    expect(limits.budgets).not.toBe(DEFAULT_LIMITS.budgets);
    expect(DEFAULT_LIMITS.budgets.steps).toBe(50_000);
  });
});

describe('a bad figure is the host’s mistake, and is loud at its boot', () => {
  const bad: [string, () => unknown][] = [
    ['a fraction', () => limitsFrom({ budgets: { steps: 1.5 } })],
    ['zero', () => limitsFrom({ caps: { optionsPerEnum: 0 } })],
    ['a negative', () => limitsFrom({ budgets: { events: -1 } })],
    ['not a number', () => limitsFrom({ caps: { optionsPerEnum: '8' as unknown as number } })],
    ['a limit that does not exist', () => limitsFrom({ caps: { rooms: 4 } as never })],
  ];
  for (const [what, call] of bad) {
    it(`refuses ${what}`, () => {
      expect(call).toThrow(LimitsError);
    });
  }

  it('names the limit it is about', () => {
    try {
      limitsFrom({ budgets: { steps: 0 } });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as LimitsError).limit).toBe('steps');
      expect((error as LimitsError).message).toContain('steps');
    }
  });
});

describe('a bundle records the caps it was checked against, and a host decides', () => {
  const ours = limitsFrom({ caps: { places: 100, sourceBytes: 65_536 } }).caps;

  it('is within when every recorded cap is no larger than ours', () => {
    expect(capsWithin(ours, ours)).toBe(true);
    expect(capsWithin(limitsFrom({ caps: { places: 50, sourceBytes: 1_000 } }).caps, ours)).toBe(
      true,
    );
  });

  it('is not within when one is larger, and names which', () => {
    const theirs = limitsFrom({
      caps: { places: 500, sourceBytes: 1_000, exitsPerPlace: 16 },
    }).caps;
    expect(capsWithin(theirs, ours)).toBe(false);
    expect(capsExceeding(theirs, ours)).toEqual(['exitsPerPlace', 'places']);
  });

  it('counts a cap we bound and they did not as exceeding ours', () => {
    expect(capsExceeding(DEFAULT_LIMITS.caps, ours)).toContain('places');
  });

  it('is content with a cap neither of us bounds', () => {
    expect(capsExceeding(DEFAULT_LIMITS.caps, DEFAULT_LIMITS.caps)).toEqual([]);
  });

  it('never names a limit that is not a cap', () => {
    const theirs = limitsFrom({ caps: { exitsPerPlace: 16 } }).caps;
    const names: LimitName[] = capsExceeding(theirs, ours);
    for (const name of names) expect(Object.keys(DEFAULT_LIMITS.caps)).toContain(name);
  });
});
