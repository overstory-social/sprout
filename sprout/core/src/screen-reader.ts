import type { EffectKind } from '@overstory/sprout/lang';

import type { WordsDelivery } from './delivery.js';

// A client that speaks (the spec's The runtime › Effects): what a screen
// reader announces of a turn, and how urgently, decided by each effect's
// kind alone. It declares no capability, so it is sent every effect as
// words, an extension's as its transcript line, and announces every one
// in the order the turn said them: nothing a visitor is sent goes
// unspoken. A refusal interrupts, since the consent pass's refusal is the
// only thing its turn says and interrupting loses nothing of that turn;
// everything else waits its turn behind what is being spoken, so a turn
// that says several things is heard whole and in order.

/** How urgently an announcement is spoken, as a live region's politeness: `assertive` interrupts, `polite` queues. */
export type Urgency = 'assertive' | 'polite';

/** One thing a screen reader speaks. */
export interface Announcement {
  readonly kind: EffectKind;
  readonly urgency: Urgency;
  /** The words, one paragraph to a line. */
  readonly text: string;
}

/** How urgently each kind of effect is announced. */
export const URGENCY: Readonly<Record<EffectKind, Urgency>> = {
  refused: 'assertive',
  said: 'polite',
  told: 'polite',
  described: 'polite',
  notice: 'polite',
  extension: 'polite',
};

/** What a screen reader speaks of `deliveries`, one announcement to an effect, in order. */
export function announce(deliveries: readonly WordsDelivery[]): Announcement[] {
  return deliveries.map(({ kind, paragraphs }) => ({
    kind,
    urgency: URGENCY[kind],
    text: paragraphs.join('\n'),
  }));
}
