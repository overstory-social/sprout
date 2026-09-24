// A place's exits and links, in both tiers (the spec's Verbs › Exits, An
// exit may be conditional, Places inside places, Links; Limits › Static
// caps).
//
// The first tier checks one body's lines against themselves: an exit
// leads in a direction of the closed set, written out; a link is named by
// a word of the author's that is neither a direction nor a reserved word,
// and one body never writes two links of one name, since `connect` names
// a link by it; a label is not empty; and the body writes no more exits
// and links than the host's cap.
//
// The second tier gives each kind and object its ways out. Exits and
// links are not composed (the spec's How members combine): a kind has
// only its own, and an object has its own and those of the kinds its
// `is` names, its own exit in a direction replacing theirs there and its
// own link of a name replacing theirs, two of its kinds writing one
// direction or one link refused. Within one body a direction's exits keep
// the order written, which is the order their guards are tried in, so
// composition order never decides which way out applies. Where each
// leads, and what a guard may read, is the checker's.

import { writtenPath, type KindExpr, type KindMember } from '../syntax/ast.js';
import type { GrammarExit, GrammarLine, GrammarLink } from '../syntax/ast-grammar.js';
import { isReserved } from '../syntax/reserved.js';
import type { Diagnostics } from '../source/diagnostics.js';
import { ABBREVIATIONS, DIRECTIONS, type Direction } from './directions.js';

/** The host's figure for the static cap on a place's exits. Never this layer's number. */
export interface ExitCaps {
  readonly exitsPerPlace: number;
}

/**
 * One exit or link as a kind or an object has it: the kind that wrote it,
 * and the line, with an exit's direction or a link's name.
 */
export type ResolvedExit =
  | {
      readonly kind: 'exit';
      /** The kind that wrote it, by qualified name. */
      readonly origin: string;
      readonly direction: Direction;
      readonly line: GrammarExit;
    }
  | {
      readonly kind: 'link';
      /** The kind that wrote it, by qualified name. */
      readonly origin: string;
      readonly name: string;
      readonly line: GrammarLink;
    };

/** What a way out replaces another by, and collides with it by: an exit's direction, a link's name. */
function slotOf(way: ResolvedExit): string {
  return way.kind === 'exit' ? `exit ${way.direction}` : `link ${way.name}`;
}

/** The directions as a sentence lists them: `north`, …, `in` or `out`. */
const DIRECTIONS_WRITTEN = `${DIRECTIONS.slice(0, -1)
  .map((one) => `\`${one}\``)
  .join(', ')} or \`${DIRECTIONS.at(-1)}\``;

/** A link's name as the spec writes one: lower-case letters, digits and underscores, a letter first. */
const LINK_NAME = /^[a-z][a-z0-9_]*$/;

/** Whether a word, as written in source, is a direction of the closed set. */
export function isDirection(word: string): word is Direction {
  return (DIRECTIONS as readonly string[]).includes(word);
}

