// The engine's own fixed words, as one-line passages (the spec's Prose ›
// Passages: a string is a one-line passage and carries slots). Where the
// spec gives the engine a line and no passage to say it through, the line
// is written here once, read as prose is, and rendered with what the
// engine binds, so a name in it reads as any other object's does.

import { Diagnostics } from '../source/diagnostics.js';
import { SourceFile } from '../source/source.js';
import { parseProse } from '../syntax/parse.js';
import type { Speech } from './body.js';
import { SPROUT } from '../declare/enums.js';

/** A line of the engine's, read as a one-line passage; a line that does not read is the engine's defect. */
export function engineLine(text: string): Extract<Speech, { readonly prose: unknown }> {
  const diagnostics = new Diagnostics();
  const prose = parseProse(new SourceFile('the engine', text), diagnostics);
  if (diagnostics.refused) {
    throw new Error(`the engine's line "${text}" does not read: ${diagnostics.render()}`);
  }
  return { text, prose, library: SPROUT };
}
