import { describe, expect, it } from 'vitest';

import {
  capsExceeding,
  capsGranted,
  DEFAULT_LIMITS,
  LIMIT_TABLE,
  LimitsError,
  limitsFrom,
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
      shortestWakeSeconds: 60,
      pendingWakesPerObject: 1,
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

  it('has no budget for spawns per hour or live instances, and one for wakes an object holds', () => {
    // The spec's Limits › Runtime budgets: how many live instances a
    // world may hold is the host's storage decision, there is no cap on
    // spawns over time, and how many wakes an object may have pending is
    // the table's, 1 by default.
    const names = Object.keys(DEFAULT_LIMITS.budgets);
    expect(names).not.toContain('spawnsPerHour');
    expect(names).not.toContain('liveInstances');
    expect(LIMIT_TABLE.map((l) => String(l.name))).not.toContain('spawnsPerHour');
    expect(LIMIT_TABLE.map((l) => String(l.name))).not.toContain('liveInstances');
    expect(() => limitsFrom({ budgets: { spawnsPerHour: 1 } as never })).toThrow(/is not a limit/);
    expect(() => limitsFrom({ budgets: { liveInstances: 1 } as never })).toThrow(/is not a limit/);
    expect(LIMIT_TABLE.find((l) => l.name === 'pendingWakesPerObject')).toMatchObject({
      kind: 'budget',
      scope: 'object',
      exceeded: 'fault',
    });
    expect(
      limitsFrom({ budgets: { pendingWakesPerObject: 3 } }).budgets.pendingWakesPerObject,
    ).toBe(3);
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

  it('describes every runtime budget, as a fault, but the wake floor, which raises what is asked', () => {
    for (const name of Object.keys(DEFAULT_LIMITS.budgets) as RuntimeBudgetName[]) {
      const row = LIMIT_TABLE.find((l) => l.name === name);
      expect(row, `${name} has no row in LIMIT_TABLE`).toBeDefined();
      expect(row!.kind).toBe('budget');
      expect(row!.exceeded, name).toBe(name === 'shortestWakeSeconds' ? 'raised' : 'fault');
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

  it('lets a host set every limit the spec lists, each one alone', () => {
    for (const name of Object.keys(DEFAULT_LIMITS.caps) as StaticCapName[]) {
      const limits = limitsFrom({ caps: { [name]: 7 } });
      expect(limits.caps[name], name).toBe(7);
      expect({ ...limits.caps, [name]: DEFAULT_LIMITS.caps[name] }).toEqual(DEFAULT_LIMITS.caps);
    }
    for (const name of Object.keys(DEFAULT_LIMITS.budgets) as RuntimeBudgetName[]) {
      const limits = limitsFrom({ budgets: { [name]: 7 } });
      expect(limits.budgets[name], name).toBe(7);
      expect({ ...limits.budgets, [name]: DEFAULT_LIMITS.budgets[name] }).toEqual(
        DEFAULT_LIMITS.budgets,
      );
    }
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

describe('a bundle records the caps it was checked against, and a load compares them', () => {
  const ours = limitsFrom({ caps: { places: 100, sourceBytes: 65_536 } }).caps;

  it('names nothing when every recorded cap is no larger than ours', () => {
    expect(capsExceeding(ours, ours)).toEqual([]);
    expect(
      capsExceeding(limitsFrom({ caps: { places: 50, sourceBytes: 1_000 } }).caps, ours),
    ).toEqual([]);
  });

  it('names each larger one, in the table’s order, with both figures', () => {
    const recorded = limitsFrom({
      caps: { places: 500, sourceBytes: 1_000, exitsPerPlace: 16 },
    }).caps;
    expect(capsExceeding(recorded, ours)).toEqual([
      { name: 'exitsPerPlace', recorded: 16, allowed: 8 },
      { name: 'places', recorded: 500, allowed: 100 },
    ]);
  });

  it('counts a cap we bound and they did not as exceeding ours', () => {
    expect(capsExceeding(DEFAULT_LIMITS.caps, ours)).toEqual([
      { name: 'places', recorded: null, allowed: 100 },
      { name: 'sourceBytes', recorded: null, allowed: 65_536 },
    ]);
  });

  it('is content with a cap we leave unset, however large theirs', () => {
    expect(capsExceeding(ours, DEFAULT_LIMITS.caps)).toEqual([]);
    expect(capsExceeding(DEFAULT_LIMITS.caps, DEFAULT_LIMITS.caps)).toEqual([]);
  });

  it('never names a limit that is not a cap', () => {
    const recorded = limitsFrom({ budgets: { steps: 1_000_000 } }).caps;
    expect(capsExceeding(recorded, ours).map((over) => over.name)).toEqual([
      'places',
      'sourceBytes',
    ]);
    for (const over of capsExceeding(limitsFrom({ caps: { exitsPerPlace: 16 } }).caps, ours)) {
      expect(Object.keys(DEFAULT_LIMITS.caps)).toContain(over.name);
    }
  });

  it('grants the larger of each under an exception, unset being the largest', () => {
    const recorded = limitsFrom({ caps: { exitsPerPlace: 16, places: 50, kinds: 12 } }).caps;
    const granted = capsGranted(recorded, ours);
    expect(granted).toMatchObject({
      exitsPerPlace: 16,
      places: 100,
      kinds: null,
      sourceBytes: null,
      optionsPerEnum: 100,
    });
    expect(capsExceeding(recorded, granted)).toEqual([]);
    expect(capsExceeding(ours, granted)).toEqual([]);
  });
});
