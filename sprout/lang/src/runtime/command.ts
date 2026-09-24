// A command turn (the spec's The runtime › Turns, Faults). Its order is
// fixed: parse; the consent pass; the effect pass, actor first and then
// roles in declared order; the queue, breadth-first in insertion order;
// what the engine answers (`engine-verbs.ts`); then the views of everyone
// present are marked stale, as every write turn that commits marks them.
// The one who typed the command is always told something: the parser's
// answer, the consent pass's refusal, what the effect pass said, what
// the engine answered or the world's `nothing_happens`, or, when the turn
// faults and is abandoned, the world's `fault`. What it says is one
// sequence of effects in that order: the effect pass's lines, then the
// queue's, then the engine's answers (`effects.ts`).
//
// Reading typed words is the parser's, reached through `Parser`, which
// `parser.ts` fills: the turn hands it the words, who typed them, each
// visitor's nickname and the turn's state, meter and draws, and it gives back
// the reading they make, or a line said to the actor in place of one, as
// an unknown word or a `which` is answered.

import { displace, type Displaced } from './arrival.js';
import type { Budget } from './budget.js';
import { drain, type Drained } from './bus.js';
import type { Draw } from './draws.js';
import { engineAnswers } from './engine-verbs.js';
import type { Catalogue } from './catalogue.js';
import { saidLines, type Effect, type Unrendered } from './effects.js';
import { faultTold, stockFaultEffect } from './faults.js';
import type { InstanceId, VisitKey } from './ids.js';
import { standsInPlace } from './live.js';
import type { Choice } from './parser/answers.js';
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
}

/**
 * What the words typed make: a reading `actor` performs, or a line said
 * to them in place of one, with, for a `which`, the line to type again
 * for each candidate.
 */
export type Parsed =
  { readonly reading: Reading } | { readonly answered: Said; readonly choices: readonly Choice[] };

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
}

/**
 * What a committed command turn did. A visitor standing in a place that
 * is gone is displaced instead, and what they typed is not read, since it
 * was typed about where they no longer are (the spec's What absent means).
 */
export type Commanded =
  | { readonly answered: Said; readonly choices: readonly Choice[] }
  | { readonly refused: PermitRefusal }
  | {
      readonly acted: Acted;
      readonly drained: Drained;
      /** What the engine answered once the queue was empty: each arrival read, then the command's own. */
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
      const parsed = host.parse(command.text, actor, {
        state: draft,
        catalogue,
        passes,
        budget,
        draws,
        nicknames,
      });
      if ('answered' in parsed) {
        if (!parsed.answered.to.includes(actor)) {
          throw new Error(
            `the parser answered \`${command.text}\` to someone other than \`${actor}\`.`,
          );
        }
        return { answered: parsed.answered, choices: parsed.choices };
      }
      const { reading } = parsed;
      if (reading.actor !== actor) {
        throw new Error(
          `\`${command.text}\` was read as \`${reading.actor}\`'s, not \`${actor}\`'s.`,
        );
      }
      const outcome = runReading(reading, turn);
      if ('refused' in outcome) return outcome;
      const drained = drain(outcome, turn);
      const answers = engineAnswers(reading, [...outcome.notices, ...drained.notices], {
        state: turnState(draft),
        catalogue,
        passes,
        budget,
        nicknames,
      });
      return { acted: outcome, drained, answers };
    },
    (done) => ({ actor, lines: linesSaidBy(done, actor) }),
  );
  if (written.committed) return written;
  return { ...written, ...faultEffects(state, host, command, actor) };
}

/** What a committed command said, in the order it said it. */
function linesSaidBy(done: Commanded, actor: InstanceId): Unrendered[] {
  if ('answered' in done) return [{ said: done.answered }];
  if ('refused' in done) {
    const { by, said, bindings } = done.refused;
    return [{ said: { effect: 'refused', to: [actor], by, speaker: null, said, bindings } }];
  }
  if ('displaced' in done) return displacedLines(done.displaced);
  return [...saidLines(done.acted.said), ...saidLines(done.drained.said), ...done.answers];
}

/** What a displaced visitor is told and what the entry says, in order, then the place they came in to. */
function displacedLines(displaced: Displaced): Unrendered[] {
  const { told, entry, drained, answers } = displaced;
  if ('closed' in entry) return [{ said: told }];
  if ('refused' in entry) return [{ said: told }, { said: entry.refused }];
  return [{ said: told }, ...saidLines(entry.said), ...saidLines(drained?.said ?? []), ...answers];
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
