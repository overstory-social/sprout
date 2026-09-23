// The persisted form of a world's state, as JSON (the spec's The runtime
// › State, and The host contract › Storage).
//
// The engine keeps, per instance, its id, how it was made, its container,
// its properties, its links, its pending wakes, its memory of each actor
// and when it last ticked; per visitor, the visit, the nickname, the
// instance and where they last stood. `StoredWorldSchema` is what a host
// hands back; a store that fails it is a host defect, not the world's,
// and is thrown as `StoredStateUnreadable`.
//
// Every stored value carries the type key it was written under, so a
// value is never reinterpreted under a type it was not written as. A
// value that no longer fits its type falls to the declared default and
// is not clamped; a list decodes whole or defaults whole. One serial
// counter per world numbers minted ids, arrivals and wakes, and times
// are whole host seconds.

import { z } from 'zod';

import type { StaticCaps } from '../bundle/limits.js';
import type { ValueType } from '../declare/types.js';
import { idForm } from './ids.js';
import { SproutList } from './lists.js';
import { fits, typeKey, type Value } from './values.js';

/** A value as JSON holds it: a list is an array of its elements. */
export type StoredValue = boolean | number | string | readonly StoredValue[];

/** A value with the type key it was written under, so a retyped property is never reinterpreted, even when the old value would fit the new type. */
export interface StoredProperty {
  readonly type: string;
  readonly value: StoredValue;
}

/** How an instance came to be: the world itself, a declared object, a visitor, or a spawn of a kind named by its qualified name. */
export type StoredMade =
  | { readonly from: 'world' }
  | { readonly from: 'declared' }
  | { readonly from: 'visitor' }
  | { readonly from: 'spawned'; readonly kind: string };

/** One pending wake: the serial it was asked under, and when it was asked and is due, in host seconds. */
export interface StoredWake {
  readonly serial: number;
  readonly askedAt: number;
  readonly dueAt: number;
}

export interface StoredInstance {
  readonly id: string;
  readonly made: StoredMade;
  /** Null for the world, and for a visitor who is away. */
  readonly container: string | null;
  /** The serial of its last arrival; null for a declared object still where it was declared. */
  readonly arrival: number | null;
  readonly properties: Readonly<Record<string, StoredProperty>>;
  /** Each link's name, and the id of the place it leads to. */
  readonly links: Readonly<Record<string, string>>;
  /** A list, because how many may be pending is a cap of the host's (the spec's Limits), not a rule of the language. */
  readonly wakes: readonly StoredWake[];
  /** Actor id, then property, then value. */
  readonly memory: Readonly<Record<string, Readonly<Record<string, StoredProperty>>>>;
  /**
   * When it last ticked, in host seconds; null if it never has. The spec
   * keeps this for every place; one record shape serves every instance,
   * and it stays null for anything that is not a place.
   */
  readonly lastTick: number | null;
}

export interface StoredVisitor {
  readonly visit: string;
  readonly nickname: string;
  readonly instance: string;
  readonly lastPlace: string | null;
}

export interface StoredWorld {
  readonly world: string;
  /** The last serial issued, 0 before the first. */
  readonly serial: number;
  readonly instances: readonly StoredInstance[];
  readonly visitors: readonly StoredVisitor[];
}

const StoredValueSchema: z.ZodType<StoredValue> = z.lazy(() =>
  z.union([z.boolean(), z.number(), z.string(), z.array(StoredValueSchema)]),
);

const StoredPropertySchema = z.object({ type: z.string().min(1), value: StoredValueSchema });

const serial = z.number().int().min(1);
const seconds = z.number().int().min(0);

const StoredInstanceSchema = z.object({
  id: z.string(),
  made: z.discriminatedUnion('from', [
    z.object({ from: z.literal('world') }),
    z.object({ from: z.literal('declared') }),
    z.object({ from: z.literal('visitor') }),
    z.object({ from: z.literal('spawned'), kind: z.string().min(1) }),
  ]),
  container: z.string().nullable(),
  arrival: serial.nullable(),
  properties: z.record(z.string(), StoredPropertySchema),
  links: z.record(z.string(), z.string()),
  wakes: z.array(z.object({ serial, askedAt: seconds, dueAt: seconds })),
  memory: z.record(z.string(), z.record(z.string(), StoredPropertySchema)),
  lastTick: seconds.nullable(),
});

const StoredVisitorSchema = z.object({
  visit: z.string().min(1),
  nickname: z.string().min(1),
  instance: z.string(),
  lastPlace: z.string().nullable(),
});

/** Which id form each way of being made takes. */
const FORM_OF: Readonly<Record<StoredMade['from'], 'world' | 'declared' | 'minted'>> = {
  world: 'world',
  declared: 'declared',
  visitor: 'minted',
  spawned: 'minted',
};

/**
 * A stored world, checked: every id is one of this world's forms and
 * agrees with how its instance was made, no serial is past the world's,
 * and no id or visit is stored twice.
 */
