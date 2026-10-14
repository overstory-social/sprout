// The persisted form of a world's state, as JSON (the spec's The runtime
// › State, and The host contract › Storage).
//
// The engine keeps, per instance, its id, how it was made, its container,
// its properties, its links, its pending wakes, its memory of each actor
// and when it last ticked; per visitor, the visit, the nickname, the
// instance and where they last stood; and a tombstone for every declared
// object destroyed, which is gone for good (the spec's Destroying), so
// its id is never made again. `StoredWorldSchema` is what a host
// hands back; a store that fails it is a host defect, not the world's,
// and is thrown as `StoredStateUnreadable`.
//
// Every stored value carries the type key it was written under
// (`typeKey`), so a value is never reinterpreted under a type it was not
// written as; the engine reads one that no longer fits its type as the
// declared default, not clamped, and a list whole or not at all. One serial
// counter per world numbers minted ids, arrivals and wakes, and times
// are whole host seconds. A committed turn's `StoredChanges` are what a
// store writes.

import { z } from 'zod';

import { DIRECTIONS, type Direction } from '../declare/directions.js';
import { qualifiedName } from '../declare/enums.js';
import { showType, type ValueType } from '../declare/types.js';
import { idForm } from './ids.js';

/** A value as JSON holds it: a list is an array of its elements, and an extension's value the text it persists as. */
export type StoredValue = boolean | number | string | readonly StoredValue[];

/** A value with the type key it was written under, so a retyped property is never reinterpreted, even when the old value would fit the new type. */
export interface StoredProperty {
  readonly type: string;
  readonly value: StoredValue;
}

/**
 * How an instance came to be: the world itself, a declared object, a
 * visitor, a spawn of a kind named by its qualified name, or a kind's
 * content made with a spawned instance, named by the kind whose body
 * writes it and its path in that body.
 */
export type StoredMade =
  | { readonly from: 'world' }
  | { readonly from: 'declared' }
  | { readonly from: 'visitor' }
  | { readonly from: 'spawned'; readonly kind: string }
  | { readonly from: 'given'; readonly kind: string; readonly path: readonly string[] };

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
  readonly referents: readonly string[];
  readonly lastReading: StoredReading | null;
}

/** What one role of a stored reading is filled with: a thing, a set, a value, or a way out. */
export type StoredBound =
  | { readonly object: string }
  | { readonly set: readonly string[] }
  | { readonly value: string | number }
  | {
      readonly exit: {
        readonly direction: Direction | null;
        readonly label: string;
        readonly to: string;
      };
    };

/** A reading as a store keeps it: its verb by library and name, and what fills each role. */
export interface StoredReading {
  readonly verb: { readonly library: string; readonly name: string };
  readonly bindings: readonly (readonly [string, StoredBound])[];
}

export interface StoredWorld {
  readonly world: string;
  /** The last serial issued, 0 before the first. */
  readonly serial: number;
  readonly instances: readonly StoredInstance[];
  readonly visitors: readonly StoredVisitor[];
  /** The id of every declared object ever destroyed, in code-unit order: load never makes one again. */
  readonly tombstones: readonly string[];
}

const StoredValueSchema: z.ZodType<StoredValue> = z.lazy(() =>
  z.union([z.boolean(), z.number(), z.string(), z.array(StoredValueSchema)]),
);

/** A stored property, checked: a type key and a value of any stored shape. */
export const StoredPropertySchema: z.ZodType<StoredProperty> = z.object({
  type: z.string().min(1),
  value: StoredValueSchema,
});

const serial = z.number().int().min(1);
const seconds = z.number().int().min(0);

/**
 * One stored instance, checked on its own: which ids it names is checked
 * only by `StoredWorldSchema`, against the world it is stored in. What a
 * store adapter validates each record it reads back with.
 */
export const StoredInstanceSchema: z.ZodType<StoredInstance> = z.object({
  id: z.string(),
  made: z.discriminatedUnion('from', [
    z.object({ from: z.literal('world') }),
    z.object({ from: z.literal('declared') }),
    z.object({ from: z.literal('visitor') }),
    z.object({ from: z.literal('spawned'), kind: z.string().min(1) }),
    z.object({
      from: z.literal('given'),
      kind: z.string().min(1),
      path: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).min(1),
    }),
  ]),
  container: z.string().nullable(),
  arrival: serial.nullable(),
  properties: z.record(z.string(), StoredPropertySchema),
  links: z.record(z.string(), z.string()),
  wakes: z.array(z.object({ serial, askedAt: seconds, dueAt: seconds })),
  memory: z.record(z.string(), z.record(z.string(), StoredPropertySchema)),
  lastTick: seconds.nullable(),
});

/** One stored visitor, checked on its own, as `StoredInstanceSchema` is. */
export const StoredVisitorSchema: z.ZodType<StoredVisitor> = z.object({
  visit: z.string().min(1),
  nickname: z.string().min(1),
  instance: z.string(),
  lastPlace: z.string().nullable(),
  referents: z.array(z.string()),
  lastReading: z
    .object({
      verb: z.object({ library: z.string().min(1), name: z.string().min(1) }),
      bindings: z.array(
        z.tuple([
          z.string().min(1),
          z.union([
            z.object({ object: z.string() }),
            z.object({ set: z.array(z.string()) }),
            z.object({ value: z.union([z.string(), z.number().int()]) }),
            z.object({
              exit: z.object({
                direction: z.enum(DIRECTIONS).nullable(),
                label: z.string(),
                to: z.string(),
              }),
            }),
          ]),
        ]),
      ),
    })
    .nullable(),
});

