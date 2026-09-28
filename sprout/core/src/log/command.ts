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

// A command in the log (the spec's The runtime › The log, Faults): who
// typed it, the words, the turn's inputs, and what it said. One that
// faulted keeps its fault and the one effect it has, the world's `fault`
// told to the one who typed; nothing else of it is logged.

export const CommandEntry = TurnInputs.extend({
  kind: z.literal('command'),
  level: z.literal('info'),
  visit: z.string().min(1),
  text: z.string(),
  /** Null where the turn committed. */
  fault: LoggedFault.nullable(),
  effects: z.array(LoggedEffect),
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
    cutShort: turn.committed ? loggedCuts(turn.cutShort) : [],
  };
}

/** The command `entry` records, as the host handed it over. */
export function commandOf(entry: CommandEntry): Command {
  return { ...writeInputsOf(entry), visit: visitKey(entry.visit), text: entry.text };
}
