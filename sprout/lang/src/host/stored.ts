// The persisted form of a world's state, as JSON (the spec's The runtime
// › State, and The host contract › Storage).
//
// The engine keeps, per instance, its id, how it was made, its container,
// its properties, its links, its pending wakes, its memory of each actor
// and when it last ticked; per visitor, the visit, the nickname, the
// instance and where they last stood; and a tombstone for every declared
// object destroyed, which is gone for good (the spec's Destroying), so
// its id is never made again. The stored form is the diff from the world
// a fresh load of the cartridge makes: an instance is written only where
// something about it differs from its declaration (a minted one always,
// with how it was made), a written record holds only the fields that
// differ, and a value is bare, since the kind fixes its type. What is
// left out is implied by the cartridge the save is keyed to, so the reader
// lays the records over a fresh load. `StoredWorldSchema` is what a host
// hands back; a store that fails it is a host defect, not the world's,
// and is thrown as `StoredStateUnreadable`.
//
// One serial counter per world numbers minted ids, arrivals and wakes,
// and times are whole host seconds. A committed turn's `StoredChanges`
// are what a store writes.

import { z } from 'zod';

import { DIRECTIONS, type Direction } from '../syntax/directions.js';
import { qualifiedName } from '../declare/enums.js';
import { showType, type ValueType } from '../declare/types.js';
import { idForm } from './ids.js';

/** A value as JSON holds it: a list is an array of its elements, and an extension's value the text it persists as. */
export type StoredValue = boolean | number | string | readonly StoredValue[];

/**
 * How a minted instance came to be: a visitor, a spawn of a kind named by
 * its qualified name, or a kind's content made with a spawned instance,
 * named by the kind whose body writes it and its path in that body. The
 * world and a declared object say how they were made by their id.
 */
export type StoredMade =
  | { readonly from: 'visitor' }
  | { readonly from: 'spawned'; readonly kind: string }
  | { readonly from: 'given'; readonly kind: string; readonly path: readonly string[] };

/** One pending wake: the serial it was asked under, and when it was asked and is due, in host seconds. */
export interface StoredWake {
  readonly serial: number;
  readonly askedAt: number;
  readonly dueAt: number;
}

/**
 * One instance as the diff from its declaration: its id, and then only the
 * fields that differ. A field left out is as a fresh load makes it: a
 * declared object stands where it was declared, holds its kind's defaults,
 * and has no links, wakes, memory or tick; a minted instance stands nowhere.
 */
