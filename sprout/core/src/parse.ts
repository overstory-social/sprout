import {
  consentPass,
  Draws,
  nicknamesIn,
  objectWords,
  partsOf,
  planIntent,
  pollTurn,
  renderFor,
  type Bound,
  type CommandHost,
  type InstanceId,
  type IntentReading,
  type Line,
  type PollTurn,
  type Reading,
  type RenderContext,
  type VisitKey,
  type WorldState,
} from '@overstory/sprout/lang';

// What a typed line would make, read and never run (the spec's Parsing;
// Verbs › The two passes; Parsing › Intents): each command the line holds,
// read against the world as it stands as the command turn it would begin
// reads it, under that turn's budget and drawing as a turn seeded 0 draws,
// and taken as far as the turn would take it before anything runs: a
// reading's consent pass, or the steps an intent plans now. What it gives
// is the same whichever engine reads it; `parsedLine` is the TypeScript
// runtime's reading, by the host's parser, and `Engine.parse` each
// engine's.

/** A thing a line names: its id, and the words the one who typed reads it by. */
export interface ParsedThing {
  readonly id: InstanceId;
  readonly name: string;
}

/** What fills one role: a thing, a set's things in typed order, a way out, or a value, a symbol role's marked so. */
export type ParsedFiller =
  | { readonly object: ParsedThing }
  | { readonly set: readonly ParsedThing[] }
  | {
      readonly exit: {
        readonly direction: string | null;
        readonly label: string;
        readonly to: InstanceId;
      };
    }
  | { readonly value: string | number; readonly symbol: boolean };

/** A verb's reading: the verb by qualified name, and every role it declares, in order, with what fills it or null. */
export interface ParsedReading {
  readonly verb: string;
  readonly roles: readonly { readonly name: string; readonly filler: ParsedFiller | null }[];
}

/** A reading drawn from several that tied: how many, and the engine's `meant` as the one who typed is told it, where it is said. */
export interface ParsedDraw {
  readonly among: number;
  readonly meant: readonly string[] | null;
}

/**
 * The consent pass's refusal: who refused and in which role, the kind whose
 * `permit` it was, and its words as the one who typed reads them. `by` and
 * `origin` are null where the engine refused a carried role.
 */
export interface ParsedRefusal {
  readonly by: ParsedThing | null;
  readonly role: string;
  readonly origin: string | null;
  readonly paragraphs: readonly string[];
}

/** One command of a line, by its words, and what it came to. */
export type ParsedCommand = { readonly text: string } & (
  | { readonly faulted: { readonly name: string; readonly detail: string } }
  | {
      /** The line the world answers with, and the passage's name where a passage says it. */
      readonly answered: {
        readonly passage: string | null;
        readonly paragraphs: readonly string[];
      };
    }
  | {
      readonly reading: ParsedReading;
      readonly drawn: ParsedDraw | null;
      /** Null where every participant consents. */
      readonly refused: ParsedRefusal | null;
    }
  | {
      readonly intent: {
        readonly name: string;
        readonly slots: readonly { readonly name: string; readonly thing: ParsedThing | null }[];
      };
      readonly drawn: ParsedDraw | null;
      /** The steps it plans now, each a turn of its own; none where it would be answered `nothing_happens`. */
      readonly steps: readonly ParsedReading[];
    }
);

/** What reading one command needs to put what it found in words. */
interface Naming {
  readonly actor: InstanceId;
  readonly render: RenderContext;
}

const thing = (id: InstanceId, naming: Naming): ParsedThing => ({
  id,
  name: objectWords(id, naming.actor, naming.render),
});

const spoken = (line: Line, naming: Naming): string[] =>
  renderFor(line, naming.actor, naming.render);

function fillerOf(bound: Bound, symbol: boolean, naming: Naming): ParsedFiller {
  if ('object' in bound) return { object: thing(bound.object, naming) };
  if ('set' in bound) return { set: bound.set.map((id) => thing(id, naming)) };
  if ('exit' in bound) {
    const { direction, label, to } = bound.exit;
    return { exit: { direction, label, to } };
  }
  const { value } = bound;
  return { value: typeof value === 'number' ? value : String(value), symbol };
}

function readingOf(reading: Reading, naming: Naming): ParsedReading {
  const { verb } = reading;
  return {
    verb: `${verb.library}.${verb.name}`,
    roles: verb.roles.map((role) => {
      const bound = reading.bindings.get(role.name);
      return {
        name: role.name,
        filler:
          bound === undefined ? null : fillerOf(bound, role.filler?.fills === 'symbol', naming),
      };
    }),
  };
}

function intentOf(intended: IntentReading, naming: Naming) {
  const { intent } = intended;
  return {
    name: `${intent.library}.${intent.name}`,
    slots: intent.slots.map((slot) => {
      const bound = intended.bindings.get(slot);
      return {
        name: slot,
        thing: bound !== undefined && 'object' in bound ? thing(bound.object, naming) : null,
      };
    }),
  };
}

/** One command read inside its poll turn. */
function readCommand(
  text: string,
  visit: VisitKey,
  state: WorldState,
  host: CommandHost,
  turn: PollTurn,
): ParsedCommand {
  const { instance: actor, referents, lastReading } = state.visitors.get(visit)!;
  const nicknames = nicknamesIn(state);
  const naming: Naming = { actor, render: { ...turn, nicknames, draws: null, actor } };
  const parsed = host.parse(text, actor, {
    ...turn,
    draws: new Draws(0),
    nicknames,
    referents,
    lastReading,
  });
  if ('answered' in parsed) {
    const { said } = parsed.answered;
    return {
      text,
      answered: {
        passage: 'passage' in said ? said.passage.name : null,
        paragraphs: spoken(parsed.answered, naming),
      },
    };
  }
  const { drawn } = parsed;
  const draw: ParsedDraw | null =
    drawn === null
      ? null
      : { among: drawn.among, meant: drawn.meant === null ? null : spoken(drawn.meant, naming) };
  if ('intended' in parsed) {
    const intent = intentOf(parsed.intended, naming);
    const steps = planIntent(parsed.intended, turn).map((step) => readingOf(step, naming));
    return { text, intent, drawn: draw, steps };
  }
  const reading = readingOf(parsed.reading, naming);
  const refusal = consentPass(parsed.reading, turn);
  const refused: ParsedRefusal | null =
    refusal === null
      ? null
      : {
          by: refusal.origin === null ? null : thing(refusal.by, naming),
          role: refusal.role,
          origin: refusal.origin,
          paragraphs: spoken(refusal, naming),
        };
  return { text, reading, drawn: draw, refused };
}

/**
 * Every command of `line` as `visit` would have it read over `state`, each
 * in a poll charged as the command turn it stands in for: one that costs
 * more is said to fault, as its turn would. Nothing is written.
 */
export function parsedLine(
  state: WorldState,
  host: CommandHost,
  visit: VisitKey,
  line: string,
): ParsedCommand[] {
  const visitor = state.visitors.get(visit);
  if (visitor === undefined) throw new Error(`\`${visit}\` has never visited this world.`);
  if ((state.instances.get(visitor.instance)?.container ?? null) === null)
    throw new Error(`\`${visit}\` is not in this world, so cannot type in it.`);
  return partsOf(line).map((text) => {
    const polled = pollTurn(
      state,
      host,
      (turn) => readCommand(text, visit, state, host, turn),
      'command',
    );
    if (!polled.faulted) return polled.view;
    const { name, detail } = polled.fault;
    return { text, faulted: { name, detail } };
  });
}
