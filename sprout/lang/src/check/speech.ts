// Where a passage is said from, as the checker meets it (the spec's Prose
// › Passages; Chance › Where chance is forbidden; The compiler › Two
// tiers: `chance` and `actor` reachability through passages). A passage
// may use the bindings of the body that invokes it, so it can only be
// checked against each place it is invoked from: a body records every
// `say` or `refuse` of a passage by name, with what was in scope there
// and whether it may draw, and every slot that renders another object's
// passage, and `passages.ts` checks each passage those reach once the
// bundle's bodies have all been read.

import type { KindRef } from '../declare/kinds.js';
import type { Node } from '../source/nodes.js';
import type { Span } from '../source/source.js';
import type { Scope } from './bindings.js';
import type { Undrawn } from './chance.js';

/** A statement in a body that names a passage of its own kind: `say taken`, `refuse full`. */
export interface PassageSaid {
  readonly name: string;
  /** The name as the statement wrote it. */
  readonly at: Span;
  /** What was in reach where it was said, `self` among it. */
  readonly scope: Scope;
  /** Why the body that said it draws nothing, where it decides; null where it acts. */
  readonly undrawn: Undrawn | null;
}

/** A slot rendering another object's passage: `{pot.greeting}`. */
export interface PassageRendered {
  readonly name: string;
  /** The passage's name as the slot wrote it. */
  readonly at: Span;
  /** The kind the slot's object is known to be: the passage is whichever its composer has. */
  readonly kind: KindRef;
  /** What the passage it renders is run with: `actor` and `here`, where they are bound where the slot is. */
  readonly scope: Scope;
  /** Why the prose the slot is in draws nothing, where it does not; null where it may draw. */
  readonly undrawn: Undrawn | null;
}

/** What checking prose records: each slot rendering another object's passage, and each rendering an option. */
export interface ProseRecord {
  render(site: PassageRendered): void;
  option(slot: Node): void;
}

/**
 * Every place a passage is said from, as the bodies are checked: by the
 * declaration of the body that said it, so that each kind running that
 * body can find what it said, and every slot that renders another
 * object's passage, wherever it is.
 */
export class PassageSites implements ProseRecord {
  private readonly bySaying = new Map<Node, PassageSaid[]>();
  readonly rendered: PassageRendered[] = [];
  /** Every slot that renders an enum's option, which is humanised where a string is not. */
  readonly options = new Set<Node>();

  said(body: Node, site: PassageSaid): void {
    const sites = this.bySaying.get(body) ?? [];
    sites.push(site);
    this.bySaying.set(body, sites);
  }

  render(site: PassageRendered): void {
    this.rendered.push(site);
  }

  option(slot: Node): void {
    this.options.add(slot);
  }

  /** What a body said by name, in the order it said it. */
  of(body: Node): readonly PassageSaid[] {
    return this.bySaying.get(body) ?? [];
  }
}

/**
 * What a body's checking records its speech in, and what is told of a
 * passage its kind does not have because the `.prose` file that held it
 * is absent: true where it has been told, and the name is not refused.
 */
export interface SpeechSetting {
  readonly sites: PassageSites;
  /** The declaration whose body is being read: a play's, a guard's, a handler's. */
  readonly body: Node | null;
  readonly absent?: (self: KindRef, name: string, at: Span) => boolean;
}

/** What a setting carries for every body it checks, each of which names itself as `body`. */
export type SpeechBook = Omit<SpeechSetting, 'body'>;
