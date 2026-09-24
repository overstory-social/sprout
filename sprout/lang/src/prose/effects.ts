// A turn's effects, rendered (the spec's The runtime › Effects; Other
// people › What this costs; Chance › The seed). Each thing the turn said
// is rendered once for each of its readers, in the order said, and each
// reading is one effect carrying its words; a description is one effect
// to the one looking. What each reader reads is charged to their own
// output, so a crowd costs the host and never the one acting: only the
// turn's actor's output faults the turn (`output.ts`), so a tick or a wake
// never faults on it, and anyone else past the figure is cut short and
// reads nothing more. Every reader of one line reads the same draw, taken
// from the turn's stream after every draw its bodies made.

import type { Effect, EffectContext, Unrendered } from '../runtime/effects.js';
import type { InstanceId, VisitKey } from '../runtime/ids.js';
import { renderDescription } from './describe.js';
import { renderHeard, type Heard } from './heard.js';
import { LineDraws } from './line-draws.js';
import type { RenderContext } from './render.js';

/** `lines`, rendered for each reader in turn, as the effects the host is given. */
export function renderEffects(lines: readonly Unrendered[], context: EffectContext): Effect[] {
  const { state, catalogue, passes, budget, nicknames, actor } = context;
  const rendering: RenderContext = {
    actor,
    state,
    catalogue,
    passes,
    budget,
    nicknames,
    draws: new LineDraws(context.draws),
  };
  const effects: Effect[] = [];
  for (const one of lines) {
    if ('description' in one) {
      const { description } = one;
      const heard = renderDescription(description, rendering);
      effects.push(effectOf('described', description.of, heard, context));
      continue;
    }
    const { said } = one;
    for (const heard of renderHeard(said, rendering)) {
      effects.push(effectOf(said.effect, said.by, heard, context));
    }
  }
  return effects;
}

/** One reader's reading of a line, as an effect. */
function effectOf(
  kind: Effect['kind'],
  from: InstanceId,
  heard: Heard,
  context: EffectContext,
): Effect {
  return {
    kind,
    from,
    actor: context.actor,
    to: heard.reader,
    visit: visitOf(heard.reader, context.visits),
    paragraphs: heard.paragraphs,
  };
}

/** The visit that is `reader`: only a person reads, so a reader who is not one is the engine's defect. */
function visitOf(reader: InstanceId, visits: ReadonlyMap<InstanceId, VisitKey>): VisitKey {
  const visit = visits.get(reader);
  if (visit === undefined) throw new Error(`\`${reader}\` reads a line, and is not a visitor.`);
  return visit;
}
