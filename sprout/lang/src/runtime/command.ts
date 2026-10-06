// A command turn (the spec's The runtime › Turns, Faults). Its order is
// fixed: parse; the consent pass; the effect pass, actor first and then
// roles in declared order; the queue, breadth-first in insertion order;
// what the engine answers (`engine-verbs.ts`); then the views of everyone
// present are marked stale, as every write turn that commits marks them.
// The one who typed the command is always told something: the parser's
// answer, the consent pass's refusal, what the effect pass said, what
// the engine answered or its `nothing_happens`, or, when the turn
// faults and is abandoned, the engine's `fault`. What it says is one
// sequence of effects in that order: the effect pass's lines, then the
// queue's, then the engine's answers (`effects.ts`); the place a move
// carried someone to is read among them where the body that moved them
// ended (`engine-verbs.ts`).
//
// Reading typed words is the parser's, reached through `Parser`, which
// `parser.ts` fills: the turn hands it the words, who typed them, each
// visitor's nickname and the turn's state, meter and draws, and it gives back
// the reading they make, drawn where several tied, or a line said to the
// actor in place of one, as an unknown word is answered.

import { displace, type Displaced } from './arrival.js';
import type { Budget } from './budget.js';
import { drain, type Drained } from './bus.js';
import type { Draft } from './draft.js';
import type { Draw } from './draws.js';
import { arrivalsRead, engineAnswers, withArrivals, type Arrived } from './engine-verbs.js';
import { owedAfter, owedBy } from './move.js';
import { engineSaid } from './engine-lines.js';
import { boundObject } from './evaluate.js';
import { planIntent, type IntentReading } from './intents.js';
import { plannedOf } from './parser/planned.js';
import type { Catalogue } from './catalogue.js';
import type { Effect, Unrendered } from './effects.js';
import { faultTold, stockFaultEffect } from './faults.js';
import type { InstanceId, VisitKey } from './ids.js';
import { standsInPlace } from './live.js';
import type { PassRule } from './range.js';
import {
  runReading,
  turnState,
  type Acted,
  type PermitRefusal,
  type Reading,
  type Said,
} from './reading.js';
import { nicknamesIn, readerOf, type StateReader, type WorldState } from './state.js';
import {
  effectsOver,
  writeTurn,
  type Committed,
  type Faulted,
  type TurnHost,
  type WriteInputs,
} from './turn.js';

/** What the parser reads while it parses: the turn's state before anything is written, its meter and its draws. */
export interface ParseContext {
  readonly state: StateReader;
  readonly catalogue: Catalogue;
  readonly passes: PassRule<InstanceId>;
  /** Parsing is charged to the turn's steps: a command too costly to read faults (Limits › Runtime budgets). */
  readonly budget: Budget;
  /** The turn's stream, the first draws the turn makes: a tie among things written alike (the spec's Spawning). */
  readonly draws: Draw;
  /** Each visitor's nickname, by the instance that is them, which is how a person is named (Names › Nicknames). */
  readonly nicknames: ReadonlyMap<InstanceId, string>;
  /** What the actor's pronouns name: what their own last command about a thing was done to (Parsing › Pronouns). */
  readonly referents: readonly InstanceId[];
  /** The reading the actor's own last command ran, which `again` runs again; null before one. */
  readonly lastReading: Reading | null;
  /**
   * Where the words are an item of a run read on its own turn: the
   * reading the line planned, every role but the item's filled as the
   * line began, and the role the words fill.
   */
  readonly item?: {
    readonly within: Reading;
    readonly role: string;
    readonly values: Reread['values'];
  };
}

/**
 * A turn a line runs after the one that read it (the spec's Parsing ›
 * Sequences, again and all): a reading planned before it ran, an
 * intent's step or a thing of `all` or of a run, or one whose run's item
 * is read afresh on its turn; or a command `and` joined, read from its
 * own words on its own turn.
 */
export type Following =
  { readonly planned: Reading; readonly reread?: Reread } | { readonly text: string };

/**
 * An item of a run that is read on its own turn (the spec's Parsing ›
 * Sequences, again and all): the role it fills and its words. The
 * reading it is planned with holds every other thing the line bound, so
 * only these words are read afresh, as the line was: with the words of
 * each value role, which bind against the thing this item names, and
 * what the actor's pronouns named when the line began.
 */
