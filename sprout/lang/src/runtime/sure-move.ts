// What an offer can tell of its move without running it (the spec's The
// runtime › The view; Movement and consent › After the move). A poll runs
// no `do`, so it reads them: the first `move` written directly in a `do`,
// between names that play's frame binds, is the move it is sure to
// propose. Read across a reading's plays in the effect pass's order, it
// greys an offer that would put a thing inside itself with the engine's
// `inside_itself`; read in the actor's own plays, it says which roles move
// their filler, which the view never fills with the actor's own place.
// Each play read is a step, and each container climbed another.

import { ACTOR_ROLE } from '../declare/roles.js';
import type { ResolvedRole, ResolvedVerb } from '../declare/verbs.js';
import type { Block, MoveStatement, ObjectPath, Statement } from '../syntax/ast.js';
import type { Budget } from './budget.js';
import { engineSaid } from './engine-lines.js';
import { boundObject, type Frame } from './evaluate.js';
import type { InstanceId } from './ids.js';
import { within } from './move.js';
import {
  frameFor,
  participantsOf,
  playsFor,
  type ConsentContext,
  type PermitRefusal,
  type Reading,
} from './reading.js';
import type { Instance } from './state.js';

/**
 * The engine's `inside_itself` where the reading's first sure move would
 * put a thing inside itself, said as the move would say it; null where it
 * would not, or where no `move` is written directly in its `do`s.
 */
export function insideItselfOf(reading: Reading, context: ConsentContext): PermitRefusal | null {
  const { state, budget } = context;
  for (const participant of participantsOf(reading)) {
    const self = state.instance(participant.id);
    if (self === undefined) continue;
    for (const play of playsFor(reading, participant, self)) {
      budget.spend();
      const move = sureMove(play.declaration.do);
      if (move === null) continue;
      const frame = frameFor(reading, participant, play, state, context);
      const item = named(move.thing, frame);
      const to = named(move.destination, frame);
      if (item === null || to === null || item === state.world) return null;
      if (!within(state, to, item, budget)) return null;
      return {
        role: participant.role,
        origin: null,
        ...engineSaid(state, 'inside_itself', participant.id, self.container),
        bindings: new Map([['item', boundObject(item)]]),
      };
    }
  }
  return null;
}

/**
 * Whether `actor`'s own part in `verb` moves what fills `role`: the first
 * sure move of one of its plays moves the role's name.
 */
export function movesItsFiller(
  verb: ResolvedVerb,
  role: ResolvedRole,
  actor: Instance,
  budget: Budget,
): boolean {
  const reading: Reading = { verb, actor: actor.id, bindings: new Map() };
  return playsFor(reading, { id: actor.id, role: ACTOR_ROLE }, actor).some((play) => {
    budget.spend();
    const [only, ...rest] = sureMove(play.declaration.do)?.thing.parts ?? [];
    return only?.text === role.name && rest.length === 0;
  });
}

/** The first `move` written directly in `body`; null where there is none. */
function sureMove(body: Block | null): MoveStatement | null {
  return body?.statements.find(isMove) ?? null;
}

function isMove(statement: Statement): statement is MoveStatement {
  return statement.kind === 'move';
}

/** The object a one-word path names in `frame`: `self` or a name it binds to an object; null otherwise. */
function named(path: ObjectPath, frame: Frame): InstanceId | null {
  const [only, ...rest] = path.parts;
  if (only === undefined || rest.length > 0) return null;
  if (only.text === 'self') return frame.self;
  const bound = frame.bindings.get(only.text);
  return bound?.binds === 'object' ? bound.id : null;
}
