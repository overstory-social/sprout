import { z } from 'zod';

import { hostSeconds, type Bundle, type HostSeconds } from '@overstory/sprout/lang';

import type { MicroworldRecord } from '../records.js';
import type { SproutStore } from '../store.js';

// A publish in the log (the spec's The runtime › The log; State ›
// Redeploying): the hash of the bundle the world runs from here on, so
// that each segment of the log is read against the bundle that produced
// it, from that bundle's initial state, and the instant the host recorded
// it at. A publish redeploys: nothing the world stored carries over. Every
// turn logged after it, up to the next publish or withholding, ran
// against that bundle.

export const PublishEntry = z.object({
  kind: z.literal('publish'),
  level: z.literal('info'),
  now: z.number().int().nonnegative(),
  /** The published bundle's hash (`Bundle.hash`). */
  bundle: z.string().min(1),
});
export type PublishEntry = z.infer<typeof PublishEntry>;

/** What the log keeps of publishing `bundle` at `now`. */
export function publishEntry(bundle: Bundle, now: HostSeconds): PublishEntry {
  return {
    kind: 'publish',
    level: 'info',
    now: hostSeconds(now, 'a publish’s time'),
    bundle: bundle.hash,
  };
}

/**
 * Publish `record` with `bundle` compiled from it, at `now`, redeploying
 * the world: the record put, everything it stored cleared, and the publish
 * logged, in one transaction under the world's lock, so no turn runs
 * between the bundle changing and the log saying so.
 */
export function publishWorld(
  store: SproutStore,
  record: MicroworldRecord,
  bundle: Bundle,
  now: HostSeconds,
): Promise<PublishEntry> {
  const entry = publishEntry(bundle, now);
  return store.transaction(record.id, async (tx) => {
    await tx.putMicroworld(record);
    await tx.resetState();
    await tx.appendLog(entry);
    return entry;
  });
}

/**
 * Start `record`'s world with `bundle` at `now`, as a host does when it
 * starts: where the world last ran these same files, `stamp` and all, what
 * it stored is kept; otherwise it is published, redeploying it (the
 * spec's State › Redeploying: what a world stores is kept across a host's
 * restart only while its files are the same).
 */
export async function deployWorld(
  store: SproutStore,
  record: MicroworldRecord,
  bundle: Bundle,
  now: HostSeconds,
): Promise<'kept' | 'redeployed'> {
  const running = await store.read(record.id, (tx) => tx.microworld());
  if (running !== null && running.stamp === record.stamp) return 'kept';
  await publishWorld(store, record, bundle, now);
  return 'redeployed';
}
