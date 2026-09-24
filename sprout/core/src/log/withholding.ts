import { z } from 'zod';

import { codeUnitOrder, hostSeconds, type Bundle, type HostSeconds } from '@overstory/sprout/lang';

import type { SproutStore } from '../store.js';

// A moderator's withholding in the log (the spec's The runtime › The log;
// The host contract › Moderation and takedown): every file withheld from
// here on, by name, and the hash of the bundle the world then runs, so
// the turns after it are read against what actually ran; whether
// withholding a file changes that hash is not settled, and the entry
// records whichever the host loaded. Lifting a withholding is recorded
// the same way, with the file gone from the set, so the set in the log is
// always the one the world is running with.

export const WithholdingEntry = z.object({
  kind: z.literal('withholding'),
  now: z.number().int().nonnegative(),
  /** Every file withheld now, by name, in code-unit order; empty once none is. */
  withheld: z.array(z.string().min(1)),
  /** The hash of the bundle loaded with them withheld. */
  bundle: z.string().min(1),
});
export type WithholdingEntry = z.infer<typeof WithholdingEntry>;

/** What the log keeps of the world running `bundle`, loaded with `withheld` held back, from `now`. */
export function withholdingEntry(
  withheld: readonly string[],
  bundle: Bundle,
  now: HostSeconds,
): WithholdingEntry {
  return {
    kind: 'withholding',
    now: hostSeconds(now, 'a withholding’s time'),
    withheld: [...new Set(withheld)].sort(codeUnitOrder),
    bundle: bundle.hash,
  };
}

/** Record, under `microworldId`'s lock, that it runs `bundle` with `withheld` held back from `now` on. */
export function logWithholding(
  store: SproutStore,
  microworldId: string,
  withheld: readonly string[],
  bundle: Bundle,
  now: HostSeconds,
): Promise<WithholdingEntry> {
  const entry = withholdingEntry(withheld, bundle, now);
  return store.transaction(microworldId, async (tx) => {
    await tx.appendLog(entry);
    return entry;
  });
}
