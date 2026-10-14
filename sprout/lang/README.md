# @overstory/sprout/lang

The Sprout language on its own: the parser, the declarations and their
types, the checker, and the closed bundle a microworld compiles to and its
cartridge; and what a host and its engine exchange. It imports `zod` and
nothing else (`src/boundary.spec.ts` holds that line).

The language is described whole in
[`docs/design/sprout-design-spec.md`](../../docs/design/sprout-design-spec.md);
this package implements it, and the spec is the authority where they
disagree. The whole language compiles here: enums, kinds, objects,
properties, messages, verbs and their phrases, bodies and prose, into a
bundle and its cartridge. Running a world is the engine's, `runtime-c/`,
which every host reaches through `host/`.

## Using it

```ts
import { compileBundle, renderDiagnostics, SourceFile } from '@overstory/sprout/lang';

const { bundle, diagnostics } = compileBundle(
  { manifestFile, manifest, files: [new SourceFile('printers_shop.sprout', text)], libraries: [] },
  { mode: 'publish' },
);
if (bundle === null) console.error(renderDiagnostics(diagnostics));
```

`compileBundle` is strict at publish and lenient at load: at load a file
that is missing, withheld or broken reads as absent and the world runs
around the gap.

## Layout

| folder     | holds                                                                                                                                                           |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `source/`  | `SourceFile` and spans, the rule every AST node keeps, diagnostics and their page, SHA-256                                                                      |
| `syntax/`  | the pull lexer, the AST, the recovering parser                                                                                                                  |
| `declare/` | value types, enums, kinds and their composition, objects, properties, messages, verbs, the world root                                                           |
| `check/`   | typed bindings and scope, the expression checker                                                                                                                |
| `bundle/`  | limits as host configuration, the manifest, the bundle and its hash, the declaration tables, `compileBundle`, absence, and the generated skill, `generateSkill` |
| `host/`    | what a host and its engine exchange: ids, the stored form, the catalogue and the cartridge reader, each turn's inputs, effects, faults and the view             |

Every source file has a colocated `.spec.ts` that exercises it directly.
