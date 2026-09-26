import { z } from 'zod';

import {
  hostSeconds,
  type HostSeconds,
  type InstanceId,
  type VisitKey,
} from '@overstory/sprout/lang';

// A line a visitor said to the others in the log (the spec's The runtime
// › The log; The host contract › Conversation): who said it, by visit,
// everyone who heard it, the speaker among them, the place and the
// instant, and the words as they were kept, so a moderator can read it
// back. It is never replayed, since it changed nothing of the world, and
// forgetting a visitor leaves it as it is, as it leaves every entry.

export const SaidEntry = z.object({
  kind: z.literal('said'),
  now: z.number().int().nonnegative(),
  /** The speaker's visit. */
  from: z.string().min(1),
  /** The place it was said in. */
  place: z.string().min(1),
  /** Everyone who heard it, the speaker among them, in contents order. */
  to: z.array(z.string().min(1)).min(1),
  /** The words, as conversation keeps them. */
  text: z.string().min(1),
});
export type SaidEntry = z.infer<typeof SaidEntry>;

/** What the log keeps of `text`, said by `from` in `place` to `to` at `at`. */
export function saidEntry(said: {
  readonly from: VisitKey;
  readonly place: InstanceId;
  readonly to: readonly VisitKey[];
  readonly text: string;
  readonly at: HostSeconds;
}): SaidEntry {
  return {
    kind: 'said',
    now: hostSeconds(said.at, 'the instant a thing is said'),
    from: said.from,
    place: said.place,
    to: [...said.to],
    text: said.text,
  };
}
