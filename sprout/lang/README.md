# @overstory/sprout/lang

The Sprout language on its own: the parser, the declarations and their
types, the checker, and the closed bundle a microworld compiles to. It
imports `zod` and nothing else (`src/boundary.spec.ts` holds that line).

The language is described whole in
[`docs/design/sprout-design-spec.md`](../../docs/design/sprout-design-spec.md);
this package implements it one backlog item at a time, and the spec is the
authority where they disagree. What compiles today: enum, message and world
declarations, properties and `remembers` blocks, and the expression language
with its checker. Kinds, objects, verbs, bodies and prose are the items
after B12.

## Using it

```ts
import { compileBundle, renderDiagnostics, SourceFile } from '@overstory/sprout/lang';

const { bundle, diagnostics } = compileBundle(
  { manifestFile, manifest, files: [new SourceFile('world.sprout', text)], libraries: [] },
  { mode: 'publish' },
);
if (bundle === null) console.error(renderDiagnostics(diagnostics));
```

`compileBundle` is strict at publish and lenient at load: at load a file
that is missing, withheld or broken reads as absent and the world runs
around the gap. `checkShape` is the first tier, one file alone, for an
editor.

## Layout

| folder     | holds                                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------- |
| `source/`  | `SourceFile` and spans, the rule every AST node keeps, diagnostics and their page, SHA-256                            |
| `syntax/`  | the pull lexer, the AST, the recovering parser                                                                        |
| `declare/` | value types, enums, kinds and their composition, objects, properties, messages, verbs, the world root                 |
| `check/`   | typed bindings and scope, the expression checker                                                                      |
| `bundle/`  | limits as host configuration, the manifest, the bundle and its hash, the declaration tables, `compileBundle`, absence |
| `runtime/` | the turn's budget meter and the list value                                                                            |

Every source file has a colocated `.spec.ts` that exercises it directly.
