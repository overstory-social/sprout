import { z } from 'zod';

import {
  storedId,
  visitKey,
  type Bound,
  type Catalogue,
  type Command,
  type CommandTurn,
  type Reading,
  type TurnHost,
} from '@overstory/sprout/lang';

import {
  inputsOf,
  LoggedCut,
  LoggedEffect,
  loggedCuts,
  LoggedFault,
  loggedEffects,
  loggedFault,
  TurnInputs,
  writeInputsOf,
} from './parts.js';

// A command in the log (the spec's The runtime › The log, Faults; Parsing
// › Choosing a reading): who typed it, the words, the turn's inputs, what
// it said, and, where its reading was drawn from several that tied, the
// draw, as a warning. A turn that ran a step an intent planned keeps that
// step's reading, since the step is not the line read again but what the
// line's first turn planned (the spec's Parsing › Intents). One that
// faulted keeps its fault and the one effect it has, the world's `fault`
// told to the one who typed; nothing else of it is logged.

/** A thing a planned step's role holds: one, or a set. */
const LoggedBound = z.union([
  z.object({ object: z.string().min(1) }),
  z.object({ set: z.array(z.string().min(1)) }),
]);

/** A step an intent planned, as the log keeps it: its verb by library and name, who performs it, and what fills each role. */
export const LoggedReading = z.object({
  verb: z.object({ library: z.string().min(1), name: z.string().min(1) }),
  actor: z.string().min(1),
  bindings: z.array(z.tuple([z.string().min(1), LoggedBound])),
});
export type LoggedReading = z.infer<typeof LoggedReading>;

export const CommandEntry = TurnInputs.extend({
  kind: z.literal('command'),
  level: z.literal('info'),
  visit: z.string().min(1),
  text: z.string(),
  /** The step an earlier turn of the line planned, run in place of reading `text`; null for a line read. */
  planned: LoggedReading.nullable(),
  /** Null where the turn committed. */
  fault: LoggedFault.nullable(),
  effects: z.array(LoggedEffect),
  /** The reading was drawn from this many that tied; null where it stood alone, or none was read. */
  drawn: z.object({ level: z.literal('warning'), among: z.number().int().min(2) }).nullable(),
  /** Who a line would have taken past their output, each a warning. */
  cutShort: z.array(LoggedCut),
});
export type CommandEntry = z.infer<typeof CommandEntry>;

/** What the log keeps of `command`, run by `host` as `turn`. */
export function commandEntry(command: Command, host: TurnHost, turn: CommandTurn): CommandEntry {
  return {
    kind: 'command',
    level: 'info',
    ...inputsOf(command, host),
    visit: command.visit,
    text: command.text,
    planned: command.planned === undefined ? null : loggedReading(command.planned),
    fault: turn.committed ? null : loggedFault(turn.fault),
    effects: loggedEffects(turn.effects),
    drawn: drawnOf(turn),
    cutShort: turn.committed ? loggedCuts(turn.cutShort) : [],
  };
}

/** The draw a committed turn's reading was, as the log keeps it. */
function drawnOf(turn: CommandTurn): CommandEntry['drawn'] {
  if (!turn.committed || !('drawn' in turn.value) || turn.value.drawn === null) return null;
  return { level: 'warning', among: turn.value.drawn.among };
}

/** A planned step as the log keeps it; a step holds things, never a value or an exit. */
function loggedReading(reading: Reading): LoggedReading {
  const bindings = [...reading.bindings].map(
    ([role, bound]): [string, z.infer<typeof LoggedBound>] => {
      if ('object' in bound) return [role, { object: bound.object }];
      if ('set' in bound) return [role, { set: [...bound.set] }];
      throw new Error(`a planned step binds \`${role}\` to what is not a thing.`);
    },
  );
  return {
    verb: { library: reading.verb.library, name: reading.verb.name },
    actor: reading.actor,
    bindings,
  };
}

/**
 * The command `entry` records, as the host handed it over, a planned step
 * read against `catalogue`; thrown where its verb is no longer declared.
 */
export function commandOf(entry: CommandEntry, catalogue: Catalogue): Command {
  const command = { ...writeInputsOf(entry), visit: visitKey(entry.visit), text: entry.text };
  if (entry.planned === null) return command;
  const { verb: named, actor, bindings } = entry.planned;
  const verb = catalogue.verbs.qualified(named.library, named.name);
  if (verb === null) throw new Error(`\`${named.library}.${named.name}\` is not declared here.`);
  const world = catalogue.world;
  const planned: Reading = {
    verb,
    actor: storedId(world, actor),
    bindings: new Map(
      bindings.map(([role, bound]): [string, Bound] =>
        'object' in bound
          ? [role, { object: storedId(world, bound.object) }]
          : [role, { set: bound.set.map((id) => storedId(world, id)) }],
      ),
    ),
  };
  return { ...command, planned };
}