export interface Reread {
  readonly role: string;
  readonly words: string;
  /** Each value role's words, as the line typed them. */
  readonly values: readonly { readonly role: string; readonly words: string }[];
  /** What the actor's pronouns named when the line began. */
  readonly referents: readonly InstanceId[];
}

/** What the words typed make: a reading `actor` performs, or a line said to them in place of one. */
export type Parsed =
  | {
      readonly reading: Reading;
      /** The turns the line runs after it, in order. */
      readonly rest: readonly Following[];
      readonly drawn: DrawnReading | null;
      /** The world's `pronoun_correction` for each thing a pronoun named that declares another. */
      readonly corrected: readonly Said[];
    }
  | {
      readonly intended: IntentReading;
      /** The turns the line runs after the intent's steps, in order. */
      readonly rest: readonly Following[];
      readonly drawn: DrawnReading | null;
      readonly corrected: readonly Said[];
    }
  | { readonly answered: Said };

/**
 * A reading the parser drew from several that tied (the spec's Parsing ›
 * Choosing a reading): among how many, which the host logs as a warning,
 * and the engine's `meant` telling the actor which thing it named, where
 * words could tell it from its rivals'.
 */
export interface DrawnReading {
  readonly among: number;
  readonly meant: Said | null;
}

/** Reads the words `actor` typed. */
export type Parser = (text: string, actor: InstanceId, context: ParseContext) => Parsed;

/** What the host runs command turns with: its turn host, and the parser the bundle gives. */
export interface CommandHost extends TurnHost {
  readonly parse: Parser;
}

/** One typed command, as the host hands it over and the log records it. */
export interface Command extends WriteInputs {
  /** Who typed it. */
  readonly visit: VisitKey;
  readonly text: string;
  /**
   * A step an earlier turn of the same line planned, run in place of
   * reading `text` again (the spec's Parsing › Intents): its `when` was
   * read before the line ran, against the world the visitor typed into.
   */
  readonly planned?: Reading;
  /** The item of a run whose words this turn reads afresh, `planned` holding the other roles. */
  readonly reread?: Reread;
}

/**
 * What a committed command turn did. A visitor standing in a place that
 * is gone is displaced instead, and what they typed is not read, since it
 * was typed about where they no longer are (the spec's What absent means).
 */
export type Commanded =
  | {
      readonly answered: Said;
      /**
       * Whether it ends a line of several commands: the parser's answers
       * do, and `nothing_happens` for an intent with no step to run does not
       * (the spec's Parsing › Sequences, again and all).
       */
      readonly stops: boolean;
      /** The turns the line runs after it, where it does not stop it. */
      readonly next: readonly Following[];
    }
  | {
      readonly refused: PermitRefusal;
      readonly drawn: DrawnReading | null;
      /** The world's `pronoun_correction`s, said before anything else. */
      readonly corrected: readonly Said[];
      /** The reading this turn ran as a step of a line of several, an intent's, `all`'s or a run's, which the host logs at info; null otherwise. */
      readonly step: Reading | null;
    }
  | {
      readonly drawn: DrawnReading | null;
      readonly corrected: readonly Said[];
      /** The reading this turn ran as a step of a line of several, an intent's, `all`'s or a run's, which the host logs at info; null otherwise. */
      readonly step: Reading | null;
      /** The turns the line runs after it, in order, each a turn of its own the host runs. */
      readonly next: readonly Following[];
      /** Whether its body refused its actor something, which stops a line's steps as a refusal in the consent pass does. */
      readonly refusedActor: boolean;
      readonly acted: Acted;
      readonly drained: Drained;
      /** Each place a move carried a person to, as they read it, among the effect pass's and the queue's lines. */
      readonly arrived: readonly Arrived[];
      /** What the engine answered the command once the queue was empty. */
      readonly answers: readonly Unrendered[];
    }
  | { readonly displaced: Displaced };

/** A command turn: committed, or faulted and abandoned, with the actor told so. */
export type CommandTurn =
  | Committed<Commanded>
  | (Faulted & {
      /** The world's `fault`, told to the actor. */
      readonly told: Said;
      /** It, rendered, or the stock line where it cannot be: the one effect of a faulted command. */
      readonly effects: readonly Effect[];
    });

