# @overstory/sprout-ext-media

Pictures for [Sprout](../sprout/README.md), as a language extension:
the `media` value type, the `:image` well-known property on rooms,
items and kinds, and the `show` statement.

```ts
import { ExtensionSet, compileSprout, runVerb } from '@overstory/sprout';
import { media, shownMedia } from '@overstory/sprout-ext-media';

const ext = new ExtensionSet([media]);
const { definition } = compileSprout(source, { ext });
// … build a world with `ext` on it …
const outcome = runVerb(world, targetId, 'peek');
const ids = shownMedia(outcome.effects); // the pictures to open, each once
```

```sprout
use media
object lamp {
  :image media "m-lamp"
  :blueprint media
  describe { show  text "A brass lamp." }
  study { show self :blueprint }
}
```

`show` reads a media property and records
`{ extension: 'media', kind: 'show', mediaId }` on the outcome; it
never opens anything itself. What a media id means, where the bytes
are, and who may see them are the host's — Overstory serves them
against its audience rule and a signed URL. The extension's own
conformance (`checkExtension`) runs in its spec.