export const StoredWorldSchema: z.ZodType<StoredWorld> = z
  .object({
    world: z.string().regex(/^[a-z][a-z0-9_]*$/),
    serial: z.number().int().min(0),
    instances: z.array(StoredInstanceSchema),
    visitors: z.array(StoredVisitorSchema),
  })
  .superRefine((stored, context) => {
    const issue = (path: (string | number)[], message: string) =>
      context.addIssue({ code: 'custom', path, message });
    const anId = (path: (string | number)[], id: string) => {
      const form = idForm(stored.world, id);
      if (form === null) issue(path, `\`${id}\` is not an id in ${stored.world}.`);
      else if (form === 'minted' && Number(id.slice(stored.world.length + 1)) > stored.serial) {
        issue(
          path,
          `\`${id}\` was minted past the world's serial, ${stored.world}#${stored.serial}.`,
        );
      }
    };
    const issued = (path: (string | number)[], n: number) => {
      if (n > stored.serial)
        issue(path, `serial ${n} is past the world's serial, ${stored.serial}.`);
    };

    const ids = new Set<string>();
    stored.instances.forEach((instance, i) => {
      const at = ['instances', i];
      anId([...at, 'id'], instance.id);
      const form = idForm(stored.world, instance.id);
      const wants = FORM_OF[instance.made.from];
      if (form !== null && form !== wants) {
        issue(
          [...at, 'made'],
          `\`${instance.id}\` is a ${form} id, and made from ${instance.made.from} takes a ${wants} one.`,
        );
      }
      if (ids.has(instance.id)) issue([...at, 'id'], `\`${instance.id}\` is stored twice.`);
      ids.add(instance.id);
      if (instance.container !== null) anId([...at, 'container'], instance.container);
      if (instance.arrival !== null) issued([...at, 'arrival'], instance.arrival);
      for (const [name, to] of Object.entries(instance.links)) anId([...at, 'links', name], to);
      instance.wakes.forEach((wake, w) => issued([...at, 'wakes', w, 'serial'], wake.serial));
      for (const actor of Object.keys(instance.memory)) anId([...at, 'memory', actor], actor);
    });

    const visits = new Set<string>();
    stored.visitors.forEach((visitor, v) => {
      const at = ['visitors', v];
      if (visits.has(visitor.visit))
        issue([...at, 'visit'], `visit \`${visitor.visit}\` is stored twice.`);
      visits.add(visitor.visit);
      anId([...at, 'instance'], visitor.instance);
      if (visitor.lastPlace !== null) anId([...at, 'lastPlace'], visitor.lastPlace);
    });
  });

/** A value as stored, under the key of the type it is written as. */
export function encodeValue(type: ValueType, value: Value): StoredProperty {
  return { type: typeKey(type), value: toStored(value) };
}

function toStored(value: Value): StoredValue {
  return value instanceof SproutList ? value.elements.map(toStored) : value;
}

/** A stored value read back under the type now declared, or why it falls to the default. */
export type Decoded =
  | { readonly fits: true; readonly value: Value }
  | { readonly fits: false; readonly why: 'retyped' | 'no-longer-fits' };

/**
 * Read a stored value under the type now declared: a different type key
 * is `retyped`, whether or not the value would fit; the same key with a
 * value that does not fit now (a narrowed range, a removed option, a
 * list past the host's cap or with any misfit element) is `no-longer-fits`.
 */
export function decodeValue(type: ValueType, stored: StoredProperty, caps: StaticCaps): Decoded {
  if (stored.type !== typeKey(type)) return { fits: false, why: 'retyped' };
  const value = fromStored(type, stored.value, caps);
  if (value === null || !fits(type, value, caps)) return { fits: false, why: 'no-longer-fits' };
  return { fits: true, value };
}

/** A stored value as a run-time one, or null when its shape is not the type's. */
function fromStored(type: ValueType, stored: StoredValue, caps: StaticCaps): Value | null {
  if (type.type !== 'list') return Array.isArray(stored) ? null : (stored as Value);
  if (!Array.isArray(stored) || stored.length > caps.listElements) return null;
  const elements: Value[] = [];
  for (const element of stored as readonly StoredValue[]) {
    const value = fromStored(type.element, element, caps);
    if (value === null) return null;
    elements.push(value);
  }
  const list = SproutList.of(type.element, elements, caps);
  // A list holds no duplicates, so a stored one that repeats an element
  // was never a list of this type.
  return list.count === elements.length ? list : null;
}

/** Stored state the schema refuses: the host's defect, not the world's. Carries zod's message. */
export class StoredStateUnreadable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoredStateUnreadable';
  }
}

/** Parse a stored world, or throw `StoredStateUnreadable`. */
export function readStoredWorld(input: unknown): StoredWorld {
  const result = StoredWorldSchema.safeParse(input);
  if (!result.success) throw new StoredStateUnreadable(z.prettifyError(result.error));
  return result.data;
}