/**
 * Run `command` as one command turn over the committed `state`. The one
 * who typed it must be present; a command from anyone else is the host's
 * defect, thrown before the turn opens.
 */
export function commandTurn(state: WorldState, host: CommandHost, command: Command): CommandTurn {
  const committed = readerOf(state);
  const actor = presentActor(committed, command.visit);
  const gone = !standsInPlace(committed, actor);
  const written = writeTurn<Commanded>(
    state,
    'command',
    host,
    command,
    (turn) => {
      if (gone) return { displaced: displace(turn, command.visit) };
      const { draft, catalogue, passes, budget, draws } = turn;
      const nicknames = nicknamesIn(state);
      const { planned, reread } = command;
      const item = planned !== undefined && reread !== undefined;
      const parsed: Parsed =
        planned !== undefined && !item
          ? plannedOf(planned, actor, {
              state: draft,
              catalogue,
              passes,
              budget,
              draws,
              nicknames,
              referents: [],
              lastReading: null,
            })
          : host.parse(item ? reread.words : command.text, actor, {
              state: draft,
              catalogue,
              passes,
              budget,
              draws,
              nicknames,
              referents: item ? reread.referents : committed.visitor(command.visit)!.referents,
              lastReading: committed.visitor(command.visit)!.lastReading,
              ...(item
                ? { item: { within: planned, role: reread.role, values: reread.values } }
                : {}),
            });
      if ('answered' in parsed) {
        if (!parsed.answered.to.includes(actor)) {
          throw new Error(
            `the parser answered \`${command.text}\` to someone other than \`${actor}\`.`,
          );
        }
        return { answered: parsed.answered, stops: true, next: [] };
      }
      const { drawn, corrected } = parsed;
      let reading: Reading;
      let next: readonly Following[] = [];
      if ('intended' in parsed) {
        const [first, ...rest] = planIntent(parsed.intended, {
          state: draft,
          catalogue,
          passes,
          budget,
        });
        // Every step left out, the line does nothing, and is answered so.
        if (first === undefined) {
          return { answered: nothingHappens(draft, actor), stops: false, next: parsed.rest };
        }
        reading = first;
        next = [...rest.map((planned) => ({ planned })), ...parsed.rest];
      } else {
        reading = parsed.reading;
        next = parsed.rest;
      }
      if (reading.actor !== actor) {
        throw new Error(
          `\`${command.text}\` was read as \`${reading.actor}\`'s, not \`${actor}\`'s.`,
        );
      }
      const outcome = runReading(reading, turn);
      remember(draft, command.visit, reading);
      // A turn of a line of several readings planned at once, an intent's,
      // `all`'s or a run's, is a step the host logs.
      const several = 'intended' in parsed || next.some((one) => 'planned' in one);
      const step = command.planned !== undefined || several ? reading : null;
      if ('refused' in outcome) return { ...outcome, drawn, corrected, step };
      const drained = drain(outcome, turn);
      const after = { state: turnState(draft), catalogue, passes, budget, nicknames };
      const arrived = arrivalsRead(
        [
          ...owedBy(outcome.notices, outcome.said.length),
          ...owedAfter(drained.described, outcome.said.length),
        ],
        after,
      );
      const answers = engineAnswers(reading, after);
      const refusedActor = outcome.said.some(
        (said) => said.effect === 'refused' && said.to.includes(actor),
      );
      return {
        drawn,
        corrected,
        step,
        next,
        refusedActor,
        acted: outcome,
        drained,
        arrived,
        answers,
      };
    },
    (done) => ({ actor, lines: linesSaidBy(done, actor) }),
  );
  if (written.committed) return written;
  return { ...written, ...faultEffects(state, host, command, actor) };
}

/**
 * Keep `reading` as `visit`'s last, which `again` runs again, and what it
 * was done to as what their pronouns name: the thing or set its first role
 * binds (the spec's Parsing › Pronouns; Sequences, again and all), refused
 * or not. A reading done to nothing leaves their pronouns as they were.
 */
