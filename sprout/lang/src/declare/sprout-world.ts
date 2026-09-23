// `sprout.World`, the kind every world composes and nothing else may
// (the spec's The world model; The compiler › What it refuses: "A world
// that does not compose `sprout.World`, written as `sprout.World`;
// anything but a world composing it"). Its name, how to tell it written,
// and the words for refusing it on a kind or an object live here, where
// the shape tier and composition both read them.

import type { KindExpr } from '../syntax/ast.js';
import type { Diagnostics } from '../source/diagnostics.js';
import { SPROUT } from './enums.js';

/**
 * What every world composes, written with its library. An unqualified
 * `World` does not stand for it on a world.
 */
export const WORLD = `${SPROUT}.World`;

/** Whether a kind as written is `sprout.World`, library and all. */
export function writesWorld(written: KindExpr): boolean {
  return written.library?.text === SPROUT && written.name.text === 'World';
}

/** Refuse `sprout.World` in what `name`, a kind or an object, composes. */
export function refuseComposingWorld(
  name: string,
  written: KindExpr,
  diagnostics: Diagnostics,
): void {
  diagnostics.refuse(
    written.at,
    `\`${name}\` composes \`${WORLD}\`, which only a world may.`,
    `Take it out of what \`${name}\` composes: it would make a thing into a world, and a bundle has one world, written \`world <name> is ${WORLD} { … }\`.`,
  );
}
