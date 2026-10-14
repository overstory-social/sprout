// A turn's effects, as an engine gives them (the spec's The runtime ›
// Effects): one for each reader of each line the turn said, in the order
// it was said, a line's readers in the order the line names them, each
// with its words rendered for that reader, since words are true when they
// are said. What an extension's statement recorded is an effect too, its
// payload beside its transcript line.

import type { Plain } from '../declare/extensions.js';
import type { InstanceId, VisitKey } from './ids.js';

/**
 * The spec's effect kinds: a line from `say`, from `tell`, a refusal, a
 * description, the engine speaking, or what an extension's statement
 * recorded.
 */
export type EffectKind = 'said' | 'told' | 'refused' | 'described' | 'notice' | 'extension';

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

/** The effects `visit` reads, in the order the turn said them. */
export function effectsTo(effects: readonly Effect[], visit: VisitKey): Effect[] {
  return effects.filter((effect) => effect.visit === visit);
}