function remember(draft: Draft, visit: VisitKey, reading: Reading): void {
  const record = draft.visitor(visit)!;
  const first = reading.verb.roles[0];
  const bound = first === undefined ? undefined : reading.bindings.get(first.name);
  const done =
    bound === undefined ? [] : 'object' in bound ? [bound.object] : 'set' in bound ? bound.set : [];
  const referents = done.length === 0 ? record.referents : done;
  if (record.lastReading === reading && sameIds(referents, record.referents)) return;
  draft.putVisitor({ ...record, referents, lastReading: reading });
}

function sameIds(a: readonly InstanceId[], b: readonly InstanceId[]): boolean {
  return a.length === b.length && a.every((id, at) => id === b[at]);
}

/**
 * Whether a line goes on past `turn`, to the next step its intent planned
 * or the next command it holds: it committed, and acted refusing its actor
 * nothing, or was answered with what does not stop a line (the spec's
 * Parsing › Intents; Sequences, again and all: a refusal, `unknown`,
 * `not_here` or a fault stops the rest).
 */
export function lineGoesOn(turn: CommandTurn): boolean {
  if (!turn.committed) return false;
  const done = turn.value;
  if ('acted' in done) return !done.refusedActor;
  return 'answered' in done && !done.stops;
}

/** The engine's `nothing_happens`, to `actor`: what a line whose intent planned no step to run is answered with. */
function nothingHappens(state: StateReader, actor: InstanceId): Said {
  const here = state.instance(actor)!.container!;
  return {
    effect: 'said',
    to: [actor],
    ...engineSaid(state, 'nothing_happens', actor, here),
    speaker: null,
    bindings: new Map([
      ['actor', boundObject(actor)],
      ['here', boundObject(here)],
    ]),
  };
}

/** What a committed command said, in the order it said it. */
function linesSaidBy(done: Commanded, actor: InstanceId): Unrendered[] {
  if ('answered' in done) return [{ said: done.answered }];
  if ('displaced' in done) return displacedLines(done.displaced);
  // A pronoun corrected, and a reading drawn from a tie told the thing it
  // meant, come before what the reading says.
  const meant: Unrendered[] = [
    ...done.corrected.map((said) => ({ said })),
    ...(done.drawn?.meant == null ? [] : [{ said: done.drawn.meant }]),
  ];
  if ('refused' in done) {
    const { by, said, bindings } = done.refused;
    return [
      ...meant,
      { said: { effect: 'refused', to: [actor], by, speaker: null, said, bindings } },
    ];
  }
  return [
    ...meant,
    ...withArrivals([...done.acted.said, ...done.drained.said], done.arrived),
    ...done.answers,
  ];
}

/** What a displaced visitor is told and what the entry says, in order, then the place they came in to. */
function displacedLines(displaced: Displaced): Unrendered[] {
  const { told, entry, drained, arrived } = displaced;
  if ('closed' in entry) return [{ said: told }];
  if ('refused' in entry) return [{ said: told }, { said: entry.refused }];
  return [{ said: told }, ...withArrivals([...entry.said, ...(drained?.said ?? [])], arrived)];
}

/**
 * The world's `fault`, told to `actor` over the committed state, and
 * rendered; where the world's own words cannot be rendered, the stock
 * line is told, so a fault is never silent.
 */
function faultEffects(
  state: WorldState,
  host: CommandHost,
  command: Command,
  actor: InstanceId,
): { readonly told: Said; readonly effects: readonly Effect[] } {
  const committed = readerOf(state);
  const told = faultTold(committed, actor);
  try {
    const lines = [{ said: told }];
    return { told, effects: effectsOver(state, 'command', host, command, { actor, lines }) };
  } catch {
    return { told, effects: [stockFaultEffect(committed, actor, command.visit)] };
  }
}

/** The instance `visit` acts as, which must stand somewhere in the world. */
function presentActor(state: StateReader, visit: VisitKey): InstanceId {
  const visitor = state.visitor(visit);
  if (visitor === undefined) throw new Error(`\`${visit}\` has never visited this world.`);
  const container = state.instance(visitor.instance)?.container ?? null;
  if (container === null)
    throw new Error(`\`${visit}\` is not in this world, so cannot act in it.`);
  return visitor.instance;
}
