// A composed kind's `describe` (the spec's Kinds › How members combine,
// the row "`describe`: refuse"; Prose does not compose). A thing has one
// voice, so a describe is exclusive: the composer's own replaces what it
// composes, otherwise the one source's applies, and two sources are
// refused at the kind, as written, that brought the second, since
// stitched paragraphs read as stitched and the author writes the one
// paragraph both should make.

import type { KindExpr, KindMember } from '../syntax/ast.js';
import { describeWord, type DescribeDeclaration } from '../syntax/ast-speech.js';
import type { Diagnostics } from '../source/diagnostics.js';

/** One kind's describe, as a composed kind has it. */
export interface ResolvedDescribe {
  /** The kind that wrote it, by qualified name. */
  readonly origin: string;
  readonly declaration: DescribeDeclaration;
}

/**
 * The describe a composer's own body writes, with `origin` as its origin;
 * null where it writes none. One written twice is refused at the second,
 * which is dropped.
 */
export function ownDescribe(
  composer: string,
  members: readonly KindMember[],
  origin: string,
  diagnostics: Diagnostics,
): ResolvedDescribe | null {
  let own: ResolvedDescribe | null = null;
  for (const member of members) {
    if (member.kind !== 'describe') continue;
    if (own !== null) {
      diagnostics.refuse(
        describeWord(member),
        `\`${composer}\` writes \`describe\` twice.`,
        'A thing has one description. Keep one `describe`, and write what both say in it, with `if` where it depends.',
      );
      continue;
    }
    own = { origin, declaration: member };
  }
  return own;
}

/** A composed kind's describe, with the kind as written that brought it. */
export interface ComposedDescribe {
  readonly describe: ResolvedDescribe | null;
  readonly written: KindExpr;
}

/**
 * The describe a composer has: its own, else the one source's; two
 * sources are refused at the kind, as written, that brought the second,
 * and the first is kept. `shown` names an origin as a message does.
 */
export function composeDescribe(
  composer: string,
  composed: readonly ComposedDescribe[],
  own: ResolvedDescribe | null,
  shown: (origin: string) => string,
  diagnostics: Diagnostics,
): ResolvedDescribe | null {
  if (own !== null) return own;
  const sources: { readonly describe: ResolvedDescribe; readonly through: KindExpr }[] = [];
  for (const { describe, written } of composed) {
    if (describe === null) continue;
    if (!sources.some((seen) => seen.describe.origin === describe.origin)) {
      sources.push({ describe, through: written });
    }
  }
  const [first, second] = sources;
  if (first === undefined) return null;
  if (second !== undefined) {
    diagnostics.refuse(
      second.through.at,
      `\`${composer}\` gets a \`describe\` from both \`${shown(first.describe.origin)}\` and \`${shown(second.describe.origin)}\`, and a thing has one voice.`,
      `Write \`describe { … }\` in \`${composer}\`, with the one paragraph both should make.`,
    );
  }
  return first.describe;
}
