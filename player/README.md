# @overstory/sprout-player

A Sprout microworld played from a script, through real turns over a
freshly loaded world: `sprout play dir script` prints the transcript, and
`sprout test` checks an author's own tests against what the world says.
The [`sprout` command](../cli/README.md) is how most people run it; the
script format is described there.

```ts
import { playScript, runTests } from '@overstory/sprout-player';

const { page } = playScript(bundle, '@arrive Marta\nMarta> look\n@leave Marta\n');
```

It also stands one visitor in a world as it loads, which the CLI's
inspectors (`sprout parse`, `sprout view`) look through.

`./fixtures` holds the worlds this package's specs play, for the specs of
the packages built on it; no command imports it.

MIT. Imports `@overstory/sprout/lang` and `node:*` only.
