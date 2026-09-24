// A turn's effects (the spec's The runtime › Effects; Other people ›
// What this costs; Limits › Runtime budgets: output per turn, per
// recipient). What a turn says is kept unrendered while it runs, each
// line with the names in scope where it was said, as one ordered list;
// once its work is done the list is rendered, one effect for each reader
// of each line, and that sequence is what the host is given and the log
// keeps. Each effect carries its rendered words, since words are true
// when they are said and a later move or nickname cannot re-render them.
//
// Two invariants. The order is the order things were said, and a line's
// readers follow one another in the order the line names them. And only
// a person reads: a line with no reader, as a handler's refused `move`
// is, is not rendered and is no effect. The words are `prose/`'s
// (`renderEffects`), which sits below the engine, so a host hands them in
// with the turn host as it hands in the parser.

import type { Budget } from './budget.js';
import type { Catalogue } from './catalogue.js';
import type { Description } from './describe.js';
import type { Draws } from './draws.js';
import { boundObject } from './evaluate.js';
import type { InstanceId, VisitKey } from './ids.js';
import type { Notice } from './move.js';
import type { PassRule } from './range.js';
import type { Said } from './reading.js';
import type { StateReader } from './state.js';

/** The spec's effect kinds: a line from `say`, from `tell`, a refusal, a description, or the engine speaking. */
export type EffectKind = Said['effect'];

/** One line one person reads, as a turn said it. */
export interface Effect {
  readonly kind: EffectKind;
  /** The object it came from: whose body said it, the party that refused, the thing described, or the world. */
  readonly from: InstanceId;
  /** Whose turn said it: the visitor who typed, arrived or left; null in a tick or a wake. */
  readonly actor: InstanceId | null;
  /** Who reads it, a person, and the visit that is them. */
  readonly to: InstanceId;
  readonly visit: VisitKey;
  /** The words, rendered for this reader, one string to a paragraph. */
  readonly paragraphs: readonly string[];
}

/** One thing a turn says, unrendered: a line, or a description for the one looking. */
export type Unrendered = { readonly said: Said } | { readonly description: Description };

/** What a turn says, and whose turn it is. */
export interface Speaking {
  readonly actor: InstanceId | null;
  readonly lines: readonly Unrendered[];
}

/** A turn that says nothing, as a maintenance turn's catch-up does not narrate (the spec's Absence). */
export const SILENT: Speaking = { actor: null, lines: [] };

/** What rendering a turn's effects reads: the turn's state, names, meter, stream of draws and whose turn it is. */
export interface EffectContext {
  readonly state: StateReader;
  readonly catalogue: Catalogue;
  readonly passes: PassRule<InstanceId>;
  /** The turn's own budget: every reader's words are charged to their output, and every step to the turn. */
  readonly budget: Budget;
  /** The turn's stream, after every draw its bodies made (the spec's The seed). */
  readonly draws: Draws;
  /** Each visitor's nickname and visit, by the instance that is them. */
  readonly nicknames: ReadonlyMap<InstanceId, string>;
  readonly visits: ReadonlyMap<InstanceId, VisitKey>;
  readonly actor: InstanceId | null;
}

/** How a turn's lines become effects, in order: `prose/`'s `renderEffects`. */
export type Renderer = (lines: readonly Unrendered[], context: EffectContext) => Effect[];

/** `said`, in order, as what a turn says. */
export function saidLines(said: readonly Said[]): Unrendered[] {
  return said.map((line) => ({ said: line }));
}

/**
 * What a place speaks of an actor leaving or entering it, as lines from
 * the place to the visitors in its range, in order; the description the
 * one who moved reads is the engine's answer, derived once the queue is
 * empty, and is not among them. A notice nobody is in range to read is
 * not a line.
 */
export function noticeLines(notices: readonly Notice[]): Said[] {
  const lines: Said[] = [];
  for (const notice of notices) {
    if (notice.notice === 'described' || notice.audience.length === 0) continue;
    lines.push({
      effect: 'notice',
      to: notice.audience,
      by: notice.place,
      speaker: null,
      said: { passage: notice.passage },
      bindings: new Map([['item', boundObject(notice.bindings.item)]]),
    });
  }
  return lines;
}

/** The effects `visit` reads, in the order the turn said them. */
export function effectsTo(effects: readonly Effect[], visit: VisitKey): Effect[] {
  return effects.filter((effect) => effect.visit === visit);
}