/** Which id form each way of being made takes. */
const FORM_OF: Readonly<Record<StoredMade['from'], 'world' | 'declared' | 'minted'>> = {
  world: 'world',
  declared: 'declared',
  visitor: 'minted',
  spawned: 'minted',
  given: 'minted',
};

/**
 * A stored world, checked: every id is one of this world's forms and
 * agrees with how its instance was made, no serial is past the world's,
 * no id or visit is stored twice, visitor records and the instances
 * made for visitors pair one to one, and a tombstone is a declared id
 * that no instance is stored under or inside.
 */
export const StoredWorldSchema: z.ZodType<StoredWorld> = z
  .object({
    world: z.string().regex(/^[a-z][a-z0-9_]*$/),
    serial: z.number().int().min(0),
    instances: z.array(StoredInstanceSchema),
    visitors: z.array(StoredVisitorSchema),
    tombstones: z.array(z.string()),
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

    // A visitor is one person and one instance: each record names an
    // instance made for a visitor, no two name the same one, and no such
    // instance is kept without the record that says whose it is.
    const made = new Map(stored.instances.map((instance) => [instance.id, instance.made.from]));
    const visits = new Set<string>();
    const named = new Set<string>();
    stored.visitors.forEach((visitor, v) => {
      const at = ['visitors', v];
      if (visits.has(visitor.visit))
        issue([...at, 'visit'], `visit \`${visitor.visit}\` is stored twice.`);
      visits.add(visitor.visit);
      anId([...at, 'instance'], visitor.instance);
      const from = made.get(visitor.instance);
      if (from === undefined) {
        issue([...at, 'instance'], `\`${visitor.instance}\` is not a stored instance.`);
      } else if (from !== 'visitor') {
        issue(
          [...at, 'instance'],
          `\`${visitor.instance}\` is made from ${from}, and a visitor's instance is made from visitor.`,
        );
      }
      if (named.has(visitor.instance)) {
        issue([...at, 'instance'], `\`${visitor.instance}\` is named by two visitors.`);
      }
      named.add(visitor.instance);
      if (visitor.lastPlace !== null) anId([...at, 'lastPlace'], visitor.lastPlace);
      visitor.referents.forEach((id, r) => anId([...at, 'referents', r], id));
      visitor.lastReading?.bindings.forEach(([, bound], b) => {
        const path = [...at, 'lastReading', 'bindings', b, 1];
        if ('object' in bound) anId([...path, 'object'], bound.object);
        if ('set' in bound) bound.set.forEach((id, i) => anId([...path, 'set', i], id));
        if ('exit' in bound) anId([...path, 'exit', 'to'], bound.exit.to);
      });
    });
    // A tombstone is a declared object destroyed, and what it held went
    // with it, so nothing is stored under its id or inside it. A link, a
    // visitor's last place or what their pronouns name may still name it:
    // the absent rules read those.
    const tombstones = new Set<string>();
    stored.tombstones.forEach((id, t) => {
      const at = ['tombstones', t];
      if (idForm(stored.world, id) !== 'declared') {
        issue(at, `\`${id}\` is not a declared object's id in ${stored.world}.`);
      }
      if (tombstones.has(id)) issue(at, `\`${id}\` is a tombstone twice.`);
      tombstones.add(id);
    });
    stored.instances.forEach((instance, i) => {
      if (tombstones.has(instance.id)) {
        issue(['instances', i, 'id'], `\`${instance.id}\` was destroyed, and is stored again.`);
      }
      if (instance.container !== null && tombstones.has(instance.container)) {
        issue(
          ['instances', i, 'container'],
          `\`${instance.id}\` is inside \`${instance.container}\`, which was destroyed.`,
        );
      }
    });
    stored.instances.forEach((instance, i) => {
      if (instance.made.from === 'visitor' && !named.has(instance.id)) {
        issue(
          ['instances', i, 'made'],
          `\`${instance.id}\` is made from visitor, and no visitor is stored for it.`,
        );
      }
    });
  });

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

/**
 * A type's identity as stored state records it: `boolean`, `integer`,
 * `string`, an enum's qualified name, a list's element key in brackets,
 * or an extension's type as written, `media.Image`. An integer's range is not part of it, as it is not part of
 * a type's identity.
 */
export function typeKey(type: ValueType): string {
  switch (type.type) {
    case 'boolean':
    case 'integer':
    case 'string':
      return type.type;
    case 'symbol':
      return qualifiedName(type.of.library, type.of.name);
    case 'list':
      return `[${typeKey(type.element)}]`;
    case 'extension':
      return showType(type);
  }
}

/** What a store writes for one committed turn, in the stored form. */
export interface StoredChanges {
  /** The world's serial after the turn. */
  readonly serial: number;
  /** Instance records written whole, each replacing the one stored under its id. */
  readonly upsert: readonly StoredInstance[];
  /** The ids of instance records to delete. */
  readonly remove: readonly string[];
  /** Tombstones to add, kept for good. */
  readonly tombstones: readonly string[];
  /** Visitor records written whole, each replacing the one stored under its visit. */
  readonly visitors: readonly StoredVisitor[];
}

/** Strings in code-unit order, which is the same on every host: how stored state is sorted. */
export function codeUnitOrder(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
