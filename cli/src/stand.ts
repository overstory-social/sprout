import {
  arrivalTurn,
  catalogueOf,
  declaredPathOf,
  DEFAULT_LIMITS,
  Draft,
  initialState,
  isPlace,
  newInstance,
  nicknameRefusal,
  readerOf,
  renderEffects,
  visitKey,
  type Bundle,
  type Catalogue,
  type InstanceId,
  type TurnHost,
  type VisitKey,
  type WorldState,
} from '@overstory/sprout/lang';

// One visitor standing in a freshly loaded world, for the inspectors to
// look through (`sprout parse` and `sprout view`). The world is as it
// loads, nothing yet having happened in it, under the host's default
// limits and no clock. The visitor comes in by an arrival turn, as a host
// admits anyone (the spec's The host contract › Admission and identity):
// at the place visitors arrive at, or, named with `--at`, at another
// place as a returning visitor comes back to where they last stood, so
// that place's `accept` is asked as it would be.

/** The visitor's nickname where none is given. */
export const INSPECTOR = 'Inspector';

/** A visitor standing somewhere in a world, and what it is run under. */
export interface Standing {
  readonly state: WorldState;
  readonly host: TurnHost;
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

/** What `bundle` says about instances, read under the host's default caps. */
export function catalogueFor(bundle: Bundle): Catalogue {
  return catalogueOf(bundle, DEFAULT_LIMITS.caps);
}

/**
 * A visitor admitted to `bundle`'s world, standing where `options.at`
 * names or where visitors arrive. Anything that keeps them from standing
 * there is thrown, in words that say what to write instead.
 */
export function standIn(bundle: Bundle, options: StandOptions = {}): Standing {
  const catalogue = catalogueFor(bundle);
  const host: TurnHost = { catalogue, budgets: DEFAULT_LIMITS.budgets, render: renderEffects };
  const loaded = initialState(catalogue);
  const world = catalogue.world;
  const visit = visitKey('inspector');
  const nickname = options.nickname ?? INSPECTOR;

  const unadmitted = nicknameRefusal(loaded, catalogue, host.budgets, visit, nickname);
  if (unadmitted !== null) {
    throw new Error(`${unadmitted.words} Give one with --as.`);
  }
  const wanted = options.at === undefined ? null : placeNamed(loaded, catalogue, options.at);

  let before = loaded;
  if (wanted !== null) {
    // A returning visitor, away, whose last place is the one named.
    const draft = new Draft(loaded);
    const instance = draft.mint();
    const kind = catalogue.visitorKind;
    if (kind === null) throw new Error('This world has nothing for a visitor to be made of.');
    draft.add(newInstance(instance, { from: 'visitor' }, kind, null, null, catalogue.caps));
    draft.putVisitor({ visit, nickname, instance, lastPlace: wanted });
    before = draft.commit().state;
  }

  const arrived = arrivalTurn(before, host, { visit, nickname, seed: 0, mayHold: null, now: 0 });
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
  const { state } = arrived;
  const actor = arrived.value.instance;
  const place = arrived.value.entered.place;
  if (wanted !== null && place !== wanted) {
    throw new Error(
      `\`${options.at}\` does not let a visitor in, so they came in at \`${pathOf(world, place)}\`: ` +
        `its \`accept\`, or a bound on how many may stand there, turned them away.`,
    );
  }
  return { state, host, visit, actor, place };
}

/** The declared place `written` names, as a path under the world; thrown, listing every place in declared order, where it names none. */
function placeNamed(state: WorldState, catalogue: Catalogue, written: string): InstanceId {
  const reader = readerOf(state);
  const { world } = catalogue;
  const places = [...catalogue.declared.values()]
    .sort((a, b) => a.rank - b.rank)
    .map((entry) => entry.id)
    .filter((id) => isPlace(reader, id));
  const found = places.find((id) => pathOf(world, id) === written);
  if (found !== undefined) return found;
  const names = places.map((id) => pathOf(world, id)).join(', ');
  throw new Error(
    `\`${written}\` is not a place in ${world}, so nobody can stand there. ` +
      `After --at, write one of its places as the world's body names it: ${names}.`,
  );
}
