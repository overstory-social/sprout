// A visitor's view, polled and rendered for them (the spec's The runtime
// › Turns, The view, Faults). A poll reads the last committed state with
// no lock, under the poll's own step budget, draws nothing and writes
// nothing; what it derives (`runtime/view.ts`) is rendered here with the
// visitor as its one reader, what the place's description records of
// extensions beside its words (the spec's Extensions › What an extension
// may add). A poll that faults yields a view whose description is the
// engine's `unseen` and whose every other part is whatever the poll
// derived before it faulted, rendered fresh since the budget that
// faulted can afford nothing more; its fault is laid against the place
// whose description the poll was deriving where the fault names no
// object of its own, and given back beside the view for the host to log,
// the one thing of a poll the log holds. A view is valid until a
// committed write turn names its visitor stale.

import type { Direction } from '../declare/directions.js';
import { humanisedOption, qualifiedName } from '../declare/enums.js';
import type { Plain } from '../declare/extensions.js';
import type { Bound, Said } from '../runtime/reading.js';
import { displacedLine } from '../runtime/arrival.js';
import { engineSaid, STOCK_LINES } from '../runtime/engine-lines.js';
import type { Fault } from '../runtime/faults.js';
import type { InstanceId, VisitKey } from '../runtime/ids.js';
import { standsInPlace } from '../runtime/live.js';
import type { OptionRange, RoleOptions } from '../runtime/options.js';
import type { CommandExit } from '../runtime/parser/exits.js';
import { nicknamesIn, readerOf, type WorldState } from '../runtime/state.js';
import { pollTurn, type PollTurn, type TurnHost } from '../runtime/turn.js';
import {
  emptyViewParts,
  viewOf,
  type View,
  type ViewParts,
  type ViewReading,
} from '../runtime/view.js';
import { renderDescription } from './describe.js';
import { objectWords } from './names.js';
import type { RenderContext } from './render.js';
import { renderFor } from './speech.js';

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

/** A view as its visitor reads it. */
export interface SeenView {
  /** The place's description, as paragraphs. */
  readonly description: readonly string[];
  /** What the description's extension statements recorded, in order. */
  readonly effects: readonly SeenEffect[];
  readonly exits: readonly CommandExit[];
  readonly occupants: readonly SeenThing[];
  readonly carried: readonly SeenThing[];
  readonly readings: readonly SeenReading[];
}

/** What a poll gives: the view, and the fault it raised, if it faulted. */
export interface PolledView {
  readonly visit: VisitKey;
  readonly view: SeenView;
  /** The authoring fault, against the object the poll was deriving when it ran out; null where the poll did not fault. */
  readonly fault: Fault | null;
}

/**
 * Poll `visit`'s view over the committed `state`. The visitor must be in
 * the world; asking the view of one who is away, or who never came, is
 * the host's defect, thrown before the poll opens.
 */
export function pollView(state: WorldState, host: TurnHost, visit: VisitKey): PolledView {
  const committed = readerOf(state);
  const visitor = committed.visitor(visit);
  if (visitor === undefined) throw new Error(`\`${visit}\` has never visited this world.`);
  const actor = visitor.instance;
  const place = committed.instance(actor)?.container ?? null;
  if (place === null) throw new Error(`\`${visit}\` is not in this world, so has no view.`);
  const nicknames = nicknamesIn(state);
  const rendering = (turn: PollTurn): RenderContext => ({
    ...turn,
    nicknames,
    draws: null,
    actor,
  });

  const parts = emptyViewParts();
  const polled = pollTurn(state, host, (turn) => {
    const context = rendering(turn);
    // A visitor whose place is gone reads what their next command will
    // tell them, and is offered nothing until it has moved them.
    if (!standsInPlace(turn.state, actor)) {
      const displaced = renderFor(displacedLine(turn.state, actor), actor, context);
      return onlySaying(displaced.length > 0 ? displaced : [STOCK_LINES.displaced]);
    }
    return renderView(viewOf(actor, context, parts), context);
  });
  if (!polled.faulted) return { visit, view: polled.view, fault: null };

  // The description is the engine's `unseen`, found for the one looking
  // as every engine line is (`engine-lines.ts`), and every other part
  // is whatever `parts` holds of what the poll derived before it faulted
  // (the spec's Faults); both render under a fresh budget of the poll's
  // own, since the one that faulted can afford nothing more.
  const unseen = pollTurn(state, host, (turn) =>
    renderFor(
      { ...engineSaid(turn.state, 'unseen', actor, place), bindings: new Map() },
      actor,
      rendering(turn),
    ),
  );
  const kept = pollTurn(state, host, (turn) => renderKept(parts, actor, rendering(turn)));
  const { fault } = polled;
  return {
    visit,
    view: {
      description: !unseen.faulted && unseen.view.length > 0 ? unseen.view : [STOCK_LINES.unseen],
      effects: [],
      ...(kept.faulted ? emptyKept() : kept.view),
    },
    fault: fault.engine || fault.object !== null ? fault : { ...fault, object: place },
  };
}

