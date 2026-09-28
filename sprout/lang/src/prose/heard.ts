// A turn's line, rendered once for each person who reads it (the spec's
// Other people › Who hears it, What this costs; Verbs › Acting). Each
// reader is given their own rendering, so a line that names them says
// "you" to them and their name to everyone else. A line an NPC says is
// heard as the NPC speaking, through the engine's `npc_says`, _the cat
// says "Miaow."_, and what it renders is charged to each reader's output,
// so a crowded room costs the host and never the one acting: a reader
// other than the actor whom it would take past theirs is left out
// (`output.ts`).

import { engineSaid } from '../runtime/engine-lines.js';
import { boundObject, boundValue } from '../runtime/evaluate.js';
import type { InstanceId } from '../runtime/ids.js';
import type { Said } from '../runtime/reading.js';
import { charged } from './output.js';
import type { RenderContext } from './render.js';
import { renderedFor, renderFor, type Line } from './speech.js';

/** What one reader reads of a line: its paragraphs, as they render for them. */
export interface Heard {
  readonly reader: InstanceId;
  readonly paragraphs: readonly string[];
}

/**
 * `said` for each of its readers, in the order it names them. A reader
 * for whom it renders nothing reads nothing and is left out.
 */
export function renderHeard(said: Said, context: RenderContext): Heard[] {
  const heard: Heard[] = [];
  const frame = said.speaker === null ? null : npcSays(said.speaker, context);
  for (const reader of said.to) {
    if (frame === null) {
      const paragraphs = renderFor(said, reader, context);
      if (paragraphs.length > 0) heard.push({ reader, paragraphs });
      continue;
    }
    const line = framed(said, frame, reader, context);
    if (line !== null) heard.push({ reader, paragraphs: [line] });
  }
  return heard;
}

/** The engine's `npc_says` for `speaker`, with `actor` bound: what frames each line it says. */
function npcSays(speaker: InstanceId, context: RenderContext): Line {
  const place = context.state.instance(speaker)?.container ?? null;
  return {
    ...engineSaid(context.state, 'npc_says', speaker, place),
    bindings: new Map([['actor', boundObject(speaker)]]),
  };
}

/**
 * An NPC's line as `reader` reads it: `said`, its paragraphs as one, as
 * the `words` of `frame`, which every reader draws alike. The whole line
 * is charged, and null where it renders nothing or does not fit someone
 * other than the actor.
 */
function framed(
  said: Said,
  frame: Line,
  reader: InstanceId,
  context: RenderContext,
): string | null {
  const paragraphs = renderedFor(said, reader, context);
  if (paragraphs.length === 0) return null;
  const words = boundValue(paragraphs.join(' '));
  const bindings = new Map([...frame.bindings, ['words', words]]);
  const line = renderedFor({ ...frame, bindings }, reader, context, frame).join(' ');
  if (line === '') return null;
  return charged(context, reader, [...line].length) ? line : null;
}
