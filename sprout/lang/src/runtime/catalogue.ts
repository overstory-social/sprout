// What one bundle says about the instances a world may hold (the spec's
// The runtime › State): every declared object by its id, what the world
// and a visitor are made of, the kinds a spawn may name and what each
// gives its instances, every kind as a body finds it by name, every verb
// and the phrases a visitor may type, where visitors arrive, the word
// set a nickname is admitted against, the extensions it pins, and the
// host's caps that stored values are read under. Built once per load,
// and read by every rule that reconciles stored state with source.
//
// Every placement in the declared tree is here, what a kind gave a
// declared object and one whose kind is absent included, so that what it
// holds keeps its declared container and its rank. A declared object's
// rank is its position in one walk of the tree, which keeps siblings in
// the order they were declared.

import type { Bundle } from '../bundle/bundle.js';
import type { PinnedExtension } from '../declare/extensions.js';
import type { StaticCaps } from '../bundle/limits.js';
import { isVisitorKind } from '../declare/actors.js';
import type { KindContents } from '../declare/contents.js';
import { kindName, type KindLookup, type KindRef } from '../declare/kinds.js';
import { WORLD } from '../declare/sprout-world.js';
import type { Placement, TreePath } from '../declare/tree.js';
import type { VerbLookup } from '../declare/verbs.js';
import type { MessageLookup } from '../declare/messages.js';
import type { NameTable } from '../check/names.js';
import type { Node } from '../source/nodes.js';
import { declaredId, type InstanceId } from './ids.js';
import { typedPhrasesOf, type TypedPhrase } from './parser/phrases.js';

/** One object the tree places. */
export interface DeclaredEntry {
  readonly id: InstanceId;
  readonly path: TreePath;
  /** The id of its declared container, the world's for an object written in the world's body. */
  readonly container: InstanceId;
  /** Its composed anonymous kind; null where the kind is absent and the object with it. */
  readonly kind: KindRef | null;
  /** Its position in a walk of the declared tree, so siblings keep their declared order. */
  readonly rank: number;
}

export interface Catalogue {
  /** The world's id, which is its name and the root of the tree. */
  readonly world: InstanceId;
  /** What the world is made of; null in a loaded world that admits no one for want of it. */
  readonly worldKind: KindRef | null;
  /** What a visitor is made of; null in a loaded world that admits no one for want of it. */
  readonly visitorKind: KindRef | null;
  /** Every placement in the declared tree, by id, absent kinds included. */
  readonly declared: ReadonlyMap<InstanceId, DeclaredEntry>;
  /**
   * The kinds a spawn may name, by qualified name: every kind the bundle
   * declares but those composing `sprout.World` or `sprout.Visitor`, since
   * the world and a visitor are never spawned (the spec's The world model;
   * Actors and visitors). A stored spawn of one stays dormant.
   */
  readonly kinds: ReadonlyMap<string, KindRef>;
  /** What each kind's body gives every instance of it, which a spawn makes with the instance. */
  readonly contents: KindContents;
  /**
   * Every kind the bundle declares, the world's among them, found by name
   * as a body names one: what an `is(K)` or a `count(K)` reads.
   */
  readonly lookup: KindLookup;
  /** Every verb the bundle declares, which an `act` reaches by name. */
  readonly verbs: VerbLookup;
  /** Every phrase a visitor may type, in the order the command parser tries them. */
  readonly phrases: readonly TypedPhrase[];
  /** Every message the bundle declares, which a send's message is reached in. */
  readonly messages: MessageLookup;
  /** What each identifier and path a body writes names. */
  readonly names: NameTable;
  /** Every slot of prose that renders an enum's option, which renders humanised. */
  readonly optionSlots: ReadonlySet<Node>;
  /** Where visitors arrive, or null for a world that admits no one. */
  readonly arrival: InstanceId | null;
  /** The bundle's word set, which a nickname is admitted against. */
  readonly words: ReadonlySet<string>;
  /**
   * The extensions the world pins, by name, each with what the host
   * supplies for it: what an extension's statement runs, and, where one
   * is absent, what a visitor is told on entry.
   */
  readonly extensions: ReadonlyMap<string, PinnedExtension>;
  /**
   * The caps the host runs the world under now, which stored values are
   * read under: its own, or for a world it made an exception for, those
   * the exception granted, which that load's bundle records.
   */
  readonly caps: StaticCaps;
}

/** What `bundle` says about instances, read under the host's current `caps`. */
export function catalogueOf(bundle: Bundle, caps: StaticCaps): Catalogue {
  const name = bundle.manifest.name;
  const world = declaredId(name, []);
  const declared = new Map<InstanceId, DeclaredEntry>();
  const queue: Placement[] = [...bundle.tree.holds.values()];
  for (let head = 0; head < queue.length; head++) {
    const placement = queue[head]!;
    const id = declaredId(name, placement.path);
    declared.set(id, {
      id,
      path: placement.path,
      container: declaredId(name, placement.container),
      kind: placement.kind,
      rank: head,
    });
    queue.push(...placement.holds.values());
  }
  return {
    world,
    worldKind: bundle.world,
    visitorKind: bundle.visitor,
    declared,
    kinds: new Map(
      bundle.kinds
        .filter((kind) => !kind.composes.has(WORLD) && !isVisitorKind(kind))
        .map((kind) => [kindName(kind), kind]),
    ),
    contents: bundle.contents,
    lookup: bundle.kindLookup,
    verbs: bundle.verbs,
    phrases: typedPhrasesOf(bundle.verbs.all(), name),
    messages: bundle.messages,
    names: bundle.names,
    optionSlots: bundle.optionSlots,
    arrival: bundle.arrival === null ? null : declaredId(name, bundle.arrival),
    words: new Set(bundle.words),
    extensions: new Map(bundle.extensions.map((pinned) => [pinned.name, pinned])),
    caps,
  };
}
