// What a container holds by measure (the spec's Containment is a
// declaration): `capacity 100 by :size` is one per kind, an exclusive
// member as `name` is, so the composer's own replaces what it composes and
// two composed sources are refused. Which property it measures by is the
// bundle's to check, since the things it holds are any kind's.

import type { CapacityDeclaration, KindExpr, KindMember } from '../syntax/ast.js';
import type { Diagnostics } from '../source/diagnostics.js';
import type { Span } from '../source/source.js';
import { INTEGER_MAX } from './types.js';

/** What a container holds by measure: the most, the property each thing is measured by, and the kind that says so. */
export interface Capacity {
  readonly limit: number;
  readonly by: string;
  /** The kind that wrote it, by qualified name; an object's own body is its anonymous kind. */
  readonly origin: string;
  /** Where the property is written, `:size`, which is what a refusal of it points at. */
  readonly at: Span;
}

/** A composed kind's capacity, and the kind as the composer wrote it. */
export interface CapacityArrival {
  readonly capacity: Capacity | null;
  readonly written: KindExpr;
}

/**
 * The one capacity a composer has: its own, else the one source it
 * composes. Its own written twice, or two composed sources, are refused,
 * as is its own where it holds nothing or the most is past what an
 * integer holds.
 */
export function composeCapacity(
  composer: { readonly name: string; readonly members: readonly KindMember[] },
  origin: string,
  composed: readonly CapacityArrival[],
  contains: boolean,
  shown: (origin: string) => string,
  diagnostics: Diagnostics,
): Capacity | null {
  const written = composer.members.filter(
    (member): member is CapacityDeclaration => member.kind === 'capacity',
  );
  const [mine, again] = written;
  if (again !== undefined) {
    diagnostics.refuse(
      again.at,
      `\`${composer.name}\` says its capacity twice.`,
      'A container has one capacity. Remove one of the lines.',
    );
  }
  if (mine !== undefined) {
    if (!contains) {
      diagnostics.refuse(
        mine.at,
        `\`${composer.name}\` has a capacity and holds nothing.`,
        `Write \`contains\` in \`${composer.name}\`, or compose a kind that holds things, such as \`sprout.Container\`.`,
      );
    }
    if (mine.limit.value > INTEGER_MAX) {
      diagnostics.refuse(
        mine.limit.at,
        `A capacity of ${mine.limit.value} is more than an integer holds.`,
        `Write a whole number no larger than ${INTEGER_MAX}.`,
      );
    }
    return { limit: mine.limit.value, by: mine.by.text, origin, at: mine.by.at };
  }
  const sources: { capacity: Capacity; through: KindExpr }[] = [];
  for (const { capacity, written: through } of composed) {
    if (capacity !== null && !sources.some((one) => one.capacity.origin === capacity.origin)) {
      sources.push({ capacity, through });
    }
  }
  const [first, second] = sources;
  if (first === undefined) return null;
  if (second !== undefined) {
    diagnostics.refuse(
      second.through.at,
      `\`${composer.name}\` gets its capacity from both \`${shown(first.capacity.origin)}\` and \`${shown(second.capacity.origin)}\`, and a container has one.`,
      `Write \`capacity … by :…\` in \`${composer.name}\` to say which it holds by.`,
    );
  }
  return first.capacity;
}
