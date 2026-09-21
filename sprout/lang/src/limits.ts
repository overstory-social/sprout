// The limits, and whose they are (B02; the spec's Limits).
//
// Two kinds, kept apart because that is what makes both defensible:
//
//   STATIC CAPS bound what a person must read to know what a world does.
//   They are checked when a world compiles, and exceeding one is a
//   REFUSAL naming the line.
//
//   RUNTIME BUDGETS bound what a turn may cost. They are counted while
//   running, and exhausting one is a FAULT: the turn is abandoned, the
//   world is left exactly as it was, and whoever acted is told through
//   the world's `fault` passage.
//
// **The numbers are the host's.** The language defines which limits
// exist and what exceeding each one means; the host running the world
// sets every value. What is here is the table of what exists and the
// figures a host starts from — never a floor, never a ceiling, and never
// hard-coded anywhere else. Where the spec's default column is prose
// rather than a figure ("as the host says", "a backstop that should
// never fire") the default is `null`: the language does not bound it and
// will not invent a quota for a host that has not set one.
//
// There is deliberately NO limit on statements in a body. A cap there
// would bound cost in the one place only review effort belongs, and
// would push authors toward chains of `if` instead of prose. The step
// budget does that work, at run time, where cost actually lives.

/** A cap checked when a world compiles. Exceeding one refuses the world, naming the line. */
export interface StaticCaps {
  /** How deep an expression or a block may nest. */
  readonly nesting: number;
  /** Roles on one verb, counting a set role as one. */
  readonly rolesPerVerb: number;
  /** Phrases on one verb. */
  readonly phrasesPerVerb: number;
  /** Characters in one phrase. */
  readonly phraseCharacters: number;
  /** Nouns on one object. */
  readonly nounsPerObject: number;
  /** Characters in one noun word. */
  readonly nounCharacters: number;
  /** Exits on one place. */
  readonly exitsPerPlace: number;
  /** Elements in one list. */
  readonly listElements: number;
  /** Characters in a `say`, `tell` or `text` written as a literal. */
  readonly literalCharacters: number;
  /** Places in one world. The spec gives no figure: the host says, or nothing does. */
  readonly places: number | null;
  /** Objects in one world. As the host says. */
  readonly objects: number | null;
  /** Kinds in one world. As the host says. */
  readonly kinds: number | null;
  /** Files in one world. As the host says. */
  readonly files: number | null;
  /**
   * Total source bytes in one world. As the host says. Vendored library
   * source the host has blessed is content-hashed and exempt from this
   * and from `kinds`; a modified copy is the author's own source and
   * counts as it.
   */
  readonly sourceBytes: number | null;
}

/** A budget counted while a turn runs. Exhausting one faults the turn. */
export interface RuntimeBudgets {
  /**
   * Steps in one turn: every statement executed, every expression node
   * evaluated, every `each` iteration, every object a range walk visits,
   * every noun the parser tries. The one that matters, and the only one
   * that is deterministic enough to be part of a moderation story.
   */
  readonly steps: number;
  /** Steps in one poll, which is a turn with its own budget and no seed. */
  readonly pollSteps: number;
  /** Characters of output in one turn, PER RECIPIENT, so a crowded place never faults the turn. */
  readonly output: number;
  /** Events in one turn. */
  readonly events: number;
  /** How deep events may cascade. */
  readonly cascadeDepth: number;
  /** How deep passages may invoke one another. */
  readonly passageDepth: number;
  /** Objects one set role may bind. */
  readonly setRoleObjects: number;
  /** Spawns in one turn. */
  readonly spawnsPerTurn: number;
  /** Spawns in one world in one hour. */
  readonly spawnsPerHour: number;
  /** Live instances in one world. */
  readonly liveInstances: number;
  /** Pending wakes one object may hold. */
  readonly wakesPerObject: number;
  /** The shortest wake a world may ask for, in seconds — the host's floor to raise. */
  readonly shortestWakeSeconds: number;
  /**
   * The wall-clock backstop, in milliseconds. The spec gives no figure:
   * it is a backstop against something the step budget failed to catch,
   * logged loudly when it fires, and never load-bearing. `null` until a
   * host sets one, because a clock limit gives different answers on
   * different days and cannot be the language's.
   */
  readonly wallClockMs: number | null;
}

export interface Limits {
  readonly caps: StaticCaps;
  readonly budgets: RuntimeBudgets;
}

export type StaticCapName = keyof StaticCaps;
export type RuntimeBudgetName = keyof RuntimeBudgets;
export type LimitName = StaticCapName | RuntimeBudgetName;