/** `id` as `actor` reads it: its article and name, or a visitor's nickname. */
function seenThing(id: InstanceId, actor: InstanceId, context: RenderContext): SeenThing {
  return { id, name: objectWords(id, actor, context) };
}

/** `view` as its visitor reads it, rendered with no draws. */
export function renderView(view: View, context: RenderContext): SeenView {
  const { actor } = view;
  return {
    description: renderDescription(view.description, context).paragraphs,
    effects: view.description.recorded.flatMap((line) => seenEffect(line, actor, context)),
    exits: view.exits,
    occupants: view.occupants.map((id) => seenThing(id, actor, context)),
    carried: view.carried.map((id) => seenThing(id, actor, context)),
    readings: view.readings.map((reading) => seenReading(reading, actor, context)),
  };
}

/** What a faulted poll's `parts` render into, its description left to the caller (the spec's Faults). */
type Kept = Pick<SeenView, 'exits' | 'occupants' | 'carried' | 'readings'>;

/** `parts`, whatever a faulted poll derived before it faulted, as its visitor reads them. */
function renderKept(parts: ViewParts, actor: InstanceId, context: RenderContext): Kept {
  return {
    exits: parts.exits,
    occupants: parts.occupants.map((id) => seenThing(id, actor, context)),
    carried: parts.carried.map((id) => seenThing(id, actor, context)),
    readings: parts.readings.map((reading) => seenReading(reading, actor, context)),
  };
}

/** Nothing kept: `parts` rendered under a fresh budget faulted too. */
function emptyKept(): Kept {
  return { exits: [], occupants: [], carried: [], readings: [] };
}

function seenReading(reading: ViewReading, actor: InstanceId, context: RenderContext): SeenReading {
  const { verb, bindings } = reading.reading;
  return {
    verb: qualifiedName(verb.library, verb.name),
    typed: reading.typed,
    refused: reading.refused === null ? null : renderFor(reading.refused, actor, context),
    fillers: verb.roles.map(({ name }) => seenFiller(name, bindings.get(name), actor, context)),
    options: reading.options.map(seenOptions),
  };
}

/** What fills the role `role`, `bound` being its binding in the reading, if any. */
function seenFiller(
  role: string,
  bound: Bound | undefined,
  actor: InstanceId,
  context: RenderContext,
): SeenFiller {
  if (bound === undefined) return { role, binds: 'unbound' };
  if ('object' in bound) {
    return { role, binds: 'object', ...seenThing(bound.object, actor, context) };
  }
  if ('set' in bound) {
    return {
      role,
      binds: 'set',
      ids: bound.set,
      names: bound.set.map((id) => objectWords(id, actor, context)),
    };
  }
  if ('exit' in bound) {
    const { direction, label, to } = bound.exit;
    return { role, binds: 'exit', direction, label, to };
  }
  return { role, binds: 'unbound' };
}

/** One recorded effect as the visitor is shown it, its transcript charged to what they may read; none where it does not fit. */
function seenEffect(line: Said, actor: InstanceId, context: RenderContext): SeenEffect[] {
  if (!('recorded' in line.said)) return [];
  const { extension, statement, payload } = line.said.recorded;
  const [transcript] = renderFor(line, actor, context);
  return transcript === undefined ? [] : [{ extension, statement, payload, transcript }];
}

function seenOptions(options: RoleOptions): SeenOptions {
  if (options.takes === 'integer') return options;
  return {
    role: options.role,
    takes: 'symbol',
    options: options.options.map((value) => ({ value, words: humanisedOption(value) })),
  };
}

/** A view that says `description` and offers nothing else. */
function onlySaying(description: readonly string[]): SeenView {
  return { description, effects: [], exits: [], occupants: [], carried: [], readings: [] };
}
