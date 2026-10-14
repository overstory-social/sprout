import type { InstanceId } from '@overstory/sprout/lang';

// What a typed line would make, read and never run (the spec's Parsing;
// Verbs › The two passes; Parsing › Intents): each command the line holds,
// read against the world as it stands as the command turn it would begin
// reads it, under that turn's budget and drawing as a turn seeded 0 draws,
// and taken as far as the turn would take it before anything runs: a
// reading's consent pass, or the steps an intent plans now. The engine
// reads it (`Engine.parse`).

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
