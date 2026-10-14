import { admissionCases } from './admission.js';
import { pollCases } from './polls.js';
import { questionCases } from './questions.js';
import { tickerCases } from './ticker.js';
import { turnCases } from './turns.js';
import type { EngineCase, MakeEngine } from './worlds.js';

// The engine conformance suite: what every engine a host may name must
// prove (core's engine.ts), importing no test framework, as the store
// conformance suite does. Each case runs core's turns, polls and the
// host's questions over a memory store through the engine `make` makes
// for a world, and throws on failure; a host runs it under any test
// runner with a three-line loop. The TypeScript runtime's engine passes
// it in core's own specs, and the WebAssembly engine in its package's.
// The worlds the cases run are exported too, for an engine's own specs.

export * from './worlds.js';

/** Every case, by area: turns, admission and the log, polls, rounds of ticks, and the engine reached directly. */
export const engineCases: readonly EngineCase[] = [
  ...turnCases,
  ...admissionCases,
  ...pollCases,
  ...tickerCases,
  ...questionCases,
];

/** Run every case against the engines `make` makes, throwing on the first failure. */
export async function runEngineConformance(make: MakeEngine): Promise<void> {
  for (const one of engineCases) await one.run(make);
}
