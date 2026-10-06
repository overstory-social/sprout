import { z } from 'zod';

import {
  DIRECTIONS,
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
// draw, as a warning. A turn that ran a step the line's first turn
// planned, an intent's or a thing of `all` or of a run, keeps that step's
// reading, since the step is not the line read again (the spec's Parsing ›
// Intents; Sequences, again and all), and an item of a run read afresh
// keeps its role and words beside it. One that
// faulted keeps its fault and the one effect it has, the world's `fault`
// told to the one who typed; nothing else of it is logged.

/** What a planned step's role holds: a thing, a set, a value, or a way out. */
const LoggedBound = z.union([
  z.object({ object: z.string().min(1) }),
  z.object({ set: z.array(z.string().min(1)) }),
  z.object({ value: z.union([z.string(), z.number().int()]) }),
  z.object({
    exit: z.object({
      direction: z.enum(DIRECTIONS).nullable(),
      label: z.string(),
      to: z.string().min(1),
    }),
  }),
]);

/** A planned step, as the log keeps it: its verb by library and name, who performs it, and what fills each role. */
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
  /** The item of a run whose words the turn read afresh, the role it fills and the words; null for every other. */
  reread: z
    .object({ role: z.string().min(1), words: z.string() })
    .nullable()
    .default(null),
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
    reread: command.reread ?? null,
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

/** A planned step as the log keeps it; a value is only ever a symbol's option or an integer. */
function loggedReading(reading: Reading): LoggedReading {
  const bindings = [...reading.bindings].map(
    ([role, bound]): [string, z.infer<typeof LoggedBound>] => {
      if ('object' in bound) return [role, { object: bound.object }];
      if ('set' in bound) return [role, { set: [...bound.set] }];
      if ('exit' in bound) return [role, { exit: { ...bound.exit } }];
      if (typeof bound.value === 'string' || typeof bound.value === 'number') {
        return [role, { value: bound.value }];
      }
      throw new Error(`a planned step binds \`${role}\` to a value no role takes.`);
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
  const reread = entry.reread === null ? {} : { reread: entry.reread };
  const { verb: named, actor, bindings } = entry.planned;
  const verb = catalogue.verbs.qualified(named.library, named.name);
  if (verb === null) throw new Error(`\`${named.library}.${named.name}\` is not declared here.`);
  const world = catalogue.world;
  const planned: Reading = {
    verb,
    actor: storedId(world, actor),
    bindings: new Map(
      bindings.map(([role, bound]): [string, Bound] => {
        if ('object' in bound) return [role, { object: storedId(world, bound.object) }];
        if ('set' in bound) return [role, { set: bound.set.map((id) => storedId(world, id)) }];
        if ('exit' in bound)
          return [role, { exit: { ...bound.exit, to: storedId(world, bound.exit.to) } }];
        return [role, { value: bound.value }];
      }),
    ),
  };
  return { ...command, planned, ...reread };
}
