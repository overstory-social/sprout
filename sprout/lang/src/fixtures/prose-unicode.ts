// What capitalising a line takes from the JavaScript runtime, as data: the code points that
// are letters or numbers (the opening a capital goes past) and what each lower-case letter
// of the Basic Multilingual Plane becomes in upper case, special casing included. The C
// runtime holds both as tables generated from the runtime that wrote the goldens
// (`scripts/generate-prose-unicode.mjs`); the cases here are the edges of every range and
// every letter that changes. Spec support: the package build leaves it out.

import { capitalise } from '../prose/reflow.js';

const LAST = 0x10ffff;
const isLetterOrNumber = (cp: number): boolean => /^[\p{L}\p{N}]$/u.test(String.fromCodePoint(cp));

/** The runs of code points that are letters or numbers, as first and last. */
function runs(): [number, number][] {
  const found: [number, number][] = [];
  for (let cp = 0; cp <= LAST; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    if (!isLetterOrNumber(cp)) continue;
    const last = found.at(-1);
    if (last !== undefined && last[1] === cp - 1) last[1] = cp;
    else found.push([cp, cp]);
  }
  return found;
}

/** Code points of the Basic Multilingual Plane whose upper case is something else. */
function changers(): number[] {
  const found: number[] = [];
  for (let cp = 0; cp <= 0xffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    const letter = String.fromCodePoint(cp);
    if (letter.toUpperCase() !== letter) found.push(cp);
  }
  return found;
}

/** `[line, capitalised]` for the edge of every run of letters and numbers, and for every letter whose upper case differs. */
export function capitaliseGolden(): [string, string][] {
  const edges = new Set<number>();
  for (const [first, last] of runs()) {
    for (const cp of [first - 1, first, last, last + 1]) {
      if (cp >= 0 && cp <= LAST && !(cp >= 0xd800 && cp <= 0xdfff)) edges.add(cp);
    }
  }
  const lines = [...new Set([...edges, ...changers()])]
    .sort((a, b) => a - b)
    .map((cp) => `${String.fromCodePoint(cp)}x`);
  return lines.map((line) => [line, capitalise(line)]);
}

export { runs as letterRuns, changers as upperCaseChangers };
