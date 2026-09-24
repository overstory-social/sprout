// A turn's line, rendered once for each person who reads it (the spec's
// Other people › Who hears it, What this costs; Verbs › Acting). Each
// reader is given their own rendering, so a line that names them says
// "you" to them and their name to everyone else. A line an NPC says is
// heard as the NPC speaking, in the engine's fixed words, _the cat says
// "Miaow."_, and what it renders is charged to each reader's output, so a
// crowded room costs the host and never the one acting: a reader other
// than the actor whom it would take past theirs is left out (`output.ts`).

import type { InstanceId } from '../runtime/ids.js';
import type { Said } from '../runtime/reading.js';
import { objectWords } from './names.js';
import { charged } from './output.js';
import { capitalise } from './reflow.js';
import type { RenderContext } from './render.js';
import { renderFor } from './speech.js';

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
  for (const reader of said.to) {
    const paragraphs = renderFor(said, reader, context);
    if (paragraphs.length === 0) continue;
    if (said.speaker === null) {
      heard.push({ reader, paragraphs });
      continue;
    }
    const line = framed(said.speaker, paragraphs, reader, context);
    if (line !== null) heard.push({ reader, paragraphs: [line] });
  }
  return heard;
}

/**
 * An NPC's line as its hearers read it: the NPC, named for the reader,
 * saying the paragraphs as one quotation. Only the frame's own words are
 * charged here, and null where they do not fit someone other than the actor.
 */
function framed(
  speaker: InstanceId,
  paragraphs: readonly string[],
  reader: InstanceId,
  context: RenderContext,
): string | null {
  const words = paragraphs.join(' ');
  const line = capitalise(`${objectWords(speaker, reader, context)} says "${words}"`);
  return charged(context, reader, [...line].length - [...words].length) ? line : null;
}