export interface StoredInstance {
  readonly id: string;
  /** How a minted instance was made; never written for the world or a declared object. */
  readonly made?: StoredMade;
  /** Where it stands, where that is not where it was declared; left out for a visitor who is away. */
  readonly container?: string;
  /** The serial of its last arrival, where it has arrived anywhere. */
  readonly arrival?: number;
  /** The properties not at the instance's own default, each as its bare value. */
  readonly properties?: Readonly<Record<string, StoredValue>>;
  /** Each link's name, and the id of the place it leads to. */
  readonly links?: Readonly<Record<string, string>>;
  /** A list, because how many may be pending is a cap of the host's (the spec's Limits), not a rule of the language. */
  readonly wakes?: readonly StoredWake[];
  /** Actor id, then property, then value, for what is remembered other than the default. */
  readonly memory?: Readonly<Record<string, Readonly<Record<string, StoredValue>>>>;
  /** When it last ticked, in host seconds, where it has. */
  readonly lastTick?: number;
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

/** A stored value, checked: a boolean, a number, a string or a list of them. */
export const StoredValueSchema: z.ZodType<StoredValue> = z.lazy(() =>
  z.union([z.boolean(), z.number(), z.string(), z.array(StoredValueSchema)]),
);

const serial = z.number().int().min(1);
const seconds = z.number().int().min(0);

/**
 * One stored instance, checked on its own: which ids it names, and whether
 * `made` belongs on it, is checked only by `StoredWorldSchema`, against the
 * world it is stored in. What a store adapter validates each record it
 * reads back with.
 */
export const StoredInstanceSchema: z.ZodType<StoredInstance> = z.object({
  id: z.string(),
  made: z
    .discriminatedUnion('from', [
      z.object({ from: z.literal('visitor') }),
      z.object({ from: z.literal('spawned'), kind: z.string().min(1) }),
      z.object({
        from: z.literal('given'),
        kind: z.string().min(1),
        path: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).min(1),
      }),
    ])
    .optional(),
  container: z.string().optional(),
  arrival: serial.optional(),
  properties: z.record(z.string(), StoredValueSchema).optional(),
  links: z.record(z.string(), z.string()).optional(),
  wakes: z.array(z.object({ serial, askedAt: seconds, dueAt: seconds })).optional(),
  memory: z.record(z.string(), z.record(z.string(), StoredValueSchema)).optional(),
  lastTick: seconds.optional(),
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

/**
 * How an instance was made: the world's id and a declared path (the spec's
 * State: ids) say it themselves, and a minted id's record says it.
 */
export function madeFrom(instance: StoredInstance): string {
  if (instance.id.includes('#')) return instance.made?.from ?? 'minted';
  return instance.id.includes('.') ? 'declared' : 'world';
}

/** Where a declared object was declared: its id up to the last `.`, since the id is its path (the spec's State). */
export function declaredContainer(id: string): string {
  return id.slice(0, id.lastIndexOf('.'));
}

/** Where a record stands: where it says, where it was declared for a declared object that says nothing, or nowhere. */
export function containerOf(instance: StoredInstance): string | null {
  if (instance.container !== undefined) return instance.container;
  return madeFrom(instance) === 'declared' ? declaredContainer(instance.id) : null;
}

/**
 * A stored world, checked: every id is one of this world's forms, a minted
 * id says how its instance was made and a declared one does not, no serial
 * is past the world's, no id or visit is stored twice, visitor records and
 * the instances made for visitors pair one to one, and a tombstone is a
 * declared id that no instance is stored under or inside.
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
      if (form === 'minted' && instance.made === undefined) {
        issue(
          [...at, 'made'],
          'it should say how the instance was made: visitor, spawned or given.',
        );
      } else if (form !== null && form !== 'minted' && instance.made !== undefined) {
        issue([...at, 'made'], 'a declared id says how it was made; `made` is for a minted one.');
      }
      if (ids.has(instance.id)) issue([...at, 'id'], `\`${instance.id}\` is stored twice.`);
      ids.add(instance.id);
      if (instance.container !== undefined) anId([...at, 'container'], instance.container);
      if (instance.arrival !== undefined) issued([...at, 'arrival'], instance.arrival);
      for (const [name, to] of Object.entries(instance.links ?? {}))
        anId([...at, 'links', name], to);
      instance.wakes?.forEach((wake, w) => issued([...at, 'wakes', w, 'serial'], wake.serial));
      for (const actor of Object.keys(instance.memory ?? {})) anId([...at, 'memory', actor], actor);
    });

    // A visitor is one person and one instance: each record names an
    // instance made for a visitor, no two name the same one, and no such
    // instance is kept without the record that says whose it is.
    const made = new Map(stored.instances.map((instance) => [instance.id, madeFrom(instance)]));
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
      const container = containerOf(instance);
      if (tombstones.has(instance.id)) {
        issue(['instances', i, 'id'], `\`${instance.id}\` was destroyed, and is stored again.`);
      }
      if (container !== null && tombstones.has(container)) {
        issue(
          ['instances', i, 'container'],
          `\`${instance.id}\` is inside \`${container}\`, which was destroyed.`,
        );
      }
    });
    stored.instances.forEach((instance, i) => {
      if (madeFrom(instance) === 'visitor' && !named.has(instance.id)) {
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
 * A type's identity as the catalogue names it: `boolean`, `integer`,
 * `string`, an enum's qualified name, a list's element key in brackets,
 * or an extension's type as written, `media.Image`. An integer's range is
 * not part of it, as it is not part of a type's identity.
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
  /** Instance records in the stored form, each replacing the one stored under its id. */
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
