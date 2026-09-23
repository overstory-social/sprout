// How many kinds, objects and places a world has, against the host's
// caps (the spec's Limits › Static caps: "places, objects, kinds, files,
// total source bytes | as the host says"). Each counts what an author
// must read: a library the host has blessed costs nothing toward
// `kinds`, as it costs nothing toward the source and file caps, and the
// world is the root of the tree rather than an object or a place in it.
// A cap is refused at the first declaration past it, and a cap the host
// left unset bounds nothing.

import type { KindDeclaration, ObjectDeclaration } from '../syntax/ast.js';
import type { ComposedObject } from '../declare/objects.js';
import type { Diagnostics } from '../source/diagnostics.js';
import type { Span } from '../source/source.js';
import type { StaticCaps } from './limits.js';

/** What the three caps count, in the order the files were read. */
export interface Countable {
  /** The world's own kinds, and those of every usable library the host has not blessed. */
  readonly kinds: readonly KindDeclaration[];
  /**
   * The world's objects, whether or not they could be composed, each copy
   * of a kind's content among them, since each is an instance stored.
   */
  readonly objects: readonly ObjectDeclaration[];
  /**
   * The world's objects with their kinds, null where one could not be
   * composed; those whose kind holds actors are its places, wherever they
   * were placed.
   */
  readonly composed: readonly ComposedObject[];
}

/** How many of each a world has, as the bundle records them. */
export interface WorldCounts {
  readonly kinds: number;
  readonly objects: number;
  readonly places: number;
}

/** Count a world's kinds, objects and places, refusing each cap it is past. */
export function countWorld(
  countable: Countable,
  caps: StaticCaps,
  diagnostics: Diagnostics,
): WorldCounts {
  // A place is whatever may hold people (the spec's Places), however its
  // kind came to say so.
  const places = countable.composed.filter((object) => object.kind?.containsActors === true);
  const past = (
    spans: readonly Span[],
    cap: number | null,
    said: (count: number, cap: number) => string,
    remedy: string,
  ): void => {
    if (cap === null || spans.length <= cap) return;
    diagnostics.refuse(spans[cap]!, said(spans.length, cap), remedy);
  };
  past(
    countable.kinds.map((declared) => declared.name.at),
    caps.kinds,
    (count, cap) => `This world declares ${count} kinds, and ${cap} is as many as it may have.`,
    'Take some out, or use a library the host has blessed, whose kinds cost nothing.',
  );
  past(
    countable.objects.map((declared) => declared.name.at),
    caps.objects,
    (count, cap) => `This world declares ${count} objects, and ${cap} is as many as it may have.`,
    'Take some out, or let one object do the work of two.',
  );
  past(
    places.map((object) => object.declaration.name.at),
    caps.places,
    (count, cap) => `This world has ${count} places, and ${cap} is as many as it may have.`,
    'Take some out, or join two into one. A place is anything people can be inside: whatever holds `contains actors`.',
  );
  return {
    kinds: countable.kinds.length,
    objects: countable.objects.length,
    places: places.length,
  };
}
