// What a turn has left to spend (the spec's Limits › Runtime budgets).
//
// One of these is made for each turn and charged as the turn runs.
// Exhausting any of them throws `BudgetExhausted`, which the turn
// boundary turns into a fault: the transaction is abandoned, the world
// is left exactly as it was, and whoever acted is told through the
// world's `fault` passage (`turn.ts`, `faults.ts`); counting is this.
//
// Two things this deliberately does not do. It holds no figure of its
// own — every number comes from the `RuntimeBudgets` the host set. And
// it never reads the clock: the wall-clock backstop is checked against a
// `now` the host passes in, so a turn stays deterministic and a suite
// can prove the backstop fires without waiting for it.
//
// What is charged belongs to the code doing it: range walks are
// `range.ts`'s, the objects a set role binds `reading.ts`'s, parsing
// the parser's (B27), and `each` the item that brings it. What is here is the meter they all charge
// against, so that none of them invents a second one.

import type { RuntimeBudgetName, RuntimeBudgets } from '../bundle/limits.js';

/**
 * The kinds of turn: the spec's five, and a visitor's arrival and
 * departure, which move a person in and out of the tree as write turns do
 * (The host contract › Admission and identity). A poll is read-only and
 * has its own step budget.
 */
export type TurnKind =
  'command' | 'tick' | 'wake' | 'maintenance' | 'arrival' | 'departure' | 'poll';

/**
 * A budget ran out. Thrown, because a turn that cannot afford to finish
 * has nothing useful to return and everything it did is about to be
 * rolled back.
 */
export class BudgetExhausted extends Error {
  constructor(
    readonly limit: RuntimeBudgetName,
    readonly allowed: number,
    detail: string,
  ) {
    super(`${limit}: ${detail}`);
    this.name = 'BudgetExhausted';
  }
}

/**
 * How often the wall-clock backstop is checked, in steps. Reading the
 * clock is the expensive part, and a backstop that fires a thousand
 * steps late has still fired — it exists to catch what the step budget
 * missed, and is never load-bearing. This is a sampling rate, not a
 * limit, which is why it is not the host's.
 */
const CLOCK_STRIDE = 1024;

export class Budget {
  private steps = 0;
  private events = 0;
  private spawns = 0;
  private passages = 0;
  private nextClockCheck = CLOCK_STRIDE;
  private readonly output = new Map<string, number>();
  private readonly deadline: number | null;
  private outOf: RuntimeBudgetName | null = null;

  /** How many steps this turn may spend: a poll has its own figure. */
  readonly allowedSteps: number;

  /**
   * @param limits the host's figures, never the language's
   * @param kind which turn this is, since a poll is budgeted apart
   * @param now the host's clock, for the backstop only; without one there is no backstop
   */
  constructor(
    readonly limits: RuntimeBudgets,
    readonly kind: TurnKind = 'command',
    private readonly now?: () => number,
  ) {
    this.allowedSteps = kind === 'poll' ? limits.pollSteps : limits.steps;
    this.deadline =
      limits.wallClockMs !== null && now !== undefined ? now() + limits.wallClockMs : null;
  }

  /** Steps spent so far. */
  get spentSteps(): number {
    return this.steps;
  }

  /** Events sent so far. */
  get spentEvents(): number {
    return this.events;
  }

  /**
   * The figure every part of a turn charges — steps, events or the wall
   * clock — once it has run out, and null before: nothing more can run
   * under this budget then. The other figures bound only what charges them.
   */
  get exhausted(): RuntimeBudgetName | null {
    return this.outOf;
  }

  /** Spawns made so far this turn. */
  get spentSpawns(): number {
    return this.spawns;
  }

  /** How deep passages are currently nested. */
  get passageDepth(): number {
    return this.passages;
  }

  /** Characters already said to one recipient this turn. */
  spentOutput(recipient: string): number {
    return this.output.get(recipient) ?? 0;
  }

  /**
   * Charge steps. Every statement executed, every expression node
   * evaluated, every `each` iteration, every object a range walk visits
   * and every noun the parser tries is one.
   */
  spend(steps = 1): void {
    this.steps += steps;
    if (this.steps > this.allowedSteps) {
      this.outOf = this.kind === 'poll' ? 'pollSteps' : 'steps';
      throw new BudgetExhausted(
        this.kind === 'poll' ? 'pollSteps' : 'steps',
        this.allowedSteps,
        `a ${this.kind} turn may take ${this.allowedSteps} steps.`,
      );
    }
    if (this.deadline !== null && this.steps >= this.nextClockCheck) {
      this.nextClockCheck = this.steps + CLOCK_STRIDE;
      if (this.now!() > this.deadline) {
        this.outOf = 'wallClockMs';
        throw new BudgetExhausted(
          'wallClockMs',
          this.limits.wallClockMs!,
          'the wall-clock backstop fired, which means the step budget did not catch something.',
        );
      }
    }
  }

  /** Charge characters of prose to one recipient. The budget is per recipient, so a crowd is the host's cost. */
  say(recipient: string, characters: number): void {
    const spent = this.spentOutput(recipient) + characters;
    this.output.set(recipient, spent);
    if (spent > this.limits.output) {
      throw new BudgetExhausted(
        'output',
        this.limits.output,
        `one turn may say ${this.limits.output} characters to any one person.`,
      );
    }
  }

  /** Charge one event. */
  event(): void {
    this.events += 1;
    if (this.events > this.limits.events) {
      this.outOf = 'events';
      throw new BudgetExhausted(
        'events',
        this.limits.events,
        `one turn may send ${this.limits.events} events.`,
      );
    }
  }

  /**
   * Check an envelope's cascade depth. Depth rides on the envelope
   * rather than on a call stack, because the queue drains breadth-first:
   * the visitor's command is depth 0 and every event a handler sends is
   * one deeper.
   */
  cascadeTo(depth: number): void {
    if (depth > this.limits.cascadeDepth) {
      throw new BudgetExhausted(
        'cascadeDepth',
        this.limits.cascadeDepth,
        `events may cascade ${this.limits.cascadeDepth} deep.`,
      );
    }
  }

  /** Check the objects one set role bound. */
  setRole(objects: number): void {
    if (objects > this.limits.setRoleObjects) {
      throw new BudgetExhausted(
        'setRoleObjects',
        this.limits.setRoleObjects,
        `one set role may bind ${this.limits.setRoleObjects} objects.`,
      );
    }
  }

  /**
   * Charge one spawn against the turn's cap. How many live instances a
   * world may hold is the host's storage decision, not a budget, and is
   * checked where the spawn is made.
   */
  spawn(): void {
    this.spawns += 1;
    if (this.spawns > this.limits.spawnsPerTurn) {
      throw new BudgetExhausted(
        'spawnsPerTurn',
        this.limits.spawnsPerTurn,
        `one turn may spawn ${this.limits.spawnsPerTurn} objects.`,
      );
    }
  }

  /**
   * Run something one passage deeper. A passage invoking a passage is a
   * real call stack, so this is a bracket and not a number carried
   * along; the depth comes back down however `run` ends.
   */
  passage<T>(run: () => T): T {
    if (this.passages + 1 > this.limits.passageDepth) {
      throw new BudgetExhausted(
        'passageDepth',
        this.limits.passageDepth,
        `passages may invoke one another ${this.limits.passageDepth} deep.`,
      );
    }
    this.passages += 1;
    try {
      return run();
    } finally {
      this.passages -= 1;
    }
  }
}
