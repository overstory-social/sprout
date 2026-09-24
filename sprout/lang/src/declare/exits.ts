// A place's exits and links, in both tiers (the spec's Verbs › Exits, An
// exit may be conditional, Places inside places, Links; Limits › Static
// caps).
//
// The first tier checks one body's lines against themselves: each leads
// in a direction of the closed set, written out; a label is not empty;
// two links of one body never share a direction, since `connect` names a
// link by it; and the body writes no more exits than the host's cap.
//
// The second tier composes them one direction at a time, as an exclusive
// member: a composer's own exits in a direction replace every composed
// one in it, one source's apply, and two sources are refused. Within one
// source a direction's exits keep the order written, which is the order
// their guards are tried in, so composition order never decides which
// way out applies (the spec's How members combine). Where each leads,
// and what a guard may read, is the checker's.

import { writtenPath, type KindExpr, type KindMember } from '../syntax/ast.js';
import type { GrammarExit, GrammarLine, GrammarLink } from '../syntax/ast-grammar.js';
import type { Diagnostics } from '../source/diagnostics.js';
import { ABBREVIATIONS, DIRECTIONS, type Direction } from './directions.js';

/** The host's figure for the static cap on a place's exits. Never this layer's number. */
export interface ExitCaps {
  readonly exitsPerPlace: number;
}

/** One exit or link as a composed kind has it: the kind that wrote it, its direction, and the line. */
export interface ResolvedExit {
  /** The kind that wrote it, by qualified name. */
  readonly origin: string;
  readonly direction: Direction;
  readonly line: GrammarExit | GrammarLink;
}

/** The directions as a sentence lists them: `north`, …, `in` or `out`. */
const DIRECTIONS_WRITTEN = `${DIRECTIONS.slice(0, -1)
  .map((one) => `\`${one}\``)
  .join(', ')} or \`${DIRECTIONS.at(-1)}\``;

/** Whether a word, as written in source, is a direction of the closed set. */
export function isDirection(word: string): word is Direction {
  return (DIRECTIONS as readonly string[]).includes(word);
}

/** Every exit and link line of every grammar block in a body, in the order written. */
function waysOf(members: readonly KindMember[]): (GrammarExit | GrammarLink)[] {
  return members.flatMap((member) =>
    member.kind === 'grammar' ? member.lines.filter(isWayOut) : [],
  );
}

function isWayOut(line: GrammarLine): line is GrammarExit | GrammarLink {
  return line.kind === 'grammar-exit' || line.kind === 'grammar-link';
}

/** One body's exits and links, checked against themselves and the host's cap. */
export function checkExitLines(
  owner: string,
  members: readonly KindMember[],
  caps: ExitCaps,
  diagnostics: Diagnostics,
): void {
  const linked = new Set<string>();
  let counted = 0;
  for (const line of waysOf(members)) {
    const word = line.kind === 'grammar-exit' ? 'exit' : 'link';
    const direction = line.direction.text;
    const leads = line.kind === 'grammar-exit' ? ` -> ${writtenPath(line.destination)}` : '';
    if (!isDirection(direction)) {
      const meant = ABBREVIATIONS.get(direction);
      diagnostics.refuse(
        line.direction.at,
        meant === undefined
          ? `\`${direction}\` is not a direction. A way out leads ${DIRECTIONS_WRITTEN}.`
          : `\`${direction}\` is how a visitor types \`${meant}\`, and source writes the direction out.`,
        meant === undefined
          ? `Write one of those, and say the rest in the label, as in \`${word} in "${line.label.text || 'through the fur coats'}"${leads}\`.`
          : `Write \`${word} ${meant} "${line.label.text}"${leads}\`.`,
      );
    }
    if (line.label.text.trim() === '') {
      diagnostics.refuse(
        line.label.at,
        `This ${word}'s label is empty, and it is what a visitor reads and types for the way out.`,
        `Write where it goes, as in \`${word} ${direction} "out to the yard"\`.`,
      );
    }
    if (line.kind === 'grammar-link') {
      if (linked.has(direction)) {
        diagnostics.refuse(
          line.direction.at,
          `\`${owner}\` writes two links \`${direction}\`, and \`connect ${direction}\` could not say which it means.`,
          'Give each link a direction of its own.',
        );
      }
      linked.add(direction);
    }
    counted += 1;
    if (counted === caps.exitsPerPlace + 1) {
      diagnostics.refuse(
        line.at,
        `\`${owner}\` writes more than ${caps.exitsPerPlace} exits and links, and ${caps.exitsPerPlace} is as many as a place may have.`,
        'Keep the ways out a visitor needs here: several guarded exits in one direction each count.',
      );
    }
  }
}

/** What a composer's own body writes, each line whose direction the first tier accepted. */
export function ownExits(members: readonly KindMember[], origin: string): ResolvedExit[] {
  const own: ResolvedExit[] = [];
  for (const line of waysOf(members)) {
    const direction = line.direction.text;
    if (isDirection(direction)) own.push({ origin, direction, line });
  }
  return own;
}

/** A composed kind's exits, with the kind as written that brought them. */
export interface ComposedExits {
  readonly exits: readonly ResolvedExit[];
  readonly written: KindExpr;
}

/**
 * The exits a composer answers with, direction by direction in the order
 * each first appears, the composed kinds' before its own: its own in a
 * direction where it writes any, else the one source's, and two sources
 * refused at the kind, as written, that brought the second, the first
 * kept. `shown` names an origin as a message does.
 */
export function composeExits(
  composer: string,
  composed: readonly ComposedExits[],
  own: readonly ResolvedExit[],
  shown: (origin: string) => string,
  diagnostics: Diagnostics,
): ResolvedExit[] {
  const directions: Direction[] = [];
  for (const exit of [...composed.flatMap(({ exits }) => exits), ...own]) {
    if (!directions.includes(exit.direction)) directions.push(exit.direction);
  }
  const answered: ResolvedExit[] = [];
  for (const direction of directions) {
    const mine = own.filter((exit) => exit.direction === direction);
    if (mine.length > 0) {
      answered.push(...mine);
      continue;
    }
    const sources: { origin: string; through: KindExpr; exits: ResolvedExit[] }[] = [];
    for (const { exits, written } of composed) {
      for (const exit of exits) {
        if (exit.direction !== direction) continue;
        const source = sources.find((one) => one.origin === exit.origin);
        if (source === undefined) {
          sources.push({ origin: exit.origin, through: written, exits: [exit] });
        } else if (source.through === written && !source.exits.includes(exit)) {
          source.exits.push(exit);
        }
      }
    }
    const [first, second] = sources;
    if (first === undefined) continue;
    if (second !== undefined) {
      diagnostics.refuse(
        second.through.at,
        `\`${composer}\` gets its ways \`${direction}\` from both \`${shown(first.origin)}\` and \`${shown(second.origin)}\`, and one place says where \`${direction}\` leads.`,
        `Write \`${composer}\`'s own exits \`${direction}\` to say which apply.`,
      );
    }
    answered.push(...first.exits);
  }
  return answered;
}
