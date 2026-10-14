// A visitor's view, as an engine's poll gives it (the spec's The view;
// The runtime › Turns, Faults): rendered for the visitor as its one
// reader, what the place's description recorded of extensions beside its
// words. A poll reads the last committed state, draws nothing and writes
// nothing. A host may poll the view in parts: the scene, every part but
// the readings, with the verbs; and one verb's readings. A poll that
// faults gives its fault beside what it saw, for the host to log, the one
// thing of a poll the log holds; a view is valid until a committed write
// turn names its visitor stale.

import type { Direction } from '../declare/directions.js';
import type { Plain } from '../declare/extensions.js';
import type { Fault } from './faults.js';
import type { InstanceId, VisitKey } from './ids.js';

/** One exit or link that applies where the actor stands: its direction, null for a link, its label, and the place it leads to. */
export interface CommandExit {
  readonly direction: Direction | null;
  readonly label: string;
  readonly to: InstanceId;
}

/** A whole-number range, both ends included. */
export interface OptionRange {
  readonly min: number;
  readonly max: number;
}

/** Something in the view, by id, and as its reader reads it. */
export interface SeenThing {
  readonly id: InstanceId;
  /** Its article and name, or a visitor's nickname. */
  readonly name: string;
}

/** One option of a symbol role: the value it binds, and the words a visitor types for it. */
export interface SeenOption {
  readonly value: string;
  readonly words: string;
}

/** A value role's options, as a client offers them. */
export type SeenOptions =
  | { readonly role: string; readonly takes: 'symbol'; readonly options: readonly SeenOption[] }
  | { readonly role: string; readonly takes: 'integer'; readonly ranges: readonly OptionRange[] };

/**
 * What fills one role of a reading, as a client offers it: a thing, the
 * things a set role names, the way out `go` takes, or nothing, which is a
 * value role (its options are in the reading's `options`) or a tool left
 * out.
 */
export type SeenFiller =
  | {
      readonly role: string;
      readonly binds: 'object';
      readonly id: InstanceId;
      readonly name: string;
    }
  | {
      readonly role: string;
      readonly binds: 'set';
      readonly ids: readonly InstanceId[];
      readonly names: readonly string[];
    }
  | {
      readonly role: string;
      readonly binds: 'exit';
      readonly direction: Direction | null;
      readonly label: string;
      readonly to: InstanceId;
    }
  | { readonly role: string; readonly binds: 'unbound' };

/** One reading a visitor could make, as a client offers it. */
export interface SeenReading {
  /** The verb, by its qualified name: `sprout.take`. */
  readonly verb: string;
  /** The line that types it, each value role's slot written `…`. */
  readonly typed: string;
  /** The consent pass's refusal, rendered for the visitor; null where every participant consents. */
  readonly refused: readonly string[] | null;
  /** What fills each role, one per role in the order the verb declares them. */
  readonly fillers: readonly SeenFiller[];
  readonly options: readonly SeenOptions[];
}

/**
 * What an extension's statement in the place's description recorded into
 * the view: its payload for a client that can use it, and the transcript
 * line a text-only client shows instead.
 */
export interface SeenEffect {
  readonly extension: string;
  readonly statement: string;
  readonly payload: Plain;
  readonly transcript: string;
}

/** A verb a scene lists, and the phrases that type it, each slot written `…`: `put … in …`. */
export interface SeenVerb {
  /** By its qualified name: `sprout.take`. */
  readonly verb: string;
  readonly phrases: readonly string[];
}

/** What a view and a scene both hold, as their visitor reads them. */
export interface SeenPlace {
  /** The place's description, as paragraphs. */
  readonly description: readonly string[];
  /** What the description's extension statements recorded, in order. */
  readonly effects: readonly SeenEffect[];
  readonly exits: readonly CommandExit[];
  readonly occupants: readonly SeenThing[];
  readonly carried: readonly SeenThing[];
}

/** A view as its visitor reads it. */
export interface SeenView extends SeenPlace {
  readonly readings: readonly SeenReading[];
}

/** A scene as its visitor reads it: the view but its readings, and the verbs whose readings may be asked for. */
export interface SeenScene extends SeenPlace {
  readonly verbs: readonly SeenVerb[];
}

/** What a poll gives: the view, and the fault it raised, if it faulted. */
export interface PolledView {
  readonly visit: VisitKey;
  readonly view: SeenView;
  /** The authoring fault, against the object the poll was deriving when it ran out; null where the poll did not fault. */
  readonly fault: Fault | null;
}

/** What a scene's poll gives: the scene, and the fault it raised, if it faulted. */
export interface PolledScene {
  readonly visit: VisitKey;
  readonly scene: SeenScene;
  readonly fault: Fault | null;
}

/** What one verb's poll gives: its readings, none where it faulted, and the fault. */
export interface PolledReadings {
  readonly visit: VisitKey;
  /** By its qualified name. */
  readonly verb: string;
  readonly readings: readonly SeenReading[];
  readonly fault: Fault | null;
}
