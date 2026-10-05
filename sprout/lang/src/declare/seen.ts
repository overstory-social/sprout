// What a description is being read for: the type of `seen`, which a
// `describe` binds (the spec's Prose; Properties › Where types come from).
// It is the engine's own enum, as `elapsed` is the engine's own integer:
// no library declares it, so no world can name it, and an option is
// written bare where `seen` gives it its type, `seen == :look`.

import { Diagnostics } from '../source/diagnostics.js';
import { SourceFile } from '../source/source.js';
import type { EnumDeclaration } from '../syntax/ast.js';
import { parseDeclarations } from '../syntax/parse.js';
import { SPROUT, type DeclaredEnum } from './enums.js';

/** The options of `seen`, in the order the spec's Prose gives them. */
export const SEEN_OPTIONS = ['look', 'arrival', 'poll'] as const;

/** `seen`'s type: a look, an arrival or a poll. */
export const SEEN: DeclaredEnum = (() => {
  const source = new SourceFile('sprout/seen', `enum Seen { ${SEEN_OPTIONS.join(', ')} }\n`);
  const diagnostics = new Diagnostics();
  const [declaration] = parseDeclarations(source, diagnostics);
  if (declaration?.kind !== 'enum' || diagnostics.refusals.length > 0) {
    throw new Error('the engine’s `Seen` does not read as an enum.');
  }
  const declared: EnumDeclaration = declaration;
  return {
    library: SPROUT,
    name: declared.name.text,
    options: declared.options.map((option) => option.name.text),
    declaration: declared,
  };
})();
