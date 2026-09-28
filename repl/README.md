# @overstory/sprout-repl

A Sprout microworld you are working on, played interactively: `sprout play
dir` with no script reads one typed line at a time from stdin, under the
prompt of whoever is standing, on the same stage and grammar the
[player](../player/README.md) gives a script. The page it prints is what a
script of the same lines would print. `Ctrl-D` ends the session.

```ts
import { playInteractively } from '@overstory/sprout-repl';

const code = await playInteractively(bundle, {}, { stdout: process.stdout, stderr: process.stderr });
```

`./fixtures` holds a captured `Io` for the specs of the packages built on
it; no command imports it.

MIT. Imports `@overstory/sprout/lang`, `@overstory/sprout-player` and
`node:*` only.
