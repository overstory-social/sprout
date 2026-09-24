// A visitor's view, polled and rendered for them (the spec's The runtime
// › Turns, The view, Faults). A poll reads the last committed state with
// no lock, under the poll's own step budget, draws nothing and writes
// nothing; what it derives (`runtime/view.ts`) is rendered here with the
// visitor as its one reader, what the place's description records of
// extensions beside its words (the spec's Extensions › What an extension
// may add). A poll that faults yields a view whose
// description is the world's `unseen` and which offers nothing else, its
// fault laid against the place whose description the poll was deriving
// where the fault names no object of its own, and given back beside the
// view for the host to log, the one thing of a poll the log holds. A view
// is valid until a committed write turn names its visitor stale.

import { humanisedOption, qualifiedName } from '../declare/enums.js';
import type { Plain } from '../declare/extensions.js';
import type { Said } from '../runtime/reading.js';
import { DISPLACED_STOCK, displacedLine } from '../runtime/arrival.js';
import { stockLine, type Fault } from '../runtime/faults.js';
import type { InstanceId, VisitKey } from '../runtime/ids.js';
import { standsInPlace } from '../runtime/live.js';
import type { OptionRange, RoleOptions } from '../runtime/options.js';
import type { CommandExit } from '../runtime/parser/exits.js';
import { nicknamesIn, readerOf, type WorldState } from '../runtime/state.js';
import { pollTurn, type PollTurn, type TurnHost } from '../runtime/turn.js';
import { viewOf, type View, type ViewReading } from '../runtime/view.js';
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

/** One reading a visitor could make, as a client offers it. */
export interface SeenReading {
  /** The verb, by its qualified name: `sprout.take`. */
  readonly verb: string;
  /** The line that types it, each value role's slot written `…`. */
  readonly typed: string;
  /** The consent pass's refusal, rendered for the visitor; null where every participant consents. */
  readonly refused: readonly string[] | null;
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
  /** The authoring fault, against the object whose description cost too much; null where the poll did not fault. */
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

  const polled = pollTurn(state, host, (turn) => {
    const context = rendering(turn);
    // A visitor whose place is gone reads what their next command will
    // tell them, and is offered nothing until it has moved them.
    if (!standsInPlace(turn.state, actor)) {
      const displaced = renderFor(displacedLine(turn.state, actor), actor, context);
      return onlySaying(displaced.length > 0 ? displaced : [DISPLACED_STOCK]);
    }
    return renderView(viewOf(actor, context), context);
  });
  if (!polled.faulted) return { visit, view: polled.view, fault: null };

  const unseen = pollTurn(state, host, (turn) =>
    renderFor(
      { by: state.world, said: polled.unseen, bindings: new Map() },
      actor,
      rendering(turn),
    ),
  );
  const { fault } = polled;
  return {
    visit,
    view: onlySaying(
      !unseen.faulted && unseen.view.length > 0 ? unseen.view : [stockLine('unseen')],
    ),
    fault: fault.engine || fault.object !== null ? fault : { ...fault, object: place },
  };
}

/** `view` as its visitor reads it, rendered with no draws. */
export function renderView(view: View, context: RenderContext): SeenView {
  const { actor } = view;
  const named = (id: InstanceId): SeenThing => ({ id, name: objectWords(id, actor, context) });
  return {
    description: renderDescription(view.description, context).paragraphs,
    effects: view.description.recorded.flatMap((line) => seenEffect(line, actor, context)),
    exits: view.exits,
    occupants: view.occupants.map(named),
    carried: view.carried.map(named),
    readings: view.readings.map((reading) => seenReading(reading, actor, context)),
  };
}

function seenReading(reading: ViewReading, actor: InstanceId, context: RenderContext): SeenReading {
  const { verb } = reading.reading;
  return {
    verb: qualifiedName(verb.library, verb.name),
    typed: reading.typed,
    refused: reading.refused === null ? null : renderFor(reading.refused, actor, context),
    options: reading.options.map(seenOptions),
  };
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
