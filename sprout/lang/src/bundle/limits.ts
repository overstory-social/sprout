// The limits, and whose they are (the spec's Limits).
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
//
// Nesting is not here either. The spec's Limits gives it no cap: the
// compiler bounds its own recursion so that pathologically deep text is
// refused rather than crashing it, and that bound is the parser's own,
// not a figure a host sets and not something a bundle records.
//
// Three bounds outlive a turn, per the spec's Limits › Runtime budgets.
// How many live instances a world may hold is the host's storage
// decision, not a figure in this table: a `spawn` faults when the host
// will not hold another. How many wakes one object may have pending is
// the table's, held across turns rather than spent in one. There is no
// cap on spawns over time. How many people may stand in one place is
// the host's too (The host contract › Enforcement): the spec gives it no
// figure, so it is unbounded until a host sets one, and a move that would
// pass it is refused in the engine's words rather than faulted. The
// effects extensions record in a turn are capped with no figure either
// (Extensions › Trust), so they too are unbounded until a host sets one.
// A nickname's length is the table's, checked once at admission rather
// than spent in a turn, and a nickname past it is refused, not faulted.
//
// A bundle records the static caps it was checked against, and a load
// compares them with the host's own (`capsExceeding`): a world checked
// against larger caps is refused unless the host has made an exception
// for it, and then runs under the larger of the two (`capsGranted`).

/** A cap checked when a world compiles. Exceeding one refuses the world, naming the line. */
export interface StaticCaps {
  /** Options on one enum. */
  readonly optionsPerEnum: number;
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
  /**
   * Places in one world: its objects that hold actors, the world itself
   * not among them. The spec gives no figure: the host says, or nothing does.
   */
  readonly places: number | null;
  /** Objects in one world, the world itself not among them. As the host says. */
  readonly objects: number | null;
  /** Kinds in one world, its own and any library's the host has not blessed. As the host says. */
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
  /**
   * Characters of output in one turn, PER RECIPIENT. Only the actor's own
   * past it faults the turn; anyone else is told nothing more that turn, so
   * who else was there never faults it.
   */
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
  /** The shortest wake, in seconds — the host's floor to raise: a `wake` asked for sooner waits this long. */
  readonly shortestWakeSeconds: number;
  /** Wakes one object may have pending, held across turns; a `wake` past it faults. */
  readonly pendingWakesPerObject: number;
  /**
   * People who may stand in one place at once, held across turns: a move
   * that would bring one more in is refused. The spec gives no figure (The
   * host contract › Enforcement): the host bounds the crowd, or nothing does.
   */
  readonly peoplePerPlace: number | null;
  /**
   * Effects the statements of extensions may record in one turn, a poll's
   * among them. The spec caps them and gives no figure (Extensions ›
   * Trust): the host says, or nothing does.
   */
  readonly extensionEffects: number | null;
  /** Characters a nickname may have, counted as it is kept; checked once at admission, which refuses one past it. */
  readonly nicknameCharacters: number;
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
    optionsPerEnum: 100,
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
    shortestWakeSeconds: 60,
    pendingWakesPerObject: 1,
    peoplePerPlace: null,
    extensionEffects: null,
    nicknameCharacters: 24,
    wallClockMs: null,
  },
};

/**
 * What going past a limit does: refuse the world at compile, fault the
 * turn at run time, for a floor raise what was asked to it, refuse the
 * move that would pass it, or refuse the nickname at admission.
 */
export type WhenExceeded = 'refusal' | 'fault' | 'raised' | 'move-refused' | 'nickname-refused';

/** What a limit is counted against. */
export type LimitScope =
  | 'enum'
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
  | 'nickname';

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
    name: 'optionsPerEnum',
    kind: 'cap',
    scope: 'enum',
    exceeded: 'refusal',
    bounds: 'options on one enum',
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
    bounds:
      'characters of output in one turn, per recipient; only the actor’s own faults the turn, and anyone else is told nothing more that turn',
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
    name: 'shortestWakeSeconds',
    kind: 'budget',
    scope: 'object',
    exceeded: 'raised',
    bounds: 'the shortest wake, the host’s floor, which a sooner one is raised to',
  },
  {
    name: 'pendingWakesPerObject',
    kind: 'budget',
    scope: 'object',
    exceeded: 'fault',
    bounds: 'wakes one object may have pending, held across turns',
  },
  {
    name: 'peoplePerPlace',
    kind: 'budget',
    scope: 'place',
    exceeded: 'move-refused',
    bounds: 'people standing in one place at once, a move that would bring one more in refused',
  },
  {
    name: 'extensionEffects',
    kind: 'budget',
    scope: 'turn',
    exceeded: 'fault',
    bounds: 'effects the statements of extensions record in one turn',
  },
  {
    name: 'nicknameCharacters',
    kind: 'budget',
    scope: 'nickname',
    exceeded: 'nickname-refused',
    bounds: 'characters in a nickname, counted as it is kept, checked once at admission',
  },
  {
    name: 'wallClockMs',
    kind: 'budget',
    scope: 'turn',
    exceeded: 'fault',
    bounds: 'the wall-clock backstop, which should never fire and is logged loudly when it does',
  },
];

/**
 * The host's limit configuration: its figure for any limit it names, the
 * spec's default for every other. `null` leaves unbounded a limit whose
 * default the spec gives as the host's to say, and no other.
 */
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
  'peoplePerPlace',
  'extensionEffects',
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

/** One cap a world was checked against that is larger than the host's, and the two figures. */
export interface CapExceeded {
  readonly name: StaticCapName;
  /** What the world was checked against; `null` when that was no cap at all. */
  readonly recorded: number | null;
  /** What this host allows. */
  readonly allowed: number;
}

/**
 * The caps a world was checked against that are larger than `ours`, in
 * the table's order. A cap `ours` leaves unset is never exceeded; one
 * the world was checked without is exceeded by any figure of ours.
 */
export function capsExceeding(recorded: StaticCaps, ours: StaticCaps): CapExceeded[] {
  const over: CapExceeded[] = [];
  for (const name of Object.keys(DEFAULT_LIMITS.caps) as StaticCapName[]) {
    const allowed = ours[name];
    if (allowed === null) continue;
    const theirs = recorded[name];
    if (theirs === null || theirs > allowed) over.push({ name, recorded: theirs, allowed });
  }
  return over;
}

/**
 * The caps a world runs under when the host has made an exception for
 * it: for each, the larger of what it was checked against and the
 * host's own, unset being the largest.
 */
export function capsGranted(recorded: StaticCaps, ours: StaticCaps): StaticCaps {
  const granted: Record<string, number | null> = {};
  for (const name of Object.keys(DEFAULT_LIMITS.caps) as StaticCapName[]) {
    const theirs = recorded[name];
    const allowed = ours[name];
    granted[name] = theirs === null || allowed === null ? null : Math.max(theirs, allowed);
  }
  return granted as unknown as StaticCaps;
}
