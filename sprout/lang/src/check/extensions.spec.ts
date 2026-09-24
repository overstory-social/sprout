import { describe, expect, it } from 'vitest';

import { compileBundle } from '../bundle/compile/compile.js';
import type { Extension } from '../declare/extensions.js';
import { locationOf } from '../source/source.js';
import { refusals, warnings, world, worldFiles, worldLine } from '../fixtures/compile.js';
import { MEDIA, mediaWith } from '../fixtures/extensions.js';

const PINNED = { manifest: { extensions: [{ name: 'media', major: 2 }] } };

/**
 * What compiling a world whose lamp, in a file naming `media`, writes
 * `members` refuses, as location, message and remedy, on a host that
 * installed `installed`.
 */
function refusedIn(
  members: string,
  installed: readonly Extension[] = [MEDIA],
  mode: 'publish' | 'load' = 'publish',
): (string | undefined)[][] {
  const files = worldFiles(
    `${worldLine('object lamp is Lamp')}\nverb light { role target "light [target]" }\nmessage :lit`,
    `extension media 2\nkind Lamp {\n  :image media.Image default "lamp.png"\n  :hum media.Sound default "hum.ogg"\n  ${members}\n}`,
  );
  const { diagnostics } = compileBundle(world({ files, ...PINNED }), {
    extensions: installed,
    mode,
  });
  const said = mode === 'publish' ? refusals(diagnostics) : warnings(diagnostics);
  return said.map((d) => [locationOf(d.at), d.message, d.remedy]);
}

const messages = (members: string, installed?: readonly Extension[]): string[] =>
  refusedIn(members, installed).map(([, message]) => message!);

