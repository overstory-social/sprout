// The `media` extension, as the compiler carries it (the spec's Extensions
// › What an extension may add; The host contract › Two decisions): an
// `Image` value type whose literal is the name of a 1-bit PNG in the
// world's folder, and `media.show(image)` or `media.show(image, caption)`,
// which records `{ image, caption? }` and reads, to a client that cannot
// draw, as its caption or, with none, as the image's name in brackets. The
// definition is data and pure functions; a host that draws the image
// reimplements this behaviour in its own language.

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
    name.split('/').some((part) => part === '..' || part === '');
  if (outside) {
    return {
      problem: `"${name}" does not name a file inside the world’s folder.`,
      remedy:
        'Write the file’s path from the world’s folder with / between folders, as in "pictures/cellar.png".',
    };
  }
  return null;
}

/** Whether the file is a PNG of one bit a pixel, which is what the Playdate draws. */
function oneBit(file: AssetFile): ExtensionProblem | null {
  const { head } = file;
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
  if (bitDepth === 1 && (colour === 0 || colour === 3)) return null;
  return {
    problem: `This image is not black and white: it has ${bitDepth} bits to a pixel, and an image here has one.`,
    remedy: 'Save the picture again as a 1-bit PNG, black and white without grey.',
  };
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
  asset: { file: (value) => String(value), check: oneBit },
};

const SHOW: ExtensionStatementDefinition = {
  name: 'show',
  parameters: [
    { name: 'image', type: { type: 'Image' } },
    { name: 'caption', type: 'string', optional: true },
  ],
  describe: true,
  check: ([image, caption]) => {
    if (image === undefined) {
      return {
        problem:
          '`media.show` shows an image named in quotes, so its file can be found and sent with the world.',
        remedy: 'Write the file’s name in quotes, as in `media.show("cellar.png")`.',
      };
    }
    if (caption === '') {
      return {
        problem: 'A caption needs words.',
        remedy:
          'Say what the picture shows, as in `media.show("cellar.png", "a cellar")`, or leave the caption out.',
      };
    }
    return null;
  },
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
    'a client that cannot draw reads the caption, or the file’s name in brackets where there is none.',
};
