// `:unseen`, the one property every object holds (the spec's Range ›
// Unseen). The standard library declares it, `:unseen false`, and it
// reaches every composer as a property of that one origin does: a kind
// or an object restates it to start unseen, keeping its type, and a
// restatement supersedes it wherever both reach one composer, since every
// kind composes it. The engine reads it, so no other kind declares it anew.

import { Diagnostics } from '../source/diagnostics.js';
import { SourceFile } from '../source/source.js';
import { parseProperty } from '../syntax/parse.js';
import { SPROUT } from './enums.js';
import type { ResolvedProperty } from './properties.js';
import { BOOLEAN } from './types.js';

/** The property's name, as the engine reads it. */
export const UNSEEN_NAME = 'unseen';

/** `:unseen`, as every object holds it before anything restates it. */
export const UNSEEN: ResolvedProperty = (() => {
  const source = new SourceFile('sprout/unseen', `:${UNSEEN_NAME} false\n`);
  const diagnostics = new Diagnostics();
  const declaration = parseProperty(source, diagnostics);
  if (declaration === null || diagnostics.refusals.length > 0) {
    throw new Error('the standard library’s `:unseen` does not read as a property.');
  }
  return { name: UNSEEN_NAME, type: BOOLEAN, remembered: false, origin: SPROUT, declaration };
})();

/** Whether `property` is the standard library's `:unseen`, as no restatement has changed it. */
export function isUnseenOrigin(property: ResolvedProperty): boolean {
  return property.origin === UNSEEN.origin && property.name === UNSEEN_NAME;
}
