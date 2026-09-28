// The world's `acted` line: what someone else typed, as a person watching
// over a shared console reads it ("Ines tries to take brass key."). It is
// no turn's effect and nobody in the world reads it; a host that plays
// several visitors from one console shows it to that console, rendered
// as a poll renders, drawing nothing.

import { boundObject, boundValue, type Evaluated } from '../runtime/evaluate.js';
import type { InstanceId, VisitKey } from '../runtime/ids.js';
import { nicknamesIn, type WorldState } from '../runtime/state.js';
import { pollTurn, type TurnHost } from '../runtime/turn.js';
import { renderFor } from './speech.js';

/**
 * The world's `acted` for `actor`'s `typed` line, as the visitor `reader`
 * reads it: its paragraphs, or null where the world composes no `acted`
 * or rendering it faulted.
 */
export function renderActed(
  state: WorldState,
  host: TurnHost,
  reader: VisitKey,
  actor: InstanceId,
  typed: string,
): readonly string[] | null {
  const passage = state.instances.get(state.world)?.kind.passages.get('acted');
  const readerId = state.visitors.get(reader)?.instance;
  if (passage === undefined || readerId === undefined) return null;
  const bindings = new Map<string, Evaluated>([
    ['actor', boundObject(actor)],
    ['reading', boundValue(typed)],
  ]);
  const nicknames = nicknamesIn(state);
  const polled = pollTurn(state, host, (turn) =>
    renderFor({ by: state.world, said: { passage }, bindings }, readerId, {
      ...turn,
      nicknames,
      draws: null,
      actor: readerId,
    }),
  );
  return polled.faulted ? null : polled.view;
}