describe('an extension’s statement', () => {
  it('stands in a `do`, a handler and a `describe` its extension allows, its arguments typed', () => {
    expect(
      refusedIn(
        [
          'as target for light { do { media.show(self.get(:image), "a lamp")  media.play(self.get(:hum)) } }',
          '  on :lit { media.show("lit.png", "the lamp, lit") }',
          '  describe { text "A lamp."  media.show(self.get(:image), "a lamp") }',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('is refused in a guard or a `permit`, which only read and decide', () => {
    expect(
      refusedIn(
        [
          'accept (item, from) { media.show("x.png", "x")  allow }',
          '  as target for light { permit { media.play(self.get(:hum)) allow } }',
        ].join('\n'),
      ),
    ).toEqual([
      [
        'lamp.sprout:5:25',
        '`media.show` records an effect, and a guard only reads and decides.',
        'Move it to a handler or a `do`; a guard ends in `allow` or `refuse`.',
      ],
      [
        'lamp.sprout:6:34',
        '`media.play` records an effect, and a `permit` only reads and decides.',
        'Move it to `do`; a `permit` ends in `allow` or `refuse`.',
      ],
    ]);
  });

  it('is no `text`, so a `describe` that holds only one is refused as empty on a text client', () => {
    expect(messages('describe { media.show(self.get(:image), "a lamp") }')).toEqual([
      'This `describe` has no `text`, so whoever looks at `Lamp` would read nothing.',
    ]);
  });

  it('is refused in a `describe` where its extension says it may not stand there', () => {
    expect(refusedIn('describe { text "A lamp."  media.play(self.get(:hum)) }')).toEqual([
      [
        'lamp.sprout:5:30',
        '`media.play` may not stand in a `describe`: the extension `media` says so.',
        'Move it to a `do` or a handler, which record what happens.',
      ],
    ]);
  });

  it('names a statement its extension declares, with as many arguments as it takes', () => {
    expect(refusedIn('as target for light { do { media.shout("x") } }')).toEqual([
      [
        'lamp.sprout:5:36',
        'The extension `media` has no statement `shout`.',
        'Its statements: `media.show` and `media.play`.',
      ],
    ]);
    expect(refusedIn('as target for light { do { media.show(self.get(:image)) } }')).toEqual([
      [
        'lamp.sprout:5:30',
        '`media.show` takes 2: `image` and `caption`.',
        'Write `media.show(image, caption)`.',
      ],
    ]);
  });

  it('gives each argument its parameter’s type, a literal of the extension’s read by it', () => {
    expect(refusedIn('as target for light { do { media.show(self.get(:hum), 3) } }')).toEqual([
      [
        'lamp.sprout:5:41',
        '`image` of `media.show` is `media.Image`, and this is media.Sound.',
        'Give it a property of `media.Image`, or text in quotes, which `media` reads.',
      ],
      [
        'lamp.sprout:5:57',
        '`caption` of `media.show` is `string`, and this is integer.',
        'Give it text in quotes, as in `"a line"`.',
      ],
    ]);
    expect(refusedIn('as target for light { do { media.show("lamp.gif", "a lamp") } }')).toEqual([
      [
        'lamp.sprout:5:41',
        '"lamp.gif" is not a picture: a picture\'s name ends in .png.',
        'Write the name of a picture, as in "cat.png".',
      ],
    ]);
  });

  it('passes the extension’s own check over the arguments written as literals', () => {
    expect(refusedIn('as target for light { do { media.show("lamp.png", "") } }')).toEqual([
      ['lamp.sprout:5:30', 'A picture shown needs a caption.', 'Say what it shows, as in "a cat".'],
    ]);
    const throwing = mediaWith({
      check: () => {
        throw new Error('bad check');
      },
    });
    expect(
      messages('as target for light { do { media.show("lamp.png", "x") } }', [throwing]),
    ).toEqual(['The extension `media` failed checking this: bad check.']);
  });

  it('where the extension is absent at load, has only its arguments typed', () => {
    const files = worldFiles(
      `${worldLine('object lamp is Lamp')}\nverb light { role target "light [target]" }`,
      'extension media 2\nkind Lamp { as target for light { do { media.shout(self.get(:nothing)) } } }',
    );
    const { diagnostics } = compileBundle(world({ files, ...PINNED }), { mode: 'load' });
    expect(warnings(diagnostics).map((d) => d.message)).toEqual([
      'This host does not provide the extension `media`. Its statements record nothing and its types hold their defaults.',
    ]);
    // Nothing of `media` can be asked, so `shout` is not refused; what it is given is still typed.
    expect(refusals(diagnostics).map((d) => [locationOf(d.at), d.message])).toEqual([
      ['lamp.sprout:2:61', expect.stringContaining('`:nothing`')],
    ]);
  });
});

describe('a call on a pinned extension’s name in a file that does not name it', () => {
  it('is refused as a statement of that extension, saying what to write at the top', () => {
    const files = worldFiles(
      `${worldLine('object lamp is Lamp')}\nverb light { role target "light [target]" }`,
      'kind Lamp { as target for light { do { media.show("x.png", "x") } } }',
    );
    const { diagnostics } = compileBundle(world({ files, ...PINNED }), { extensions: [MEDIA] });
    expect(refusals(diagnostics).map((d) => [locationOf(d.at), d.message, d.remedy])).toEqual([
      [
        'lamp.sprout:1:40',
        '`media.show` is a statement of the extension `media`, which this file does not name.',
        'Write `extension media 2` at the top of the file.',
      ],
    ]);
  });
});

describe('an extension’s value, compared and rendered', () => {
  it('is compared with `==` only where its extension says it compares', () => {
    expect(
      messages(
        'as target for light { do { if (self.get(:image) == self.get(:image)) { say "Same." } } }',
      ),
    ).toEqual([]);
    expect(
      refusedIn(
        'as target for light { do { if (self.get(:hum) != self.get(:hum)) { say "Same." } } }',
      ),
    ).toEqual([
      [
        'lamp.sprout:5:34',
        '`media.Sound` is not compared with `!=`: the extension `media` says so.',
        'Compare something the value is kept beside instead, such as a property of your own.',
      ],
    ]);
  });

  it('is rendered by a slot only where its extension gives it words', () => {
    expect(messages('as target for light { do { say "You see {self.get(:image)}." } }')).toEqual(
      [],
    );
    expect(refusedIn('as target for light { do { say "You hear {self.get(:hum)}." } }')).toEqual([
      [
        'lamp.sprout:5:45',
        'A slot does not render `media.Sound`: the extension `media` says it has no words.',
        'Say what it means in words of your own, or with a statement of the extension that shows it.',
      ],
    ]);
  });
});
