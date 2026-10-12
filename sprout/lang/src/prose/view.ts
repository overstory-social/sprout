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
// the one thing of a poll the log holds. A host may poll the view in
// parts (the spec's The view): the scene, every part but the readings,
// with the verbs, which faults as the view does; and one verb's readings,
// which give none where they fault. A view is valid until a committed
// write turn names its visitor stale.

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
import type { ResolvedVerb } from '../declare/verbs.js';
import {
  emptyViewParts,
  readingsOf,
  sceneOf,
  viewOf,
  type Placed,
  type Scene,
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

/** Who a poll is for, and how it renders for them. */
interface Looking {
  readonly visit: VisitKey;
  readonly actor: InstanceId;
  readonly place: InstanceId;
  readonly rendering: (turn: PollTurn) => RenderContext;
}

/**
 * Poll `visit`'s view over the committed `state`. The visitor must be in
 * the world; asking the view of one who is away, or who never came, is
 * the host's defect, thrown before the poll opens.
 */
export function pollView(state: WorldState, host: TurnHost, visit: VisitKey): PolledView {
  const looking = lookingOf(state, visit);
  const parts = emptyViewParts();
  const polled = pollTurn(state, host, (turn) => {
    const context = looking.rendering(turn);
    const displaced = displacedWords(looking.actor, context);
    if (displaced !== null) return { ...onlySaying(displaced), readings: [] };
    return renderView(viewOf(looking.actor, context, parts), context);
  });
  if (!polled.faulted) return { visit, view: polled.view, fault: null };
  const kept = pollTurn(state, host, (turn) => {
    const context = looking.rendering(turn);
    return {
      ...renderKept(parts, looking.actor, context),
      readings: parts.readings.map((reading) => seenReading(reading, looking.actor, context)),
    };
  });
  return {
    visit,
    view: {
      ...unseen(state, host, looking),
      ...(kept.faulted ? { ...emptyKept(), readings: [] } : kept.view),
    },
    fault: laid(polled.fault, looking),
  };
}

/**
 * Poll `visit`'s scene over the committed `state`: the view but its
 * readings, and the verbs whose readings `pollReadings` may be asked for.
 * It faults as the view does, and is asked of a visitor in the world.
 */
export function pollScene(state: WorldState, host: TurnHost, visit: VisitKey): PolledScene {
  const looking = lookingOf(state, visit);
  const parts = emptyViewParts();
  const polled = pollTurn(state, host, (turn) => {
    const context = looking.rendering(turn);
    const displaced = displacedWords(looking.actor, context);
    if (displaced !== null) return { ...onlySaying(displaced), verbs: [] };
    return renderScene(sceneOf(looking.actor, context, parts), context);
  });
  if (!polled.faulted) return { visit, scene: polled.view, fault: null };
  const kept = pollTurn(state, host, (turn) => {
    const context = looking.rendering(turn);
    return {
      ...renderKept(parts, looking.actor, context),
      verbs: parts.verbs.map((verb) => seenVerb(verb, context)),
    };
  });
  return {
    visit,
    scene: {
      ...unseen(state, host, looking),
      ...(kept.faulted ? { ...emptyKept(), verbs: [] } : kept.view),
    },
    fault: laid(polled.fault, looking),
  };
}

/**
 * Poll the readings of the verb named `verb`, by its qualified name, that
 * `visit` could make now, under a poll budget of their own; none where
 * the poll faults, or where the visitor's place is gone. A verb the world
 * does not type, like a visitor not in it, is the host's defect.
 */
export function pollReadings(
  state: WorldState,
  host: TurnHost,
  visit: VisitKey,
  verb: string,
): PolledReadings {
  const looking = lookingOf(state, visit);
  const resolved = host.catalogue.phrases.find(
    (phrase) => qualifiedName(phrase.verb.library, phrase.verb.name) === verb,
  )?.verb;
  if (resolved === undefined) throw new Error(`This world types no verb \`${verb}\`.`);
  const polled = pollTurn(state, host, (turn) => {
    const context = looking.rendering(turn);
    if (!standsInPlace(turn.state, looking.actor)) return [];
    return readingsOf(looking.actor, resolved, context).map((reading) =>
      seenReading(reading, looking.actor, context),
    );
  });
  return polled.faulted
    ? { visit, verb, readings: [], fault: laid(polled.fault, looking) }
    : { visit, verb, readings: polled.view, fault: null };
}

/** Who `visit` is and where they stand, which must be somewhere: the host's defect otherwise. */
function lookingOf(state: WorldState, visit: VisitKey): Looking {
  const committed = readerOf(state);
  const visitor = committed.visitor(visit);
  if (visitor === undefined) throw new Error(`\`${visit}\` has never visited this world.`);
  const actor = visitor.instance;
  const place = committed.instance(actor)?.container ?? null;
  if (place === null) throw new Error(`\`${visit}\` is not in this world, so has no view.`);
  const nicknames = nicknamesIn(state);
  return {
    visit,
    actor,
    place,
    rendering: (turn) => ({ ...turn, nicknames, draws: null, actor }),
  };
}

/**
 * What a visitor whose place is gone reads instead of a view: what their
 * next command will tell them, offered nothing until it has moved them;
 * null for one who stands in a place.
 */
function displacedWords(actor: InstanceId, context: RenderContext): readonly string[] | null {
  if (standsInPlace(context.state, actor)) return null;
  const displaced = renderFor(displacedLine(context.state, actor), actor, context);
  return displaced.length > 0 ? displaced : [STOCK_LINES.displaced];
}

/**
 * A faulted poll's description, the engine's `unseen`, found for the one
 * looking as every engine line is (`engine-lines.ts`), rendered under a
 * fresh budget of the poll's own, since the one that faulted can afford
 * nothing more (the spec's Faults).
 */
function unseen(
  state: WorldState,
  host: TurnHost,
  looking: Looking,
): Pick<SeenPlace, 'description' | 'effects'> {
  const { actor, place } = looking;
  const words = pollTurn(state, host, (turn) =>
    renderFor(
      { ...engineSaid(turn.state, 'unseen', actor, place), bindings: new Map() },
      actor,
      looking.rendering(turn),
    ),
  );
  return {
    description: !words.faulted && words.view.length > 0 ? words.view : [STOCK_LINES.unseen],
    effects: [],
  };
}

/** `fault`, laid against the visitor's place where it names no object of its own. */
function laid(fault: Fault, looking: Looking): Fault {
  return fault.engine || fault.object !== null ? fault : { ...fault, object: looking.place };
}

/** `id` as `actor` reads it: its article and name, or a visitor's nickname. */
function seenThing(id: InstanceId, actor: InstanceId, context: RenderContext): SeenThing {
  return { id, name: objectWords(id, actor, context) };
}

/** `view` as its visitor reads it, rendered with no draws. */
export function renderView(view: View, context: RenderContext): SeenView {
  const { actor } = view;
  return {
    ...renderPlaced(view, context),
    readings: view.readings.map((reading) => seenReading(reading, actor, context)),
  };
}

/** `scene` as its visitor reads it, rendered with no draws. */
export function renderScene(scene: Scene, context: RenderContext): SeenScene {
  return {
    ...renderPlaced(scene, context),
    verbs: scene.verbs.map((verb) => seenVerb(verb, context)),
  };
}

function renderPlaced(placed: Placed, context: RenderContext): SeenPlace {
  const { actor } = placed;
  return {
    description: renderDescription(placed.description, context).paragraphs,
    effects: placed.description.recorded.flatMap((line) => seenEffect(line, actor, context)),
    exits: placed.exits,
    occupants: placed.occupants.map((id) => seenThing(id, actor, context)),
    carried: placed.carried.map((id) => seenThing(id, actor, context)),
  };
}

/** What a faulted poll's `parts` render into but its readings or verbs, its description left to the caller (the spec's Faults). */
type Kept = Pick<SeenPlace, 'exits' | 'occupants' | 'carried'>;

/** `parts`, whatever a faulted poll derived before it faulted, as its visitor reads them. */
function renderKept(parts: ViewParts, actor: InstanceId, context: RenderContext): Kept {
  return {
    exits: parts.exits,
    occupants: parts.occupants.map((id) => seenThing(id, actor, context)),
    carried: parts.carried.map((id) => seenThing(id, actor, context)),
  };
}

/** Nothing kept: `parts` rendered under a fresh budget faulted too. */
function emptyKept(): Kept {
  return { exits: [], occupants: [], carried: [] };
}

/** `verb` with the phrases a visitor types it by, each once, in the order the parser tries them. */
function seenVerb(verb: ResolvedVerb, context: RenderContext): SeenVerb {
  const phrases = context.catalogue.phrases
    .filter((phrase) => phrase.verb === verb && phrase.only === null)
    .map((phrase) =>
      phrase.parts.map((part) => ('slot' in part ? '…' : part.words.join(' '))).join(' '),
    );
  return { verb: qualifiedName(verb.library, verb.name), phrases: [...new Set(phrases)] };
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

/** A place that says `description` and holds nothing else. */
function onlySaying(description: readonly string[]): SeenPlace {
  return { description, effects: [], exits: [], occupants: [], carried: [] };
}
