import { playScript } from '../play.js';
import { scriptOf, transcriptOf } from './scripts.js';
import { bundleOf, KILN_YARD } from './worlds.js';

// The kiln yard compiled once, and a script of lines played over it as the
// transcript it makes. Spec support: the package build leaves it out.

export const bundle = bundleOf('kiln_yard', KILN_YARD);

/** `lines` played over the kiln yard, as the transcript they make. */
export const play = (lines: string): string =>
  transcriptOf(playScript(bundle, scriptOf(lines), 'yard.json'));
