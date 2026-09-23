// Which passage applies, for each name, on a composed kind (the spec's
// Kinds, composition and libraries › How members combine, the row "a
// passage: refuse, unless all but one are `default`"; Prose › Passages).
//
// A passage is an exclusive member, so one applies per name. The
// composer's own always does, since a collision is only ever between two
// sources neither of which is the composer. Among what its composed kinds
// bring, one origin reached by several paths counts once; a default
// yields to any passage of the same name from another source; and two
// that neither yields, or two defaults with nothing else beside them,
// are refused at the composed kind, as written, that brought the second.
// The one that applies keeps its origin and its `default`, so a default
// passed through still yields further up.

import type { KindExpr, KindMember, PassageBody } from '../syntax/ast.js';
import type { Diagnostics } from '../source/diagnostics.js';
import type { Span } from '../source/source.js';
import { readable } from '../syntax/parse/parser.js';

/** The passage that applies for one name on a composed kind. */
export interface ResolvedPassage {
  readonly name: string;
  /**
   * The kind that wrote it, by qualified name: `sprout.World`. An
   * object's own body is its anonymous kind, named for the object; a
   * world's is named for the world.
   */
  readonly origin: string;
  /** Whether it was written `default`, and so gives way to any other source's. */
  readonly yields: boolean;
  /** Its words, carried whole; reading the slots in them is the prose reader's. */
  readonly body: PassageBody;
  /** Where its name was written. */
  readonly at: Span;
}

/** A passage as it reached the composer: which composed kind, as written, it came through. */
export interface PassageArrival {
  readonly passage: ResolvedPassage;
  readonly through: KindExpr;
}

/** A composed kind's passages, and the kind as the composer wrote it. */
export interface ComposedPassages {
  readonly passages: ReadonlyMap<string, ResolvedPassage>;
  readonly written: KindExpr;
}

/**
 * The passages a composer's own body writes, with `origin` as their
 * origin. A name written twice is refused at the second, which is dropped.
 */
export function ownPassages(
  composer: string,
  members: readonly KindMember[],
  origin: string,
  diagnostics: Diagnostics,
): Map<string, ResolvedPassage> {
  const own = new Map<string, ResolvedPassage>();
  for (const member of members) {
    if (member.kind !== 'passage') continue;
    const name = member.name.text;
    if (own.has(name)) {
      diagnostics.refuse(
        member.name.at,
        `\`${composer}\` writes the passage \`${name}\` twice.`,
        'A thing speaks each line in one voice. Keep one of them, or give the other another name.',
      );
      continue;
    }
    own.set(name, { name, origin, yields: member.yields, body: member.body, at: member.name.at });
  }
  return own;
}

/**
 * What the composed kinds bring, by name, in the order written. One origin
 * reached by several paths is one arrival (How members combine, rule 2).
 */
export function passageArrivals(
  composed: readonly ComposedPassages[],
): Map<string, PassageArrival[]> {
  const arrivals = new Map<string, PassageArrival[]>();
  for (const { passages, written } of composed) {
    for (const passage of passages.values()) {
      const came = arrivals.get(passage.name) ?? [];
      if (came.some((one) => one.passage.origin === passage.origin)) continue;
      came.push({ passage, through: written });
      arrivals.set(passage.name, came);
    }
  }
  return arrivals;
}

/** What a composer is called in a refusal, and how a kind's qualified name is shown from it. */
export interface PassageComposer {
  readonly name: string;
  shown(identity: string): string;
}

/**
 * The passage that applies for each name: the composer's own, else the
 * one arrival that does not yield, else the one default. Two or more
 * that do not yield, or two or more defaults and nothing else, are
 * refused, and the first of them is kept so that nothing further up is
 * said about the same line again.
 */
export function resolvePassages(
  composer: PassageComposer,
  own: ReadonlyMap<string, ResolvedPassage>,
  arrivals: ReadonlyMap<string, readonly PassageArrival[]>,
  diagnostics: Diagnostics,
): Map<string, ResolvedPassage> {
  const resolved = new Map<string, ResolvedPassage>();
  for (const [name, came] of arrivals) {
    const mine = own.get(name);
    if (mine !== undefined) {
      resolved.set(name, mine);
      continue;
    }
    const speaking = came.filter((one) => !one.passage.yields);
    const contenders = speaking.length > 0 ? speaking : came;
    if (contenders.length > 1) refuseCollision(composer, name, contenders, diagnostics);
    resolved.set(name, contenders[0]!.passage);
  }
  for (const [name, passage] of own) if (!resolved.has(name)) resolved.set(name, passage);
  return resolved;
}

/** Two or more sources for one line, none of them the composer: refused at the second, naming them all. */
function refuseCollision(
  composer: PassageComposer,
  name: string,
  contenders: readonly PassageArrival[],
  diagnostics: Diagnostics,
): void {
  const sources = readable(contenders.map((one) => composer.shown(one.passage.origin)));
  const from = contenders.length === 2 ? `both ${sources}` : sources;
  const allDefault = contenders.every((one) => one.passage.yields);
  diagnostics.refuse(
    contenders[1]!.through.at,
    allDefault
      ? `\`${composer.name}\` gets a default passage \`${name}\` from ${from}, and a thing speaks each line in one voice: a default gives way only to a passage that is not one.`
      : `\`${composer.name}\` gets the passage \`${name}\` from ${from}, and a thing speaks each line in one voice.`,
    `Write its own \`passage ${name} { … }\` in \`${composer.name}\`, which is then the one that applies, or compose only one of them.`,
  );
}
