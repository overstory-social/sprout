// A description, rendered for the one looking (the spec's Prose ›
// Passages; Verbs › Engine verbs). Each `text` the describe ran renders
// as a line of its own, its paragraphs in order, and one that renders
// nothing leaves no paragraph behind; where every line renders nothing,
// the world's `unremarkable` is read in their place, so looking at a thing
// never reads as silence. A write turn renders with its line draws and a
// poll with none, and a describe draws nothing either way.

import type { Description } from '../runtime/describe.js';
import type { Heard } from './heard.js';
import type { RenderContext } from './render.js';
import { renderFor } from './speech.js';

/** `description` as its reader reads it. */
export function renderDescription(description: Description, context: RenderContext): Heard {
  const reader = description.to;
  const paragraphs = description.lines.flatMap((line) => renderFor(line, reader, context));
  return {
    reader,
    paragraphs:
      paragraphs.length > 0 ? paragraphs : renderFor(description.unremarkable, reader, context),
  };
}
