// An extension as a host would install one, for the specs that pin,
// check and run extensions: `media` at major 2, with `media.Image`, which
// compares and renders, and `media.Sound`, which does neither; `show`,
// which may stand in a `describe` and checks its caption, and `play`,
// which may not. `mediaWith` swaps a statement's `run` or `transcript`
// for a case that wants the extension to misbehave. Spec support: the
// package build leaves it out.

import { z } from 'zod';

import type {
  Extension,
  ExtensionStatementDefinition,
  ExtensionValueType,
  Plain,
} from '../declare/extensions.js';

/** The `src` a value of `media.Image` or `media.Sound` holds. */
const srcOf = (value: Plain): string =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && 'src' in value
    ? String(value.src)
    : '';

/** A picture, written by its file name, `"cat.png"`. */
export const IMAGE: ExtensionValueType = {
  name: 'Image',
  read: (text) =>
    text.endsWith('.png')
      ? { value: { src: text } }
      : {
          problem: `"${text}" is not a picture: a picture's name ends in .png.`,
          remedy: 'Write the name of a picture, as in "cat.png".',
        },
  persist: (value) => srcOf(value),
  restore: (stored) => (stored.endsWith('.png') ? { src: stored } : null),
  print: (value) => srcOf(value),
  compares: (a, b) => srcOf(a) === srcOf(b),
  renders: (value) => `the picture ${srcOf(value)}`,
};

/** A sound, written by its file name, `"purr.ogg"`, which neither compares nor renders. */
export const SOUND: ExtensionValueType = {
  name: 'Sound',
  read: (text) =>
    text.endsWith('.ogg')
      ? { value: { src: text } }
      : {
          problem: `"${text}" is not a sound.`,
          remedy: 'Write the name of one, as in "purr.ogg".',
        },
  persist: (value) => srcOf(value),
  restore: (stored) => (stored.endsWith('.ogg') ? { src: stored } : null),
  print: (value) => srcOf(value),
  compares: false,
  renders: false,
};

export const SHOW: ExtensionStatementDefinition = {
  name: 'show',
  parameters: [
    { name: 'image', type: { type: 'Image' } },
    { name: 'caption', type: 'string' },
  ],
  describe: true,
  check: ([, caption]) =>
    caption === ''
      ? { problem: 'A picture shown needs a caption.', remedy: 'Say what it shows, as in "a cat".' }
      : null,
  run: ({ arguments: [image, caption], self }) => ({ src: srcOf(image!), caption: caption!, self }),
  effect: z.object({ src: z.string(), caption: z.string(), self: z.string() }),
  transcript: (payload) => {
    const caption = (payload as { caption: string }).caption;
    return `[A picture: ${caption}]`;
  },
};

export const PLAY: ExtensionStatementDefinition = {
  name: 'play',
  parameters: [{ name: 'sound', type: { type: 'Sound' } }],
  describe: false,
  run: ({ arguments: [sound] }) => ({ src: srcOf(sound!) }),
  effect: z.object({ src: z.string() }),
  transcript: () => '[A sound plays.]',
};

export const MEDIA: Extension = {
  name: 'media',
  major: 2,
  types: [IMAGE, SOUND],
  statements: [SHOW, PLAY],
  skill: 'Show a picture with `media.show(image, "caption")`; a text client reads the caption.',
};

/** `media` with `show` changed as a case says, to misbehave in one way. */
export function mediaWith(show: Partial<ExtensionStatementDefinition>): Extension {
  return { ...MEDIA, statements: [{ ...SHOW, ...show }, PLAY] };
}
