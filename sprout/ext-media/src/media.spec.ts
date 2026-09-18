import { describe, expect, it } from 'vitest';

import {
  actorObject,
  checkExtension,
  compileSprout,
  describeWith,
  normalizeObjectState,
  printSprout,
  runVerb,
  type SproutObject,
  type SproutWorld,
} from '@overstory/sprout';

import { MEDIA, Shown, media, shownMedia } from './media.js';

// The media extension, checked against the language's own conformance
// (§3.5) and exercised end to end: compile a source that `use`s it,
// print it back, run `show`, and read the ids a host would open.

const LAMP = `use media
object lamp {
  :image media "m-lamp"
  :blueprint media
  describe { show  text "A brass lamp." }
  study { show self :blueprint }
  around { show room }
  redraw { self.set(:blueprint, "m-plan")  show self :blueprint  show self :blueprint }
}
`;

function compiled(source: string) {
  const r = compileSprout(source, { ext: MEDIA });
  if (!r.definition)
    throw new Error(r.problems.map((p) => `${p.line}:${p.column} ${p.message}`).join('\n'));
  return r.definition;
}

function world(): SproutWorld {
  const lamp = compiled(LAMP);
  const room = compiled('use media\nroom r { :image media "m-room" }');
  const obj = (id: string, kind: 'room' | 'item', definition: typeof lamp): SproutObject => ({
    id,
    kind,
    definition,
    kinds: [],
    state: normalizeObjectState(definition, {}, MEDIA),
    visitor: {},
    container: kind === 'room' ? null : 'r',
    home: kind === 'room' ? null : 'r',
    spawnedFrom: null,
  });
  return {
    room: obj('r', 'room', room),
    actor: actorObject('a'),
    items: [obj('i', 'item', lamp)],
    ext: MEDIA,
  };
}

describe('the media extension', () => {
  it('passes the language’s extension conformance check', () => {
    expect(checkExtension(media)).toEqual([]);
  });

  it('compiles, prints back to the same source, and refuses show on a property that is not a picture', () => {
    const def = compiled(LAMP);
    expect(def.uses).toEqual(['media']);
    expect(def.properties).toEqual([
      { type: 'media', name: 'image', default: 'm-lamp' },
      { type: 'media', name: 'blueprint', default: null },
    ]);
    const printed = printSprout(def, { ext: MEDIA });
    expect(
      printed.startsWith('use media\nobject lamp {\n  :image media "m-lamp"\n  :blueprint media\n'),
    ).toBe(true);
    expect({ ...compiled(printed), source: null }).toEqual({ ...def, source: null });
    expect(
      compileSprout('use media\nobject o { :n 0 peek { show self :n } }', { ext: MEDIA })
        .problems[0]?.message,
    ).toBe('Message "peek": "show": "n" is not a picture.');
    expect(
      compileSprout('use media\nobject o { peek { show self :plan } }', { ext: MEDIA }).problems[0]
        ?.message,
    ).toBe('Message "peek": "show": self has no property "plan" to show.');
  });

  it('records what to show as effects, and shownMedia reads them once each', () => {
    const w = world();
    const shown = (ids: string[]) =>
      ids.map((mediaId) => ({ extension: 'media', kind: 'show', mediaId }));
    expect(runVerb(w, 'i', 'study').effects).toEqual([]);
    expect(runVerb(w, 'i', 'around').effects).toEqual(shown(['m-room']));
    const redraw = runVerb(w, 'i', 'redraw');
    expect(redraw.effects).toEqual(shown(['m-plan', 'm-plan']));
    expect(shownMedia(redraw.effects)).toEqual(['m-plan']);
    expect(describeWith(w.items[0]!, w)).toEqual({
      prose: 'A brass lamp.',
      effects: shown(['m-lamp']),
    });
    expect(MEDIA.transcript(redraw.effects[0]!)).toBe('[a picture opens]');
    expect(Shown.safeParse({ extension: 'media', kind: 'show', mediaId: '' }).success).toBe(false);
  });
});
