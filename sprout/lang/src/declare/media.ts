// The `media` extension, as the compiler carries it (the spec's Extensions
// › What an extension may add; The host contract › Two decisions): an
// `Image` value type whose literal is the name of a 1-bit PNG in the
// world's folder, and `media.show(image)` or `media.show(image, caption)`,
// whose image is such a literal or any value of the type (a property's,
// whose default is one), and which records `{ image, caption? }` and reads,
// to a client that cannot draw, as its caption or, with none, as the
// image's name in brackets. The definition is data and pure functions; a
// host that draws the image reimplements this behaviour in its own language.

import { PngUnreadable, readOneBitPng, type OneBitPicture } from '../source/png.js';
import type {
  AssetFile,
  Extension,
  ExtensionProblem,
  ExtensionStatementDefinition,
  ExtensionValueType,
} from './extensions.js';

/** The major version of `media` this build supplies. */
export const MEDIA_MAJOR = 1;

/** The eight bytes every PNG file begins with. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** What is wrong with `name` as the name of an image in the world's folder, or null. */
function problemWithName(name: string): ExtensionProblem | null {
  if (!name.endsWith('.png') || name === '.png') {
    return {
      problem: `"${name}" is not the name of an image: an image’s name ends in .png.`,
      remedy: 'Write the name of a .png file in the world’s folder, as in "cellar.png".',
    };
  }
  const outside =
    name.startsWith('/') ||
    name.includes('\\') ||
    name.split('/').some((part) => part === '..' || part === '.' || part === '');
  if (outside) {
    return {
      problem: `"${name}" does not name a file inside the world’s folder.`,
      remedy:
        'Write the file’s path from the world’s folder with / between folders, as in "pictures/cellar.png".',
    };
  }
  return null;
}

/** The largest width or height a packed picture records. */
const LARGEST_SIDE = 0xffff;

/**
 * A PNG of one bit a pixel, which is what the Playdate draws, packed as a cartridge carries it:
 * its width and its height as little-endian 16-bit numbers, then its rows as `readOneBitPng` gives
 * them, so a host builds the bitmap without reading PNG. Anything else is refused in an author's words.
 */
function packed(file: AssetFile): { readonly packed: Uint8Array } | ExtensionProblem {
  const head = file.content;
  const png =
    head.length >= 26 &&
    PNG_SIGNATURE.every((byte, at) => head[at] === byte) &&
    String.fromCharCode(...head.subarray(12, 16)) === 'IHDR';
  if (!png) {
    return {
      problem: 'This file is not a PNG image.',
      remedy: 'Save the picture as a PNG file with one bit to a pixel (black and white).',
    };
  }
  const bitDepth = head[24]!;
  const colour = head[25]!;
  if (bitDepth !== 1 || (colour !== 0 && colour !== 3)) {
    return {
      problem: `This image is not black and white: it has ${bitDepth} bits to a pixel, and an image here has one.`,
      remedy: 'Save the picture again as a 1-bit PNG, black and white without grey.',
    };
  }
  let picture: OneBitPicture;
  try {
    picture = readOneBitPng(head);
  } catch (thrown) {
    if (!(thrown instanceof PngUnreadable)) throw thrown;
    return {
      problem: `This PNG image cannot be read: ${thrown.message}.`,
      remedy: 'Open the picture in an image editor and save it again as a 1-bit PNG.',
    };
  }
  if (picture.width > LARGEST_SIDE || picture.height > LARGEST_SIDE) {
    return {
      problem: `This image is ${picture.width} by ${picture.height} pixels, and an image here is at most ${LARGEST_SIDE} pixels a side.`,
      remedy: 'Make the picture smaller; the Playdate’s screen is 400 by 240.',
    };
  }
  const out = new Uint8Array(4 + picture.rows.length);
  const view = new DataView(out.buffer);
  view.setUint16(0, picture.width, true);
  view.setUint16(2, picture.height, true);
  out.set(picture.rows, 4);
  return { packed: out };
}

/** An image, written by its file name. */
export const IMAGE: ExtensionValueType = {
  name: 'Image',
  read: (text) => problemWithName(text) ?? { value: text },
  persist: (value) => String(value),
  restore: (stored) => (problemWithName(stored) === null ? stored : null),
  print: (value) => String(value),
  compares: (a, b) => a === b,
  renders: false,
  asset: { file: (value) => String(value), pack: packed },
};

const SHOW: ExtensionStatementDefinition = {
  name: 'show',
  parameters: [
    { name: 'image', type: { type: 'Image' } },
    { name: 'caption', type: 'string', optional: true },
  ],
  describe: true,
  check: ([, caption]) =>
    caption === ''
      ? {
          problem: 'A caption needs words.',
          remedy:
            'Say what the picture shows, as in `media.show("cellar.png", "a cellar")`, or leave the caption out.',
        }
      : null,
  run: ({ arguments: [image, caption] }) => {
    const shown: { image: string; caption?: string } = { image: String(image) };
    if (typeof caption === 'string' && caption !== '') shown.caption = caption;
    return shown;
  },
  effect: {
    safeParse: (payload) => {
      const fields =
        typeof payload === 'object' && payload !== null && !Array.isArray(payload)
          ? (payload as Record<string, unknown>)
          : null;
      const success =
        fields !== null &&
        typeof fields['image'] === 'string' &&
        fields['image'] !== '' &&
        (fields['caption'] === undefined || typeof fields['caption'] === 'string') &&
        Object.keys(fields).every((key) => key === 'image' || key === 'caption');
      return { success };
    },
  },
  transcript: (payload) => {
    const { image, caption } = payload as { image: string; caption?: string };
    return caption ?? `[${image}]`;
  },
};

/** `media`, the images extension. */
export const MEDIA: Extension = {
  name: 'media',
  major: MEDIA_MAJOR,
  types: [IMAGE],
  statements: [SHOW],
  skill:
    'Show a picture with `media.show("cellar.png")` or `media.show("cellar.png", "a damp cellar")`, ' +
    'in a `describe` or a `do`. The picture is a black-and-white (1-bit) PNG file in the world’s folder; ' +
    'a kind may hold one as a property, `:picture media.Image default "cellar.png"`, which each object ' +
    'restates with its own, `:picture "pictures/hall.png"`, and one `describe` shows with ' +
    '`media.show(self.get(:picture))`; ' +
    'a client that cannot draw reads the caption, or the file’s name in brackets where there is none.',
};
