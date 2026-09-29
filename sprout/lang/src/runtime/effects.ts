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

import type { Plain } from '../declare/extensions.js';
import type { Budget } from './budget.js';
import type { Catalogue } from './catalogue.js';
import type { Description } from './describe.js';
import type { Draws } from './draws.js';
import { boundObject, boundValue, type Evaluated } from './evaluate.js';
import type { InstanceId, VisitKey } from './ids.js';
import type { Notice } from './move.js';
import type { PassRule } from './range.js';
import type { Said } from './reading.js';
import type { StateReader } from './state.js';

/**
 * The spec's effect kinds: a line from `say`, from `tell`, a refusal, a
 * description, the engine speaking, or what an extension's statement
 * recorded.
 */
export type EffectKind = Said['effect'];

/** One effect one person reads: a line the turn said, or an extension's effect. */
export type Effect = ProseEffect | ExtensionEffect;

/** One line one person reads, as a turn said it. */
export interface ProseEffect extends EffectParts {
  readonly kind: Exclude<EffectKind, 'extension'>;
}

/**
 * What an extension's statement recorded, for one reader: the payload a
 * client that can use it is sent, and, as its words, the transcript line
 * a text-only client shows instead (the spec's Extensions › Effects are
 * additive).
 */
export interface ExtensionEffect extends EffectParts {
  readonly kind: 'extension';
  readonly extension: string;
  readonly statement: string;
  readonly payload: Plain;
}

/**
 * Where the words of an effect were written: a named passage, by the kind
 * that wrote it and its name, or a one-line passage, a string given to
 * `say`, `tell`, `text` or `refuse`, by where it stands. `at` and `line`
 * read `kiln.sprout:23:9`. For an author's tools, which ask what a
 * playthrough read; a client is never sent it.
 */
export type WrittenAt =
  | { readonly passage: string; readonly origin: string; readonly at: string }
  | { readonly line: string };

/** What every effect carries. */
interface EffectParts {
  /** The object it came from: whose body said it, the party that refused, the thing described, or the world. */
  readonly from: InstanceId;
  /** Whose turn said it: the visitor who typed, arrived or left; null in a tick or a wake. */
  readonly actor: InstanceId | null;
  /** Who reads it, a person, and the visit that is them. */
  readonly to: InstanceId;
  readonly visit: VisitKey;
  /** The words, rendered for this reader, one string to a paragraph. */
  readonly paragraphs: readonly string[];
  /** Every passage and one-line passage that gave them words, each once, a passage after any it holds. */
  readonly written: readonly WrittenAt[];
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
 * What is said of an actor leaving or entering a place, as the engine's
 * `leaves` and `arrives` to the visitors in its range, in order; the description the
 * one who moved reads is the engine's answer, derived once the queue is
 * empty, and is not among them. A notice nobody is in range to read is
 * not a line.
 */
export function noticeLines(notices: readonly Notice[]): Said[] {
  const lines: Said[] = [];
  for (const notice of notices) {
    if (notice.notice === 'described' || notice.audience.length === 0) continue;
    const { item, from, to, way } = notice.bindings;
    const bindings = new Map<string, Evaluated>([['item', boundObject(item)]]);
    if (from !== undefined) bindings.set('from', boundObject(from));
    if (to !== undefined) bindings.set('to', boundObject(to));
    if (way !== undefined) bindings.set('way', boundValue(way));
    lines.push({
      effect: 'notice',
      to: notice.audience,
      by: notice.by,
      speaker: null,
      said: notice.said,
      bindings,
    });
  }
  return lines;
}

/** The effects `visit` reads, in the order the turn said them. */
export function effectsTo(effects: readonly Effect[], visit: VisitKey): Effect[] {
  return effects.filter((effect) => effect.visit === visit);
}
