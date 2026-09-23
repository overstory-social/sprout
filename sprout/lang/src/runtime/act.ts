// The reading an `act` builds (the spec's Verbs › Acting; Set roles;
// Limits › Runtime budgets). `self` is the actor, and each role named is
// filled with what its binding evaluated to: a thing, a set of things, or
// a value, as the role takes it, one thing standing for a set of one in a
// role marked `many`. Running the reading is `reading.ts`'s.
//
// An NPC is governed by every rule that governs a person, and a person
// names only what is in range; so every thing an `act` names must be live
// and in the actor's range, or the turn faults, as a `move` of something
// out of range does. The walk is charged to steps like any other.

import type { ResolvedVerb } from '../declare/verbs.js';
import type { Budget } from './budget.js';
import type { Catalogue } from './catalogue.js';
import type { Draft } from './draft.js';
import type { Evaluated } from './evaluate.js';
import type { InstanceId } from './ids.js';
import { isLive, liveTree } from './live.js';
import { reaches, type PassRule } from './range.js';
import type { Bound, Reading } from './reading.js';

/** One `act` as its body evaluated it: the verb as written, where it was written, and each role's filler. */
export interface Performed {
  readonly verb: string;
  /** The library whose kind wrote the body, which a verb's bare name is reached from. */
  readonly library: string;
  readonly roles: ReadonlyMap<string, Evaluated>;
}

/** What building a reading reads: the turn's draft, the verbs and pass rules, and the meter. */
export interface ActContext {
  readonly draft: Draft;
  readonly catalogue: Catalogue;
  readonly passes: PassRule<InstanceId>;
  readonly budget: Budget;
}

/**
 * An `act` that could not be performed, as a `MoveFault` is: thrown,
 * because the turn cannot do what it was asked, and turned by B34 into
 * the world's `fault` passage. The detail names the object by its id, for
 * the log and the host.
 */
export class ActFault extends Error {
  constructor(
    /** The thing named that is gone or out of the actor's range. */
    readonly object: InstanceId,
    detail: string,
  ) {
    super(detail);
    this.name = 'ActFault';
  }
}

/** The reading `actor` performs by `performed`, every thing it names checked live and in range. */
export function readingOfAct(
  performed: Performed,
  actor: InstanceId,
  context: ActContext,
): Reading {
  const verb = context.catalogue.verbs.unqualified(performed.verb, performed.library);
  if (verb === null) {
    throw new Error(
      `\`act ${performed.verb}\` reached the runtime, and no verb of that name is in reach; the checker refuses it.`,
    );
  }
  const range = { tree: liveTree(context.draft), passes: context.passes, budget: context.budget };
  const inRange = (id: InstanceId): InstanceId => {
    if (!isLive(context.draft, id) || !reaches(range, actor, id, 'any')) {
      throw new ActFault(
        id,
        `\`${id}\` is out of range of \`${actor}\`, so \`${verb.name}\` could not be performed with it.`,
      );
    }
    return id;
  };
  const bindings = new Map<string, Bound>();
  for (const [role, evaluated] of performed.roles) {
    bindings.set(role, bound(verb, role, evaluated, inRange));
  }
  return { verb, actor, bindings };
}

/** What fills one role, as the role takes it. */
function bound(
  verb: ResolvedVerb,
  name: string,
  evaluated: Evaluated,
  inRange: (id: InstanceId) => InstanceId,
): Bound {
  const role = verb.roles.find((one) => one.name === name);
  if (role === undefined) {
    throw new Error(`\`act ${verb.name}\` names \`${name}\`, which it does not declare.`);
  }
  switch (evaluated.binds) {
    case 'value':
      return { value: evaluated.value };
    case 'object':
      return role.many ? { set: [inRange(evaluated.id)] } : { object: inRange(evaluated.id) };
    case 'set':
      if (!role.many) throw new Error(`a set filled \`${name}\`, which is not marked \`many\`.`);
      return { set: evaluated.ids.map(inRange) };
  }
}