/** Whether a word may name a link: the spec's shape, neither a direction nor a reserved word. */
export function isLinkName(word: string): boolean {
  return LINK_NAME.test(word) && !isDirection(word) && !isReserved(word);
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
    if (line.kind === 'grammar-exit') checkDirection(line, diagnostics);
    else checkLinkName(line, owner, linked, diagnostics);
    if (line.label.text.trim() === '') {
      const written =
        line.kind === 'grammar-exit' ? `exit ${line.direction.text}` : `link ${line.name.text}`;
      diagnostics.refuse(
        line.label.at,
        `This ${line.kind === 'grammar-exit' ? 'exit' : 'link'}'s label is empty, and it is what a visitor reads and types for the way out.`,
        `Write where it goes, as in \`${written} "out to the yard"\`.`,
      );
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

/** An exit's direction: one of the closed set, written out. */
function checkDirection(line: GrammarExit, diagnostics: Diagnostics): void {
  const direction = line.direction.text;
  if (isDirection(direction)) return;
  const leads = ` -> ${writtenPath(line.destination)}`;
  const meant = ABBREVIATIONS.get(direction);
  diagnostics.refuse(
    line.direction.at,
    meant === undefined
      ? `\`${direction}\` is not a direction. A way out leads ${DIRECTIONS_WRITTEN}.`
      : `\`${direction}\` is how a visitor types \`${meant}\`, and source writes the direction out.`,
    meant === undefined
      ? `Write one of those, and say the rest in the label, as in \`exit in "${line.label.text || 'through the fur coats'}"${leads}\`.`
      : `Write \`exit ${meant} "${line.label.text}"${leads}\`.`,
  );
}

/**
 * A link's name, a word of the author's: neither a direction, so `go
 * north` never means a link, nor a reserved word, and each written once
 * in a body, `linked` holding the names the body has written so far.
 */
function checkLinkName(
  line: GrammarLink,
  owner: string,
  linked: Set<string>,
  diagnostics: Diagnostics,
): void {
  const name = line.name.text;
  const example = `\`link onward "${line.label.text.trim() === '' ? 'deeper into the dark' : line.label.text}"\``;
  if (isDirection(name)) {
    diagnostics.refuse(
      line.name.at,
      `\`${name}\` is a direction, and a link is named by a word of your own, so \`go ${name}\` never means a link.`,
      `Name it for where it goes, as in ${example}; a way \`${name}\` to a place written in source is an \`exit\`.`,
    );
  } else if (isReserved(name)) {
    diagnostics.refuse(
      line.name.at,
      `\`${name}\` is a word of the language, so it cannot name a link.`,
      `Choose another name for it, as in ${example}.`,
    );
  } else if (!LINK_NAME.test(name)) {
    diagnostics.refuse(
      line.name.at,
      `\`${name}\` does not start with a letter, and a link's name does.`,
      `Choose another name for it, as in ${example}.`,
    );
  }
  if (linked.has(name)) {
    diagnostics.refuse(
      line.name.at,
      `\`${owner}\` writes two links \`${name}\`, and \`connect ${name}\` could not say which it means.`,
      'Give each link a name of its own.',
    );
  }
  linked.add(name);
}

/**
 * What a body writes: each exit whose direction the first tier accepted,
 * and each link whose name it did, in the order written.
 */
export function ownExits(members: readonly KindMember[], origin: string): ResolvedExit[] {
  const own: ResolvedExit[] = [];
  for (const line of waysOf(members)) {
    if (line.kind === 'grammar-exit') {
      const direction = line.direction.text;
      if (isDirection(direction)) own.push({ kind: 'exit', origin, direction, line });
    } else if (isLinkName(line.name.text)) {
      own.push({ kind: 'link', origin, name: line.name.text, line });
    }
  }
  return own;
}

/** A kind an object's `is` names: its own ways out, and the kind as written. */
export interface NamedExits {
  readonly exits: readonly ResolvedExit[];
  readonly written: KindExpr;
}

/**
 * The ways out a composer answers with: its own, and those of `named`,
 * the kinds an object's `is` names (none for a kind). Each direction and
 * each link's name in the order it first appears, the named kinds'
 * before the composer's own: its own where it writes one, else the one
 * kind's, and two kinds refused at the second as written, the first
 * kept. `shown` names an origin as a message does.
 */
export function composeExits(
  composer: string,
  named: readonly NamedExits[],
  own: readonly ResolvedExit[],
  shown: (origin: string) => string,
  diagnostics: Diagnostics,
): ResolvedExit[] {
  const slots: string[] = [];
  for (const way of [...named.flatMap(({ exits }) => exits), ...own]) {
    const slot = slotOf(way);
    if (!slots.includes(slot)) slots.push(slot);
  }
  const answered: ResolvedExit[] = [];
  for (const slot of slots) {
    const mine = own.filter((way) => slotOf(way) === slot);
    if (mine.length > 0) {
      answered.push(...mine);
      continue;
    }
    const sources = named
      .map(({ exits, written }) => ({ written, ways: exits.filter((way) => slotOf(way) === slot) }))
      .filter(({ ways }) => ways.length > 0);
    const [first, second] = sources;
    if (first === undefined) continue;
    if (second !== undefined) {
      const way = first.ways[0]!;
      const [a, b] = [shown(way.origin), shown(second.ways[0]!.origin)];
      diagnostics.refuse(
        second.written.at,
        way.kind === 'exit'
          ? `\`${composer}\` gets its exits \`${way.direction}\` from both \`${a}\` and \`${b}\`, and one place says where \`${way.direction}\` leads.`
          : `\`${composer}\` gets a link \`${way.name}\` from both \`${a}\` and \`${b}\`, and \`connect ${way.name}\` could not say which it means.`,
        way.kind === 'exit'
          ? `Write \`${composer}\`'s own exits \`${way.direction}\` to say which apply.`
          : `Write \`${composer}\`'s own \`link ${way.name} "…"\` to say which applies.`,
      );
    }
    answered.push(...first.ways);
  }
  return answered;
}
