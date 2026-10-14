import {
  declaredPathOf,
  mintedId,
  visitKey,
  type Catalogue,
  type CommandHost,
  type InstanceId,
  type VisitKey,
} from '@overstory/sprout/lang';
import { applyChanges, emptyState, type Engine, type StoredState } from '@overstory/sprout/core';

import { engineFor, hostFor, type PlayableWorld } from './engine.js';

// One visitor standing in a freshly loaded world, for the inspectors to
// look through (`sprout parse` and `sprout view`). The world is as it loads, nothing yet having happened in it,
// under the host's default limits and no clock. The visitor comes in by an
// arrival turn, as a host admits anyone (the spec's The host contract ›
// Admission and identity): at the place visitors arrive at, or, named with
// `--at`, at another place as a returning visitor comes back to where they
// last stood, so that place's `accept` is asked as it would be.
// `seatReturning` is the shared machinery for that, reused by `sprout
// play`'s interactive admission over a world already running its own
// turns.

/** The visitor's nickname where none is given. */
export const INSPECTOR = 'Inspector';

/** A visitor standing somewhere in a world: the world as a store would hold it, the engine and host it runs under, and who and where they are. */
export interface Standing {
  readonly stored: StoredState;
  readonly engine: Engine;
  readonly host: CommandHost;
  readonly visit: VisitKey;
  readonly actor: InstanceId;
  readonly place: InstanceId;
}

/** Where to stand, by a place's path under the world, and the nickname to stand there as. */
export interface StandOptions {
  readonly at?: string;
  readonly nickname?: string;
}

/** An id as an author writes it in the world's body: its path under the world, or the id itself. */
export function pathOf(world: InstanceId, id: InstanceId): string {
  const path = declaredPathOf(world, id);
  return path === null || path.length === 0 ? id : path.join('.');
}

/**
 * A visitor admitted to `playable`, standing
 * where `options.at` names or where visitors arrive. Anything that keeps
 * them from standing there is thrown, in words that say what to write
 * instead.
 */
export function standIn(playable: PlayableWorld, options: StandOptions = {}): Standing {
  const host = hostFor(playable);
  const running = engineFor(playable, host);
  const { catalogue } = host;
  const world = catalogue.world;
  const visit = visitKey('inspector');
  const nickname = options.nickname ?? INSPECTOR;

  const unadmitted = running.nicknameRefusal(emptyState(), visit, nickname);
  if (unadmitted !== null) {
    throw new Error(`${unadmitted.words} Give one with --as.`);
  }
  const { before, wanted } = seatReturning(emptyState(), catalogue, options.at, visit, nickname);

  const step = running.arrival(before, { visit, nickname, seed: 0, mayHold: null, now: 0 });
  const arrived = step.turn;
  if (!arrived.committed) {
    if ('closed' in arrived) {
      throw new Error(
        `This world admits no one (${arrived.closed.reason}), so nobody stands in it.`,
      );
    }
    if ('refused' in arrived) {
      const words = arrived.effects.flatMap((effect) => effect.paragraphs).join(' ');
      throw new Error(`A visitor arriving is turned away: ${words}`);
    }
    const { fault } = arrived;
    throw new Error(`A visitor's arrival faulted, ${fault.name}: ${fault.detail}`);
  }
  const stored = step.changes === null ? before : applyChanges(before, step.changes);
  running.landed?.(stored);
  const standing = running.standing(stored, visit);
  const actor = stored.visitors.find((one) => one.visit === visit)?.instance as InstanceId;
  if (standing === null) throw new Error('A visitor was admitted and stands nowhere.');
  const place = standing.place.id;
  if (wanted !== null && place !== wanted) {
    throw seatingMismatch(world, options.at!, place);
  }
  return { stored, engine: running, host, visit, actor, place };
}

/**
 * `stored`, with `nickname` seated as a returning visitor to `at`'s place,
 * so their arrival asks that place's `accept` and crowd bound as a
 * returning visitor's would; unchanged, with no place wanted, where `at`
 * is undefined. The visitor's record is written as a store keeps one, its
 * instance at its kind's defaults, which every engine reads in place of
 * a property it is not given. Thrown, listing every place, where `at`
 * names none.
 */
export function seatReturning(
  stored: StoredState,
  catalogue: Catalogue,
  at: string | undefined,
  visit: VisitKey,
  nickname: string,
): { before: StoredState; wanted: InstanceId | null } {
  if (at === undefined) return { before: stored, wanted: null };
  const wanted = placeNamed(stored, catalogue, at);
  if (catalogue.visitorKind === null) {
    throw new Error('This world has nothing for a visitor to be made of.');
  }
  const serial = stored.serial + 1;
  const instance = mintedId(catalogue.world, serial);
  const before = applyChanges(stored, {
    serial,
    upsert: [
      {
        id: instance,
        made: { from: 'visitor' },
        container: null,
        arrival: null,
        properties: {},
        links: {},
        wakes: [],
        memory: {},
        lastTick: null,
      },
    ],
    remove: [],
    tombstones: [],
    visitors: [{ visit, nickname, instance, lastPlace: wanted, referents: [], lastReading: null }],
  });
  return { before, wanted };
}

/** Thrown where `--at <at>` did not seat a visitor at `wanted`, but at `place` instead. */
export function seatingMismatch(world: InstanceId, at: string, place: InstanceId): Error {
  return new Error(
    `\`${at}\` does not let a visitor in, so they came in at \`${pathOf(world, place)}\`: ` +
      `its \`accept\`, or a bound on how many may stand there, turned them away.`,
  );
}

/**
 * The declared place `written` names, as a path under the world: a
 * declared object whose kind holds people, never destroyed. Thrown,
 * listing every place in declared order, where it names none.
 */
function placeNamed(stored: StoredState, catalogue: Catalogue, written: string): InstanceId {
  const { world } = catalogue;
  const places = [...catalogue.declared.values()]
    .sort((a, b) => a.rank - b.rank)
    .filter(
      (entry) =>
        entry.id !== world &&
        entry.kind?.containsActors === true &&
        !stored.tombstones.includes(entry.id),
    )
    .map((entry) => entry.id);
  const found = places.find((id) => pathOf(world, id) === written);
  if (found !== undefined) return found;
  const names = places.map((id) => pathOf(world, id)).join(', ');
  throw new Error(
    `\`${written}\` is not a place in ${world}, so nobody can stand there. ` +
      `After --at, write one of its places as the world's body names it: ${names}.`,
  );
}