/** The figures a host starts from — the spec's two tables, and nothing else's. */
export const DEFAULT_LIMITS: Limits = {
  caps: {
    nesting: 8,
    rolesPerVerb: 8,
    phrasesPerVerb: 8,
    phraseCharacters: 80,
    nounsPerObject: 8,
    nounCharacters: 40,
    exitsPerPlace: 8,
    listElements: 16,
    literalCharacters: 600,
    places: null,
    objects: null,
    kinds: null,
    files: null,
    sourceBytes: null,
  },
  budgets: {
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
    wallClockMs: null,
  },
};

/** What exceeding a limit does: refuse the world at compile, or fault the turn at run time. */
export type WhenExceeded = 'refusal' | 'fault';

/** What a limit is counted against. */
export type LimitScope =
  | 'expression'
  | 'verb'
  | 'phrase'
  | 'object'
  | 'noun'
  | 'place'
  | 'list'
  | 'literal'
  | 'world'
  | 'turn'
  | 'poll'
  | 'recipient'
  | 'role'
  | 'hour';

export interface LimitDescription {
  readonly name: LimitName;
  readonly kind: 'cap' | 'budget';
  readonly scope: LimitScope;
  readonly exceeded: WhenExceeded;
  /** What it bounds, in the words the generated skill and the moderation view use. */
  readonly bounds: string;
}

/**
 * Every limit the language has, what it is counted against and what
 * exceeding it means. This is a table rather than prose because the
 * generated skill is built from the compiler's own tables (B53) and
 * cannot describe a limit the compiler does not enforce.
 */
export const LIMIT_TABLE: readonly LimitDescription[] = [
  {
    name: 'nesting',
    kind: 'cap',
    scope: 'expression',
    exceeded: 'refusal',
    bounds: 'how deep an expression or a block may nest',
  },
  {
    name: 'rolesPerVerb',
    kind: 'cap',
    scope: 'verb',
    exceeded: 'refusal',
    bounds: 'roles on one verb, counting a set role as one',
  },
  {
    name: 'phrasesPerVerb',
    kind: 'cap',
    scope: 'verb',
    exceeded: 'refusal',
    bounds: 'phrases on one verb',
  },
  {
    name: 'phraseCharacters',
    kind: 'cap',
    scope: 'phrase',
    exceeded: 'refusal',
    bounds: 'characters in one phrase',
  },
  {
    name: 'nounsPerObject',
    kind: 'cap',
    scope: 'object',
    exceeded: 'refusal',
    bounds: 'nouns on one object',
  },
  {
    name: 'nounCharacters',
    kind: 'cap',
    scope: 'noun',
    exceeded: 'refusal',
    bounds: 'characters in one noun word',
  },
  {
    name: 'exitsPerPlace',
    kind: 'cap',
    scope: 'place',
    exceeded: 'refusal',
    bounds: 'exits on one place',
  },
  {
    name: 'listElements',
    kind: 'cap',
    scope: 'list',
    exceeded: 'refusal',
    bounds: 'elements in one list',
  },
  {
    name: 'literalCharacters',
    kind: 'cap',
    scope: 'literal',
    exceeded: 'refusal',
    bounds: 'characters in a say, tell or text written as a literal',
  },
  { name: 'places', kind: 'cap', scope: 'world', exceeded: 'refusal', bounds: 'places in a world' },
  {
    name: 'objects',
    kind: 'cap',
    scope: 'world',
    exceeded: 'refusal',
    bounds: 'objects in a world',
  },
  { name: 'kinds', kind: 'cap', scope: 'world', exceeded: 'refusal', bounds: 'kinds in a world' },
  { name: 'files', kind: 'cap', scope: 'world', exceeded: 'refusal', bounds: 'files in a world' },
  {
    name: 'sourceBytes',
    kind: 'cap',
    scope: 'world',
    exceeded: 'refusal',
    bounds: 'total source bytes in a world, blessed library source exempt',
  },
  {
    name: 'steps',
    kind: 'budget',
    scope: 'turn',
    exceeded: 'fault',
    bounds:
      'every statement executed, every expression node evaluated, every each iteration, every object a range walk visits, every noun the parser tries',
  },
  {
    name: 'pollSteps',
    kind: 'budget',
    scope: 'poll',
    exceeded: 'fault',
    bounds: 'the same steps, in a poll, which has its own budget',
  },
  {
    name: 'output',
    kind: 'budget',
    scope: 'recipient',
    exceeded: 'fault',
    bounds: 'characters of output in one turn, per recipient',
  },
  {
    name: 'events',
    kind: 'budget',
    scope: 'turn',
    exceeded: 'fault',
    bounds: 'events in one turn',
  },
  {
    name: 'cascadeDepth',
    kind: 'budget',
    scope: 'turn',
    exceeded: 'fault',
    bounds: 'how deep events may cascade',
  },
  {
    name: 'passageDepth',
    kind: 'budget',
    scope: 'turn',
    exceeded: 'fault',
    bounds: 'how deep passages may invoke one another',
  },
  {
    name: 'setRoleObjects',
    kind: 'budget',
    scope: 'role',
    exceeded: 'fault',
    bounds: 'objects one set role may bind',
  },
  {
    name: 'spawnsPerTurn',
    kind: 'budget',
    scope: 'turn',
    exceeded: 'fault',
    bounds: 'spawns in one turn',
  },
  {
    name: 'spawnsPerHour',
    kind: 'budget',
    scope: 'hour',
    exceeded: 'fault',
    bounds: 'spawns in one world in one hour',
  },
  {
    name: 'liveInstances',
    kind: 'budget',
    scope: 'world',
    exceeded: 'fault',
    bounds: 'live instances in one world',
  },
  {
    name: 'wakesPerObject',
    kind: 'budget',
    scope: 'object',
    exceeded: 'fault',
    bounds: 'pending wakes one object may hold',
  },
  {
    name: 'shortestWakeSeconds',
    kind: 'budget',
    scope: 'object',
    exceeded: 'fault',
    bounds: 'the shortest wake a world may ask for, the host floor',
  },
  {
    name: 'wallClockMs',
    kind: 'budget',
    scope: 'turn',
    exceeded: 'fault',
    bounds: 'the wall-clock backstop, which should never fire and is logged loudly when it does',
  },
];

