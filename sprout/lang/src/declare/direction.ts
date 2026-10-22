// The way a refused `go` tried: the type of `way` in an `after command`
// (the spec's Verbs › After a command; Properties › Where types come from).
// It is the engine's own enum, as `Seen` is, its options the closed set of
// directions under Verbs › Exits, so `way == :nrth` is refused rather than
// a comparison that is false forever. `in` and `out` are reserved words,
// which no world's enum may name, so the declaration is built here rather
// than parsed.

import { SourceFile, type Span } from '../source/source.js';
import type { EnumDeclaration, EnumOption } from '../syntax/ast.js';
import { DIRECTIONS } from '../syntax/directions.js';
import { SPROUT, type DeclaredEnum } from './enums.js';

/** `way`'s type in an `after command`: a direction, written out. */
export const DIRECTION: DeclaredEnum = (() => {
  const head = 'enum Direction { ';
  const text = `${head}${DIRECTIONS.join(', ')} }\n`;
  const source = new SourceFile('sprout/direction', text);
  const at = (start: number, end: number): Span => ({ source, start, end });
  const options: EnumOption[] = [];
  let start = head.length;
  for (const direction of DIRECTIONS) {
    const span = at(start, start + direction.length);
    options.push({ kind: 'option', at: span, name: { kind: 'ident', at: span, text: direction } });
    start += direction.length + 2;
  }
  const declaration: EnumDeclaration = {
    kind: 'enum',
    at: at(0, text.length - 1),
    name: { kind: 'ident', at: at(5, 14), text: 'Direction' },
    options,
  };
  return {
    library: SPROUT,
    name: declaration.name.text,
    options: [...DIRECTIONS],
    declaration,
  };
})();
