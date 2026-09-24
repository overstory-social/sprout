import {
  effectsTo,
  type Effect,
  type EffectKind,
  type InstanceId,
  type Plain,
  type SeenView,
  type VisitKey,
} from '@overstory/sprout/lang';

import { rendersPayload, type ClientCapabilities } from './capabilities.js';

// What one client is sent of a turn's effects and of a view (the spec's
// Extensions › Effects are additive; The runtime › Effects): each effect
// to its visit, in the order the turn said them, by its kind. A prose
// effect is sent as its words; an extension's effect is sent as its
// payload where the client was granted its statement, and as its
// transcript line where it was not, so every effect reaches every client
// as something it can show. Nothing here reaches the world.

/** An effect sent as words: a prose effect, or an extension's by its transcript line. */
export interface WordsDelivery {
  readonly kind: EffectKind;
  readonly as: 'words';
  /** The extension and statement that recorded it; null for a prose effect. */
  readonly recorded: { readonly extension: string; readonly statement: string } | null;
  readonly from: InstanceId;
  readonly actor: InstanceId | null;
  readonly to: InstanceId;
  /** The words, rendered for this reader, one string to a paragraph. */
  readonly paragraphs: readonly string[];
}

/** An extension's effect sent as its payload, to a client granted its statement. */
export interface PayloadDelivery {
  readonly kind: 'extension';
  readonly as: 'payload';
  readonly recorded: { readonly extension: string; readonly statement: string };
  readonly from: InstanceId;
  readonly actor: InstanceId | null;
  readonly to: InstanceId;
  readonly payload: Plain;
}

/** One effect as one client is sent it. */
export type Delivery = WordsDelivery | PayloadDelivery;

/** The effects `visit` reads, in order, as a client with `capabilities` is sent them. */
export function deliver(
  effects: readonly Effect[],
  visit: VisitKey,
  capabilities: ClientCapabilities,
): Delivery[] {
  return effectsTo(effects, visit).map((effect) => deliveryOf(effect, capabilities));
}

/** The effects `visit` reads, in order, all as words, as a text-only client is sent them. */
export function deliverWords(effects: readonly Effect[], visit: VisitKey): WordsDelivery[] {
  return effectsTo(effects, visit).map(wordsOf);
}

/** `effect` as a client with `capabilities` is sent it. */
export function deliveryOf(effect: Effect, capabilities: ClientCapabilities): Delivery {
  if (effect.kind !== 'extension') return wordsOf(effect);
  const { extension, statement, payload, from, actor, to } = effect;
  if (!rendersPayload(capabilities, extension, statement)) return wordsOf(effect);
  return {
    kind: 'extension',
    as: 'payload',
    recorded: { extension, statement },
    from,
    actor,
    to,
    payload,
  };
}

function wordsOf(effect: Effect): WordsDelivery {
  const { kind, from, actor, to, paragraphs } = effect;
  const recorded =
    effect.kind === 'extension'
      ? { extension: effect.extension, statement: effect.statement }
      : null;
  return { kind, as: 'words', recorded, from, actor, to, paragraphs };
}

/** What a view's description recorded, as one client is sent it: its payload, or its transcript line. */
export type SentViewEffect =
  | {
      readonly extension: string;
      readonly statement: string;
      readonly as: 'payload';
      readonly payload: Plain;
    }
  | {
      readonly extension: string;
      readonly statement: string;
      readonly as: 'words';
      readonly transcript: string;
    };

/** A view as one client is sent it: everything the view holds, its recorded effects negotiated as a turn's are. */
export interface SentView extends Omit<SeenView, 'effects'> {
  readonly effects: readonly SentViewEffect[];
}

/** `view` as a client with `capabilities` is sent it. */
export function sendView(view: SeenView, capabilities: ClientCapabilities): SentView {
  return {
    ...view,
    effects: view.effects.map(({ extension, statement, payload, transcript }): SentViewEffect =>
      rendersPayload(capabilities, extension, statement)
        ? { extension, statement, as: 'payload', payload }
        : { extension, statement, as: 'words', transcript },
    ),
  };
}
