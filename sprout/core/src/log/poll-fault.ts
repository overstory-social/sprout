import { z } from 'zod';

import { hostSeconds, type Fault, type HostSeconds } from '@overstory/sprout/lang';

import { LoggedFault, loggedFault } from './parts.js';

// A poll's fault in the log (the spec's The view; The runtime › The
// log): an authoring fault against the object whose description cost too
// much, which is the fault's `object`, and the instant the host polled
// at. Nothing else of a poll is logged, and it is not replayed, since a
// poll writes nothing; who was looking is not kept.

export const PollFaultEntry = z.object({
  kind: z.literal('poll-fault'),
  now: z.number().int().nonnegative(),
  fault: LoggedFault,
});
export type PollFaultEntry = z.infer<typeof PollFaultEntry>;

/** What the log keeps of a poll at `now` that faulted with `fault`. */
export function pollFaultEntry(fault: Fault, now: HostSeconds): PollFaultEntry {
  return { kind: 'poll-fault', now: hostSeconds(now, 'a poll’s time'), fault: loggedFault(fault) };
}
