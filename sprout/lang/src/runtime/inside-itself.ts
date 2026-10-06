// What an offer can tell of its move without running it (the spec's The
// runtime › The view; Movement and consent › After the move). A poll runs
// no `do`, so it reads them: the first `move` written directly in a `do`
// the reading runs, in the effect pass's order, between names that play's
// frame binds, is the first move the reading is sure to propose with the
// tree as it stands, and where it would put a thing inside itself the
// offer is greyed with the engine's `inside_itself`, as the move would be
// refused.

import type { Statement } from '../syntax/ast.js';
import { engineSaid } from './engine-lines.js';
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
import { boundObject, type Frame } from './evaluate.js';

/**
 * The engine's `inside_itself` where the reading's first sure move would
 * put a thing inside itself, said as the move would say it; null where it
 * would not, or where no `move` is written directly in its `do`s.
 */
export function insideItselfOf(reading: Reading, context: ConsentContext): PermitRefusal | null {
  const { state } = context;
  for (const participant of participantsOf(reading)) {
    const self = state.instance(participant.id);
    if (self === undefined) continue;
    for (const play of playsFor(reading, participant, self)) {
      const move = play.declaration.do?.statements.find(isMove);
      if (move === undefined) continue;
      const frame = frameFor(reading, participant, play, state, context);
      const item = named(move.thing.parts, frame);
      const to = named(move.destination.parts, frame);
      if (item === null || to === null || item === state.world || !within(state, to, item)) {
        return null;
      }
      const standing = state.instance(participant.id)?.container ?? null;
      return {
        role: participant.role,
        origin: null,
        ...engineSaid(state, 'inside_itself', participant.id, standing),
        bindings: new Map([['item', boundObject(item)]]),
      };
    }
  }
  return null;
}

function isMove(statement: Statement): statement is Extract<Statement, { kind: 'move' }> {
  return statement.kind === 'move';
}

/** The object a one-word path names in `frame`: `self` or a name it binds to an object; null otherwise. */
function named(parts: readonly { readonly text: string }[], frame: Frame): InstanceId | null {
  const [only, ...rest] = parts;
  if (only === undefined || rest.length > 0) return null;
  if (only.text === 'self') return frame.self;
  const bound = frame.bindings.get(only.text);
  return bound?.binds === 'object' ? bound.id : null;
}
