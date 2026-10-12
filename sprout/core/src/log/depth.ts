import { z } from 'zod';

import { sha256 } from '@overstory/sprout/lang';

import type { LogEntry } from './entry.js';
import type { LoggedEffect } from './parts.js';

// How much of a turn the log keeps (the spec's The runtime › The log,
// Depth): at debug depth every effect whole; at play depth, the default,
// how many there were and a digest of them, since replaying the turn
// gives them back. Everything else of an entry is kept at either depth.

/** The two depths a host keeps its log at. */
export type LogDepth = 'play' | 'debug';

/** A turn's effects at play depth: how many, and the SHA-256 of them as debug depth would log them. */
export const LoggedDigest = z.object({
  count: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type LoggedDigest = z.infer<typeof LoggedDigest>;

/** The digest of `effects`, read with every object's keys in code-unit order. */
export function digestOf(effects: readonly LoggedEffect[]): LoggedDigest {
  return { count: effects.length, sha256: sha256(JSON.stringify(canonical(effects))) };
}

/** `entry` as a log at `depth` keeps it; an entry with no effects is kept whole at either. */
export function atDepth(entry: LogEntry, depth: LogDepth): LogEntry {
  if (depth === 'debug' || !('effects' in entry) || entry.digest !== undefined) return entry;
  return { ...entry, effects: [], digest: digestOf(entry.effects) };
}

/** `v` with every object's keys in code-unit order. */
export function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}
