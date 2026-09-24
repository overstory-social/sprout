// What a kind's body gives every instance of it (the spec's The world
// model › Objects: "a kind's body may hold objects too: every instance of
// the kind, declared or spawned, starts with its own copy of each, inside
// it"). Each object written in a kind's body, at any depth, is composed
// once, as a declared object's anonymous kind is, and is the template for
// every copy; an instance's contents are what each kind in its closure
// gives, in closure order (`givenBy`), before what its own body holds.
//
// Two invariants. A content is refused, and given to no one, where what
// holds it holds nothing, where it holds two of one name, or where it is
// made for a person, since nothing declares a visitor (the spec's Actors
// and visitors) whatever instance would hold it. And no kind
// gives, at any depth, something made of a kind it is already inside: the
// content that would close such a loop is refused and cut, so every
// instance's contents are finite.

import type { KindDeclaration, ObjectDeclaration } from '../syntax/ast.js';
import type { Diagnostics } from '../source/diagnostics.js';
import { qualifiedName, type EnumTable } from './enums.js';
import type { KindRef, KindTable } from './kinds.js';
import { composeKind, type MemberNames, type OnUnknown } from './compose.js';

import { holdsNothing, type TreePath } from './tree.js';
import { aVisitorMade, isVisitorKind } from './actors.js';

/** One object a kind's body gives every instance, and what it holds. */
export interface KindContent {
  readonly declaration: ObjectDeclaration;
  /** The kind whose body it is written in, by qualified name. */
  readonly giver: string;
  /** Its path in that body, itself last: `['wick']`, `['wick', 'flame']`. */
  readonly path: TreePath;
  /** Its anonymous kind; null where that could not be composed, and it is absent. */
  readonly kind: KindRef | null;
  /** The objects written in its own body, in the order written. */
  readonly holds: readonly KindContent[];
}

/** What each kind's own body gives, by the kind's qualified name, in the order written. */
export type KindContents = ReadonlyMap<string, readonly KindContent[]>;

/**
 * What an instance made of `kind` is given, before what its own body
 * holds: every kind in its closure contributes its own body's objects,
 * in closure order.
 */
export function givenBy(contents: KindContents, kind: KindRef): KindContent[] {
  return kind.order.flatMap((identity) => contents.get(identity) ?? []);
}

/** The content `giver`'s body writes at `path`, or null where it writes none there now. */
export function contentAt(
  contents: KindContents,
  giver: string,
  path: TreePath,
): KindContent | null {
  let level = contents.get(giver) ?? [];
  let found: KindContent | null = null;
  for (const step of path) {
    found = level.find((one) => one.declaration.name.text === step) ?? null;
    if (found === null) return null;
    level = found.holds;
  }
  return found;
}

/** Every content in the table, each before what it holds, kind by kind. */
export function everyContent(contents: KindContents): KindContent[] {
  const found: KindContent[] = [];
  const pending = [...contents.values()].flat().reverse();
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    found.push(next);
    for (let i = next.holds.length - 1; i >= 0; i--) pending.push(next.holds[i]!);
  }
  return found;
}

export interface ContentsContext extends MemberNames {
  readonly enums: EnumTable;
  /** Every kind, already composed. */
  readonly kinds: KindTable;
  /** The world's namespace, which is no library's. */
  readonly world: string;
  readonly diagnostics: Diagnostics;
  readonly onUnknown?: OnUnknown;
}

/**
 * Compose the objects every kind's body writes, by library, refusing
 * what the invariants above forbid. A kind that could not be composed
 * gives nothing, having said why.
 */
export function resolveContents(
  byLibrary: ReadonlyMap<string, readonly KindDeclaration[]>,
  context: ContentsContext,
): KindContents {
  const contents = new Map<string, KindContent[]>();
  for (const [library, declarations] of byLibrary) {
    for (const declared of declarations) {
      if (declared.objects.length === 0) continue;
      const kind = context.kinds.qualified(library, declared.name.text);
      const giver = qualifiedName(library, declared.name.text);
      const given = composeBody(declared, kind, giver, library, context);
      if (kind !== null && given.length > 0 && !contents.has(giver)) contents.set(giver, given);
    }
  }
  cutLoops(contents, context);
  return contents;
}

/**
 * The contents one kind's body writes, each composed, and each dropped
 * where what holds it holds nothing or already holds one of its name, or
 * where it is made for a person.
 * A loop, not recursion, walks the nest.
 */
