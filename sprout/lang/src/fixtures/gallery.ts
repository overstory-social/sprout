// The gallery the extension specs run turns in, one kind per file, each
// file naming `media` at its top: a hall whose description shows a
// picture of itself, and which shows it again when told it was admired;
// a painting whose picture a visitor views, with a line of its own
// after, or studies, shown twice; and a cat whose purr is heard and says nothing else. Compiled
// with `media` installed, or loaded without it, when every one of those
// statements records nothing. Spec support: the package build leaves it out.

import type { Bundle } from '../bundle/bundle.js';
import { DEFAULT_LIMITS, type RuntimeBudgets } from '../bundle/limits.js';
import type { Extension } from '../declare/extensions.js';
import { compiledWorld } from './bundle.js';
import { MEDIA } from './extensions.js';
import { catalogueOf, type Catalogue } from '../runtime/catalogue.js';
import type { CommandHost } from '../runtime/command.js';
import { Draft } from '../runtime/draft.js';
import { declaredId, visitKey, type InstanceId, type VisitKey } from '../runtime/ids.js';
import { initialState } from '../runtime/load.js';
import { parseCommand } from '../runtime/parser.js';
import { newInstance, type WorldState } from '../runtime/state.js';
import { renderEffects } from '../prose/effects.js';

export const GALLERY_FILES: Readonly<Record<string, string>> = {
  'gallery.sprout': `extension media 2

world gallery is sprout.World {
  visitors are Person
  visitors arrive at hall
  object hall is Hall {
    object painting is Painting
    object cat is Cat
  }
}

verb view   { role target  "view [target]" }
verb hear   { role target  "hear [target]" }
verb admire { role target  "admire [target]" }
verb study  { role target  "study [target]" }
message :admired
`,
  'hall.sprout': `extension media 2

kind Hall is sprout.Place {
  describe {
    text "A bright hall."
    media.show("hall.png", "the hall")
  }
  as target for admire { do { send self :admired  say "You admire the hall." } }
  on :admired { media.show("hall.png", "the hall, admired") }
}
`,
  'painting.sprout': `extension media 2

kind Painting {
  :image media.Image default "cat.png"
  grammar { name "painting"  nouns "painting" }
  as target for view { do { media.show(self.get(:image), "a cat")  say "You look closely." } }
  as target for study { do { media.show(self.get(:image), "a cat")  media.show(self.get(:image), "a cat, closer") } }
}
`,
  'cat.sprout': `extension media 2

kind Cat {
  :purr media.Sound default "purr.ogg"
  grammar { name "cat"  nouns "cat" }
  as target for hear { do { media.play(self.get(:purr)) } }
}
`,
  'person.sprout': 'kind Person is sprout.Visitor { }\n',
};

const PINS = [{ name: 'media', major: 2 }];

/** The gallery compiled on a host that installed `installed`: strict with `media`, loaded without it. */
export function galleryBundle(installed: readonly Extension[] = [MEDIA]): Bundle {
  const absent = !installed.some(
    (extension) => extension.name === 'media' && extension.major === 2,
  );
  return compiledWorld('gallery', GALLERY_FILES, {
    pins: PINS,
    installed,
    ...(absent ? { mode: 'load' as const } : {}),
  });
}

const at = (...path: string[]): InstanceId => declaredId('gallery', path);
export const HALL = at('hall');
export const PAINTING = at('hall', 'painting');
export const CAT = at('hall', 'cat');

export const MARTA: VisitKey = visitKey('v-marta');
export const INES: VisitKey = visitKey('v-ines');

/** The gallery's catalogue, with `media` installed or as `installed` says. */
export const galleryCatalogue = (installed?: readonly Extension[]): Catalogue =>
  catalogueOf(galleryBundle(installed), DEFAULT_LIMITS.caps);

/** A host running `catalogue` under `budgets`, reading what is typed with the command parser. */
export const galleryHost = (
  catalogue: Catalogue,
  budgets: RuntimeBudgets = DEFAULT_LIMITS.budgets,
): CommandHost => ({ catalogue, budgets, parse: parseCommand, render: renderEffects });

/** The gallery as committed under `catalogue`, with a visitor in the hall for each visit given. */
export function gallery(catalogue: Catalogue, visits: readonly VisitKey[] = [MARTA]): WorldState {
  const draft = new Draft(initialState(catalogue));
  for (const visit of visits) {
    const id = draft.mint();
    draft.add(
      newInstance(
        id,
        { from: 'visitor' },
        catalogue.visitorKind!,
        HALL,
        draft.nextSerial(),
        catalogue.caps,
      ),
    );
    draft.putVisitor({ visit, nickname: visit.slice(2), instance: id, lastPlace: HALL });
  }
  return draft.commit().state;
}

/** A command's write inputs, at the host's instant 0. */
export const typed = (visit: VisitKey, text: string) => ({
  visit,
  text,
  seed: 7,
  mayHold: null,
  now: 0,
});
