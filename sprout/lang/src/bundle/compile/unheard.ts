// The warning for a passage on an object or the world that nothing
// invokes and nothing it composes declares (the spec's The compiler ›
// What it warns about), which is most often a misspelt override: a
// world's `passage nothing_happen` replaces no stock line and is never
// said. A kind's passage is not warned about, since what composes the
// kind may say it; nor is one that replaces a composed kind's.

import type { Diagnostics } from '../../source/diagnostics.js';
import { libraryOf, nearestOption } from '../../declare/enums.js';
import { kindName, type KindLookup } from '../../declare/kinds.js';
import type { ResolvedPassage } from '../../declare/passages.js';
import type { Written } from './bodies.js';

/** What the warning reads: every body checked, the passages nothing says, and whose objects are the world's. */
export interface UnheardSetting {
  readonly written: readonly Written[];
  readonly unheard: ReadonlySet<ResolvedPassage>;
  readonly kinds: KindLookup;
  /** The world's own namespace. */
  readonly namespace: string;
  readonly diagnostics: Diagnostics;
}

/** Warn at each passage an object or the world writes that nothing says and that replaces nothing. */
export function warnUnheard(setting: UnheardSetting): void {
  const { written, unheard, kinds, namespace, diagnostics } = setting;
  for (const { kind, vantage } of written) {
    // A named kind's body is the empty path of a kind vantage; every other
    // body checked is an object's or the world's own.
    if (vantage.in === 'kind' && vantage.path.length === 0) continue;
    const own = kindName(kind);
    const named = vantage.path.length === 0 ? kind.name : vantage.path.join('.');
    if (libraryOf(own) !== namespace) continue;
    const composed = kinds
      .all()
      .filter((other) => kindName(other) !== own && kind.composes.has(kindName(other)));
    const replaceable = [...new Set(composed.flatMap((other) => [...other.passages.keys()]))];
    for (const passage of kind.passages.values()) {
      if (passage.origin !== own || !unheard.has(passage)) continue;
      if (replaceable.includes(passage.name)) continue;
      const meant = nearestOption(passage.name, replaceable);
      diagnostics.warn(
        passage.at,
        `Nothing says \`${passage.name}\`, and nothing \`${named}\` is made of has a passage of that name for it to replace.${meant === null ? '' : ` Did you mean \`${meant}\`?`}`,
        meant === null
          ? `Say it by name where it should be heard, as in \`say ${passage.name}\` in a role's \`do\`, or take it out.`
          : `Write \`passage ${meant} { … }\` to replace that line, or say this one by name where it should be heard, as in \`say ${passage.name}\` in a role's \`do\`.`,
      );
    }
  }
}
