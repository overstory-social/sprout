# @overstory/sprout-player

A Sprout microworld played from a script, through real turns over a
freshly loaded world: `sprout play dir script.json` prints it back with every step expecting what it made, and
`sprout test` checks an author's own tests against what the world says.
`reportOf` counts what one or more scripts reached between them — the
lines misread, every fault, the places, objects, verbs, handlers and
passages reached of those the world declares, and the prose never
rendered — for `--report`.
The [`sprout` command](../cli/README.md) is how most people run it; the
script format is described there.

```ts
import { playScript, readScript, runTests, writeScript } from '@overstory/sprout-player';

const played = playScript(bundle, readScript(text, 'walk.json'), 'walk.json');
process.stdout.write(writeScript(played));
```

A script is JSON: steps of what visitors type and what the host does,
each of which may expect what it should make. `script.ts` holds the
format, and the typed line grammar an interactive session reads into the
same steps.

It also stands one visitor in a world as it loads, which the CLI's
inspectors (`sprout parse`, `sprout view`) look through.

`./fixtures` holds the worlds this package's specs play, and helpers to
write a script as typed lines and read one as a transcript, for the specs
of the packages built on it; no command imports it.

MIT. Imports `@overstory/sprout/lang` and `node:*` only.
