// What a capacity measures by (the spec's Containment is a declaration;
// The compiler › What it refuses). `capacity 100 by :size` sums a property
// over whatever goes in, which may be of any kind, so the property is
// judged against the whole bundle: some kind declares it, and every kind
// that does declares it an integer. A thing whose kind declares none
// measures nothing. Each line is judged once, where it is written.

import type { Diagnostics } from '../../source/diagnostics.js';
import type { KindRef } from '../../declare/kinds.js';
import { shownName } from '../../declare/enums.js';
import type { ResolvedProperty } from '../../declare/properties.js';
import { showType } from '../../declare/types.js';

/** Refuse each `capacity … by :p` whose `:p` no kind declares, or some kind declares as other than an integer. */
export function checkMeasures(kinds: readonly KindRef[], diagnostics: Diagnostics): void {
  const declared = new Map<string, ResolvedProperty[]>();
  for (const kind of kinds) {
    for (const property of kind.properties.values()) {
      if (property.remembered) continue;
      const all = declared.get(property.name) ?? [];
      if (!all.some((one) => one.origin === property.origin)) all.push(property);
      declared.set(property.name, all);
    }
  }
  const judged = new Set<string>();
  for (const kind of kinds) {
    const capacity = kind.capacity;
    if (capacity === null || judged.has(capacity.origin)) continue;
    judged.add(capacity.origin);
    const { by, at } = capacity;
    const from = capacity.origin.slice(0, capacity.origin.indexOf('.'));
    const shown = (origin: string): string => shownName(origin, from);
    const all = declared.get(by) ?? [];
    if (all.length === 0) {
      diagnostics.refuse(
        at,
        `Nothing declares \`:${by}\`, so nothing could be measured by it.`,
        `Declare it on the kinds of what goes in, as a whole number each starts at: \`:${by} 0\`.`,
      );
      continue;
    }
    const other = all.find((property) => property.type.type !== 'integer');
    if (other !== undefined) {
      diagnostics.refuse(
        at,
        `\`:${by}\` holds ${showType(other.type)} in \`${shown(other.origin)}\`, and a capacity measures by a whole number.`,
        `Measure by an integer property, or give \`${shown(other.origin)}\`'s \`:${by}\` another name.`,
      );
    }
  }
}
