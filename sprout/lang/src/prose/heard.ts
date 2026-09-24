// A turn's line, rendered once for each person who reads it (the spec's
// Other people › Who hears it, What this costs; Verbs › Acting). Each
// reader is given their own rendering, so a line that names them says
// "you" to them and their name to everyone else. A line an NPC says is
// heard as the NPC speaking, in the engine's fixed words, _the cat says
// "Miaow."_, and what it renders is charged to each reader's output, so a
// crowded room costs the host and never the one acting.

import type { InstanceId } from '../runtime/ids.js';
import type { Said } from '../runtime/reading.js';
import { objectWords } from './names.js';
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
    heard.push({
      reader,
      paragraphs:
        said.speaker === null ? paragraphs : [framed(said.speaker, paragraphs, reader, context)],
    });
  }
  return heard;
}

/**
 * An NPC's line as its hearers read it: the NPC, named for the reader,
 * saying the paragraphs as one quotation. Only the frame's own words are
 * charged here; the line's were charged as it rendered.
 */
function framed(
  speaker: InstanceId,
  paragraphs: readonly string[],
  reader: InstanceId,
  context: RenderContext,
): string {
  const words = paragraphs.join(' ');
  const line = capitalise(`${objectWords(speaker, reader, context)} says "${words}"`);
  context.budget.say(reader, [...line].length - [...words].length);
  return line;
}
