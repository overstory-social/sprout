// `connect`, run (the spec's Verbs › Links, for space that does not exist
// yet; Why this does not reopen stored references). A link is `self`'s,
// kept under its name, so connecting one writes only `self`, through the
// turn's draft; it names its destination by id, and nothing but the
// engine's traversal ever reads it back. Connecting a link already set
// replaces where it leads.

import type { Draft } from './draft.js';
import type { InstanceId } from './ids.js';
import { isLive } from './live.js';

/** Why a link could not be connected. */
export type ConnectFaultReason = 'no-link' | 'gone' | 'not-a-place';

/**
 * A `connect` the world cannot make: it runs on an instance without the
 * link it names, as a kind's handler does on an instance of a kind that
 * composes it, since links are not composed; or where it leads is not in
 * the world now, or holds no actors, which the checker could not tell of
 * a binding of the bare object type. Thrown, as `MoveFault` is, and
 * faults the turn (`faults.ts`); the detail names objects by id, for the
 * log and the host.
 */
export class ConnectFault extends Error {
  constructor(
    readonly reason: ConnectFaultReason,
    /** What it is about: the instance without the link, or where the link was to lead. */
    readonly object: InstanceId,
    detail: string,
  ) {
    super(detail);
    this.name = 'ConnectFault';
  }
}

/** `self`'s link `name` connected to `to`, written to the draft; a fault where `self` has no such link or `to` is not a live place. */
export function connectLink(draft: Draft, self: InstanceId, name: string, to: InstanceId): void {
  const instance = draft.instance(self);
  if (instance === undefined)
    throw new Error(`\`${self}\` connects a link, and is not an instance.`);
  if (!instance.kind.exits.some((way) => way.kind === 'link' && way.name === name)) {
    throw new ConnectFault(
      'no-link',
      self,
      `\`${self}\` has no link ${name}, so \`connect ${name}\` has nothing to connect.`,
    );
  }
  const place = draft.instance(to);
  if (place === undefined || !isLive(draft, to)) {
    throw new ConnectFault(
      'gone',
      to,
      `\`${to}\` is not in the world, so \`${self}\`'s link ${name} could not lead there.`,
    );
  }
  if (!place.kind.containsActors) {
    throw new ConnectFault(
      'not-a-place',
      to,
      `\`${to}\` holds no actors, so \`${self}\`'s link ${name} could not lead there.`,
    );
  }
  draft.write({ ...instance, links: new Map(instance.links).set(name, to) });
}
