import { z } from 'zod';

import { hostSeconds, type Bundle, type HostSeconds } from '@overstory/sprout/lang';

import type { MicroworldRecord } from '../records.js';
import type { SproutStore } from '../store.js';

// A publish in the log (the spec's The runtime › The log): the hash of
// the bundle the world runs from here on, so that each segment of the log
// is read against the bundle that produced it, and the instant the host
// recorded it at. Every turn logged after it, up to the next publish or
// withholding, ran against that bundle.

export const PublishEntry = z.object({
  kind: z.literal('publish'),
  now: z.number().int().nonnegative(),
  /** The published bundle's hash (`Bundle.hash`). */
  bundle: z.string().min(1),
});
export type PublishEntry = z.infer<typeof PublishEntry>;

/** What the log keeps of publishing `bundle` at `now`. */
export function publishEntry(bundle: Bundle, now: HostSeconds): PublishEntry {
  return { kind: 'publish', now: hostSeconds(now, 'a publish’s time'), bundle: bundle.hash };
}

/**
 * Publish `record` with `bundle` compiled from it, at `now`: the record
 * put and the publish logged in one transaction under the world's lock,
 * so no turn runs between the bundle changing and the log saying so.
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
    await tx.appendLog(entry);
    return entry;
  });
}
