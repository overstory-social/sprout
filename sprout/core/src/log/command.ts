import { z } from 'zod';

import { visitKey, type Command, type CommandTurn, type TurnHost } from '@overstory/sprout/lang';

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
// draw, as a warning. One that faulted keeps its fault and the one effect
// it has, the world's `fault` told to the one who typed; nothing else of
// it is logged.

export const CommandEntry = TurnInputs.extend({
  kind: z.literal('command'),
  level: z.literal('info'),
  visit: z.string().min(1),
  text: z.string(),
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

/** The command `entry` records, as the host handed it over. */
export function commandOf(entry: CommandEntry): Command {
  return { ...writeInputsOf(entry), visit: visitKey(entry.visit), text: entry.text };
}