/** A host's limits: any of them, and the spec's figure for the rest. */
export interface LimitOverrides {
  readonly caps?: Partial<StaticCaps>;
  readonly budgets?: Partial<RuntimeBudgets>;
}

/** Which limits may be left unset, because the spec gives no figure for them. */
const UNBOUNDABLE = new Set<LimitName>([
  'places',
  'objects',
  'kinds',
  'files',
  'sourceBytes',
  'wallClockMs',
]);

/**
 * A host misconfiguring its limits is a mistake in the host, not a
 * problem with a world, so it is thrown at the boot that made it rather
 * than collected as a diagnostic.
 */
export class LimitsError extends Error {
  constructor(
    readonly limit: LimitName,
    detail: string,
  ) {
    super(`${limit}: ${detail}`);
    this.name = 'LimitsError';
  }
}

function checked(name: LimitName, value: number | null | undefined): number | null {
  if (value === undefined || value === null) {
    if (UNBOUNDABLE.has(name)) return null;
    throw new LimitsError(name, 'has a figure in the spec and cannot be unset.');
  }
  if (!Number.isInteger(value))
    throw new LimitsError(name, `must be a whole number, not ${value}.`);
  if (value < 1) throw new LimitsError(name, `must be at least 1, not ${value}.`);
  return value;
}

/**
 * The limits a world runs under: the host's figures where it gave any,
 * the spec's where it did not. Every number is checked here so that a
 * bad one is caught at the host's boot rather than in the middle of
 * somebody's turn.
 */
export function limitsFrom(overrides: LimitOverrides = {}): Limits {
  const caps: Record<string, number | null> = {};
  for (const [name, fallback] of Object.entries(DEFAULT_LIMITS.caps)) {
    const given = overrides.caps?.[name as StaticCapName];
    caps[name] = checked(name as LimitName, given === undefined ? fallback : given);
  }
  const budgets: Record<string, number | null> = {};
  for (const [name, fallback] of Object.entries(DEFAULT_LIMITS.budgets)) {
    const given = overrides.budgets?.[name as RuntimeBudgetName];
    budgets[name] = checked(name as LimitName, given === undefined ? fallback : given);
  }
  for (const name of Object.keys(overrides.caps ?? {})) {
    if (!(name in DEFAULT_LIMITS.caps)) throw new LimitsError(name as LimitName, 'is not a limit.');
  }
  for (const name of Object.keys(overrides.budgets ?? {})) {
    if (!(name in DEFAULT_LIMITS.budgets)) {
      throw new LimitsError(name as LimitName, 'is not a limit.');
    }
  }
  return { caps: caps as unknown as StaticCaps, budgets: budgets as unknown as RuntimeBudgets };
}

/** Whether a world checked against `theirs` stays inside `ours`. */
export function capsWithin(theirs: StaticCaps, ours: StaticCaps): boolean {
  return (Object.keys(ours) as StaticCapName[]).every((name) => {
    const mine = ours[name];
    if (mine === null) return true;
    const yours = theirs[name];
    return yours !== null && yours <= mine;
  });
}

/**
 * The caps a world was checked against that are larger than ours. A
 * bundle records the caps it was checked against at publish, and a host
 * loading one checked against larger caps than its own decides for
 * itself whether to run it — so this names what it is deciding about.
 */
export function capsExceeding(theirs: StaticCaps, ours: StaticCaps): StaticCapName[] {
  return (Object.keys(ours) as StaticCapName[]).filter((name) => {
    const mine = ours[name];
    if (mine === null) return false;
    const yours = theirs[name];
    return yours === null || yours > mine;
  });
}
