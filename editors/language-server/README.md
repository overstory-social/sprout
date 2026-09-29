# @overstory/sprout-language-server

Sprout for any editor that speaks the Language Server Protocol. The VS
Code extension in [`editors/vscode`](../vscode) bundles it; another
editor runs the `sprout-language-server` command over stdio.

- **Diagnostics:** a quarter of a second after the last edit to any file
  of a world, the whole world is checked as `sprout check` checks it,
  with the editor's unsaved text in place of what is on disk. Each problem
  goes on the file it names, so an edit to one file can put a problem on
  another. A world is the folder holding the nearest `sprout.json`.
- **Hover** shows each declaration a name could mean, as its first line
  is written, and where it is.
- **Go to definition** goes to the world's own declarations. A library's
  files are not on disk, so its names are shown on hover and not gone to.
- **Completion** offers an imported namespace's names after its dot, properties,
  memories, options and messages after `:`, and otherwise every name the
  world declares and the reserved words.

Names are found as the spec's _Imports_ reads them: `sprout.Container` is
the member of the namespace the file imports as `sprout`, and `Guard` in
a file that imports `Ward as Guard` is that `Ward`. A dot after anything
else is an object path, so `hall.box` is the object `box`. A name no
import names is the world's own where the world declares one, and
otherwise a library's. Every declaration a name could mean is offered, since a
property is declared once in each kind that has it. The declarations are
read from each file on its own, so they are there while the world as a
whole is refused.

```sh
npm install -g @overstory/sprout-language-server
sprout-language-server --stdio
```
