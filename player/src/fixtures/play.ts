import { engineBuilt } from '@overstory/sprout-engine-wasm';

import type { EngineName } from '../engine.js';
import { playScript } from '../play.js';
import { scriptOf, transcriptOf } from './scripts.js';
import { bundleOf, KILN_YARD } from './worlds.js';

// The kiln yard compiled once, and a script of lines played over it as the
// transcript it makes, and the engines a spec plays on: both, where the
// WebAssembly engine is built, and the TypeScript one alone where it is
// not. Spec support: the package build leaves it out.

export const bundle = bundleOf('kiln_yard', KILN_YARD);

/** The engines this build can run. */
export const ENGINES_BUILT: readonly EngineName[] = engineBuilt() ? ['ts', 'wasm'] : ['ts'];

/** `lines` played over the kiln yard on `engine`, as the transcript they make. */
export const play = (lines: string, engine: EngineName): string =>
  transcriptOf(playScript(bundle, scriptOf(lines), 'yard.json', engine));