function composeBody(
  declared: KindDeclaration,
  kind: KindRef | null,
  giver: string,
  library: string,
  context: ContentsContext,
): KindContent[] {
  const { diagnostics } = context;
  const top: KindContent[] = [];
  interface Pending {
    readonly declaration: ObjectDeclaration;
    readonly path: TreePath;
    /** Where it goes once composed: its holder's list. */
    readonly into: KindContent[];
    /** What holds it, as the refusals name it, and that holder's kind. */
    readonly holder: { readonly name: string; readonly kind: KindRef | null };
    readonly siblings: Set<string>;
  }
  const topNames = new Set<string>();
  const pending: Pending[] = declared.objects
    .map((declaration) => ({
      declaration,
      path: [declaration.name.text],
      into: top,
      holder: { name: declared.name.text, kind },
      siblings: topNames,
    }))
    .reverse();
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const { declaration, path, into, holder, siblings } = next;
    const name = declaration.name.text;
    const composed = composeKind(
      {
        library,
        name,
        composes: declaration.composes,
        members: declaration.members,
        object: true,
      },
      context,
    );
    if (holder.kind !== null && !holder.kind.contains) {
      const words = holdsNothing(holder.name, name);
      diagnostics.refuse(declaration.name.at, words.message, words.remedy);
      continue;
    }
    if (composed !== null && isVisitorKind(composed)) {
      const words = aVisitorMade(name, 'declares');
      diagnostics.refuse(declaration.name.at, words.message, words.remedy);
      continue;
    }
    if (siblings.has(name)) {
      diagnostics.refuse(
        declaration.name.at,
        `\`${holder.name}\` holds two objects called \`${name}\`.`,
        'Give one of them another name, or remove it.',
      );
      continue;
    }
    siblings.add(name);
    const holds: KindContent[] = [];
    into.push({ declaration, giver, path, kind: composed, holds });
    const inner = new Set<string>();
    for (let i = declaration.objects.length - 1; i >= 0; i--) {
      const object = declaration.objects[i]!;
      pending.push({
        declaration: object,
        path: [...path, object.name.text],
        into: holds,
        holder: { name, kind: composed },
        siblings: inner,
      });
    }
  }
  return top;
}

/**
 * Refuse, and cut from the table, each content that is made of a kind it
 * is already inside, walking the kinds as a graph from each to every
 * kind its contents compose; what is left gives every instance finitely
 * many contents. The walk is depth-first and kept on a stack.
 */
function cutLoops(contents: Map<string, KindContent[]>, context: ContentsContext): void {
  const done = new Set<string>();
  const onPath = new Set<string>();
  interface Frame {
    readonly kind: string;
    /** Each content of the kind, with the kinds it is made of still to follow. */
    readonly edges: { readonly content: KindContent; readonly to: string }[];
    next: number;
  }
  const frameOf = (identity: string): Frame => ({
    kind: identity,
    edges: everyContent(new Map([[identity, contents.get(identity) ?? []]])).flatMap((content) =>
      (content.kind?.order ?? []).filter((to) => contents.has(to)).map((to) => ({ content, to })),
    ),
    next: 0,
  });
  const cut = new Set<KindContent>();
  for (const start of [...contents.keys()]) {
    if (done.has(start)) continue;
    const stack = [frameOf(start)];
    onPath.add(start);
    while (stack.length > 0) {
      const frame = stack.at(-1)!;
      const edge = frame.edges[frame.next++];
      if (edge === undefined) {
        stack.pop();
        onPath.delete(frame.kind);
        done.add(frame.kind);
        continue;
      }
      if (cut.has(edge.content) || isCut(edge.content, frame.kind, contents, cut)) continue;
      if (onPath.has(edge.to)) {
        cut.add(edge.content);
        refuseLoop(edge.content, edge.to, context.diagnostics);
        continue;
      }
      if (done.has(edge.to)) continue;
      onPath.add(edge.to);
      stack.push(frameOf(edge.to));
    }
  }
  for (const [identity, given] of contents) {
    const kept = without(given, cut);
    if (kept.length === 0) contents.delete(identity);
    else contents.set(identity, kept);
  }
}

/** Whether a content sits inside one already cut, in `giver`'s body. */
function isCut(
  content: KindContent,
  giver: string,
  contents: ReadonlyMap<string, readonly KindContent[]>,
  cut: ReadonlySet<KindContent>,
): boolean {
  let level = contents.get(giver) ?? [];
  for (const step of content.path.slice(0, -1)) {
    const holder = level.find((one) => one.declaration.name.text === step);
    if (holder === undefined || cut.has(holder)) return true;
    level = holder.holds;
  }
  return false;
}

/** The contents less every one cut, all the way down. */
function without(given: readonly KindContent[], cut: ReadonlySet<KindContent>): KindContent[] {
  return given
    .filter((content) => !cut.has(content))
    .map((content) => ({ ...content, holds: without(content.holds, cut) }));
}

function refuseLoop(content: KindContent, inside: string, diagnostics: Diagnostics): void {
  const name = content.declaration.name.text;
  const kind = shown(inside);
  const giver = shown(content.giver);
  diagnostics.refuse(
    content.declaration.name.at,
    `\`${name}\` is made of \`${kind}\`, which it is already inside, so every \`${kind}\` would hold another without end.`,
    `Take \`${name}\` out of \`${giver}\`'s body, or make it of kinds that do not compose \`${kind}\`.`,
  );
}

/** A kind as a refusal names it: its own name, as an author most often writes it. */
function shown(qualified: string): string {
  return qualified.slice(qualified.lastIndexOf('.') + 1);
}
