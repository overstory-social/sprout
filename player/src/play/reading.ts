import type { InstanceId, StoredBound } from '@overstory/sprout/lang';

// The reading a command turn performed, as a visitor's stored last reading
// keeps it (the spec's The runtime › Turns): its verb by qualified name,
// who performed it, and what fills each role it bound, by id, in the order
// it bound them. A report of what a playthrough reached reads it.

/** What fills a role of a performed reading: a thing, a set of them, an exit, or a chosen value. */
export type TurnFiller =
  | { readonly role: string; readonly binds: 'object'; readonly id: InstanceId }
  | { readonly role: string; readonly binds: 'set'; readonly ids: readonly InstanceId[] }
  | {
      readonly role: string;
      readonly binds: 'exit';
      readonly direction: string | null;
      readonly label: string;
      readonly to: InstanceId;
    }
  | { readonly role: string; readonly binds: 'value'; readonly value: string | number };

/** A reading by its verb's qualified name, who performs it, and what fills each role it binds, in order. */
export interface TurnReading {
  readonly verb: string;
  readonly actor: InstanceId;
  readonly bindings: readonly TurnFiller[];
}

/** What a stored reading's role holds, as the reading's filler of `role`. */
function fillerOf(role: string, bound: StoredBound): TurnFiller {
  if ('object' in bound) return { role, binds: 'object', id: bound.object as InstanceId };
  if ('set' in bound) return { role, binds: 'set', ids: bound.set.map((id) => id as InstanceId) };
  if ('exit' in bound) {
    const { direction, label, to } = bound.exit;
    return { role, binds: 'exit', direction, label, to: to as InstanceId };
  }
  return { role, binds: 'value', value: bound.value };
}

/**
 * A reading as a store keeps it, `actor`'s: its verb by library and name,
 * and what fills each role it binds, in the order it bound them.
 */
export function keptReadingOf(
  kept: {
    readonly verb: { readonly library: string; readonly name: string };
    readonly bindings: readonly (readonly [string, StoredBound])[];
  },
  actor: InstanceId,
): TurnReading {
  return {
    verb: `${kept.verb.library}.${kept.verb.name}`,
    actor,
    bindings: kept.bindings.map(([role, bound]) => fillerOf(role, bound)),
  };
}
