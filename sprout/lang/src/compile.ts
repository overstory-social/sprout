// Compiling, in two tiers (B03; the spec's The compiler › Two tiers).
//
// A single definition can be checked ALONE for its shape: syntax, the
// caps that apply to it, its own declarations agreeing with themselves,
// every write going to `self`. That is `checkShape`, and it is what an
// editor runs on each keystroke.
//
// Everything typed needs the WHOLE BUNDLE: composition resolved across
// kinds, properties merged, exclusive members checked for collision,
// every `get` and `set` against a resolved kind, `chance` and `actor`
// reachability through passages, the world's word set. That is
// `compileBundle`. Because libraries are vendored the bundle is closed,
// so whole-bundle checking is exact rather than a guess — and an editor
// cannot catch every error live, which is a consequence worth stating
// rather than discovering.
//
// What each tier can check grows as the syntax items land. What is here
// is the closed bundle itself — vendoring, hashing, the caps a bundle
// records, the level it needs — and the seam each later item plugs into:
// B05–B19 fill `definitions`, B27 fills the word set, B09 and B19 fill
// the typed half of the second tier. Where a check is not yet possible,
// this says so rather than pretending.

import { bundleHashOf, bytesOf, libraryHash, LANGUAGE_LEVEL } from './bundle.js';
import type { Bundle, LibrarySource, MicroworldSource, VendoredLibrary } from './bundle.js';
import { Diagnostics, type Diagnostic } from './diagnostics.js';
import { Lexer, type Token } from './lexer.js';
import { DEFAULT_LIMITS, type Limits } from './limits.js';
import type { Node } from './nodes.js';
import type { Span, SourceFile } from './source.js';

/**
 * What a host brings to a compile. Named for the bundle rather than for
 * compiling, because the previous language's compiler still holds
 * `CompileOptions` until the issue that replaces it deletes it.
 */
export interface BundleOptions {
  /** The host's limits. The caps a bundle is checked against are recorded in it. */
  readonly limits?: Limits;
  /**
   * The library hashes the host has blessed. Blessing is a quota
   * decision granted at publish: a blessed library's bytes cost the
   * author nothing, and the grant is recorded in the bundle so that a
   * library later un-blessed does not push a published world over its
   * limits.
   */
  readonly blessed?: ReadonlySet<string>;
  /** The level this compiler understands. Text needing a newer one is refused. */
  readonly compilerLevel?: number;
}

/** What the first tier makes of one file. */
export interface ShapeResult {
  readonly tokens: readonly Token[];
  readonly diagnostics: readonly Diagnostic[];
}

/** What compiling a bundle makes of it: the bundle, or nothing, and everything there was to say. */
export interface BundleResult {
  readonly bundle: Bundle | null;
  readonly diagnostics: readonly Diagnostic[];
}

/** Whether a file is code. A `.prose` file is read by B29's rules, not by these. */
function isCode(file: SourceFile): boolean {
  return file.name.endsWith('.sprout');
}

/**
 * Where a manifest key was written, so a problem with the manifest names
 * a line and column like everything else. The manifest arrives already
 * read, so this looks for the key in the text it was read from and falls
 * back to the head of the file.
 */
function atKey(manifest: SourceFile, key: string): Span {
  const at = manifest.text.indexOf(`"${key}"`);
  return at < 0 ? manifest.span(0, 0) : manifest.span(at, at + key.length + 2);
}

/** A world or library name: the namespace its declarations are unqualified in. */
const NAMESPACE = /^[a-z][a-z0-9_]*$/;

/**
 * The first tier: one file, checked alone for its shape. Today that is
 * its syntax; the caps that apply to a definition on its own, its
 * declarations agreeing with themselves and every write going to `self`
 * join it as the syntax that expresses them lands.
 */
export function checkShape(file: SourceFile): ShapeResult {
  const diagnostics = new Diagnostics();
  const tokens: Token[] = [];
  if (isCode(file)) {
    const lexer = new Lexer(file, diagnostics);
    for (;;) {
      const token = lexer.next();
      tokens.push(token);
      if (token.kind === 'end') break;
    }
  }
  return { tokens, diagnostics: diagnostics.all };
}

/** Vendor the libraries: hash each one, and ask the host's blessed set about the hash. */
function vendor(
  libraries: readonly LibrarySource[],
  blessed: ReadonlySet<string>,
): VendoredLibrary[] {
  return libraries.map((library) => {
    const hash = libraryHash(library);
    return {
      ...library,
      hash,
      blessed: blessed.has(hash),
      bytes: library.files.reduce((bytes, file) => bytes + bytesOf(file.text), 0),
    };
  });
}

/** Refuse a name that appears twice in a list, naming the second one. */
function refuseRepeats(
  diagnostics: Diagnostics,
  named: readonly { name: string; at: Span }[],
  what: string,
): void {
  const seen = new Set<string>();
  for (const { name, at } of named) {
    if (seen.has(name)) {
      diagnostics.refuse(
        at,
        `There are two ${what} called "${name}".`,
        'Give one of them another name, or remove it.',
      );
    }
    seen.add(name);
  }
}

/**
 * The second tier: a closed bundle, checked whole. Refuses rather than
 * returning a bundle when anything is wrong — publishing is strict, and
 * the lenient half of that rule is B04's.
 */
export function compileBundle(source: MicroworldSource, options: BundleOptions = {}): BundleResult {
  const limits = options.limits ?? DEFAULT_LIMITS;
  const blessed = options.blessed ?? new Set<string>();
  const compilerLevel = options.compilerLevel ?? LANGUAGE_LEVEL;
  const { manifest, manifestFile } = source;
  const diagnostics = new Diagnostics();

  if (!NAMESPACE.test(manifest.world)) {
    diagnostics.refuse(
      atKey(manifestFile, 'world'),
      `"${manifest.world}" cannot be a world's name.`,
      'A name starts with a lower-case letter and holds letters, digits and _.',
    );
  }
  if (!Number.isInteger(manifest.level) || manifest.level < 1) {
    diagnostics.refuse(
      atKey(manifestFile, 'level'),
      `A language level is a whole number from 1 up, not ${manifest.level}.`,
      'Write 1 if you are not sure which level this world needs.',
    );
  }

  for (const pin of manifest.extensions) {
    if (!Number.isInteger(pin.major) || pin.major < 0) {
      diagnostics.refuse(
        atKey(manifestFile, 'extensions'),
        `The extension "${pin.name}" is pinned to major version ${pin.major}.`,
        'A major version is a whole number from 0 up.',
      );
    }
  }
  refuseRepeats(
    diagnostics,
    manifest.extensions.map((pin) => ({ name: pin.name, at: atKey(manifestFile, 'extensions') })),
    'extensions pinned',
  );

  // A closed bundle: everything the world says it uses travels with it,
  // because nothing is resolved or fetched at run time.
  const vendored = vendor(source.libraries, blessed);
  const byName = new Map(vendored.map((library) => [library.name, library]));
  refuseRepeats(
    diagnostics,
    vendored.map((library) => ({
      name: library.name,
      at: library.files[0]?.span(0, 0) ?? atKey(manifestFile, 'libraries'),
    })),
    'libraries vendored',
  );
  for (const name of manifest.libraries) {
    if (!byName.has(name)) {
      diagnostics.refuse(
        atKey(manifestFile, 'libraries'),
        `This world uses the library "${name}", and its source did not travel with it.`,
        'A published world carries the full source of every library it uses: vendor it, or stop using it.',
      );
    }
    if (!NAMESPACE.test(name)) {
      diagnostics.refuse(
        atKey(manifestFile, 'libraries'),
        `"${name}" cannot be a library's name.`,
        'A name starts with a lower-case letter and holds letters, digits and _.',
      );
    }
  }
  const used = new Set(manifest.libraries);
  for (const library of vendored) {
    if (!used.has(library.name)) {
      diagnostics.warn(
        library.files[0]?.span(0, 0) ?? atKey(manifestFile, 'libraries'),
        `The library "${library.name}" travels with this world and the world does not use it.`,
        'Remove it from the world, or name it among the libraries the world uses.',
      );
    }
  }

  refuseRepeats(
    diagnostics,
    source.files.map((file) => ({ name: file.name, at: file.span(0, 0) })),
    'files',
  );
  for (const library of vendored) {
    refuseRepeats(
      diagnostics,
      library.files.map((file) => ({ name: file.name, at: file.span(0, 0) })),
      `files in the library "${library.name}"`,
    );
  }

  // A bundle's level is the highest of any of its parts, library source
  // included, and a runtime refuses text newer than its compiler.
  const level = vendored.reduce(
    (highest, library) => Math.max(highest, library.level),
    manifest.level,
  );
  if (level > compilerLevel) {
    const newer = vendored.filter((library) => library.level > compilerLevel);
    diagnostics.refuse(
      newer.length > 0 && manifest.level <= compilerLevel
        ? atKey(manifestFile, 'libraries')
        : atKey(manifestFile, 'level'),
      `This world needs Sprout level ${level}, and this one understands level ${compilerLevel}.`,
      newer.length > 0
        ? `The newer part is the library "${newer[0]!.name}". Update Sprout, or vendor a copy written for level ${compilerLevel}.`
        : 'Update Sprout, or rewrite the world for the level this one understands.',
    );
  }

  // Blessed library source costs the author nothing; a modified copy is
  // the author's own source and counts as it.
  const exemptBytes = vendored
    .filter((library) => library.blessed)
    .reduce((bytes, library) => bytes + library.bytes, 0);
  const ownBytes = source.files.reduce((bytes, file) => bytes + bytesOf(file.text), 0);
  const chargedLibraries = vendored.filter((library) => !library.blessed);
  const sourceBytes =
    ownBytes + chargedLibraries.reduce((bytes, library) => bytes + library.bytes, 0);
  const files =
    source.files.length +
    chargedLibraries.reduce((count, library) => count + library.files.length, 0);

  if (limits.caps.sourceBytes !== null && sourceBytes > limits.caps.sourceBytes) {
    diagnostics.refuse(
      atKey(manifestFile, 'world'),
      `This world is ${sourceBytes} bytes of source, and ${limits.caps.sourceBytes} is as much as it may be.`,
      'Take something out, or use a library the host has blessed, whose source costs nothing.',
    );
  }
  if (limits.caps.files !== null && files > limits.caps.files) {
    diagnostics.refuse(
      atKey(manifestFile, 'world'),
      `This world is ${files} files, and ${limits.caps.files} is as many as it may have.`,
      'Put more in each file, or take something out.',
    );
  }
  // The places, objects and kinds caps are counted once there are
  // declarations to count (B12, B19).

  // The first tier, over every file in the closed bundle — the world's
  // own and every library's, because they compile together.
  for (const file of [...source.files, ...vendored.flatMap((library) => library.files)]) {
    diagnostics.add(...checkShape(file).diagnostics);
  }

  if (diagnostics.refused) return { bundle: null, diagnostics: diagnostics.sorted() };

  const definitions: readonly Node[] = [];
  const bundle: Bundle = {
    world: manifest.world,
    definitions,
    // B27 fills this from nouns, tokens, directions, articles,
    // connectors and phrase words, once there is a grammar to read.
    words: [],
    level,
    extensions: manifest.extensions,
    libraries: vendored,
    caps: limits.caps,
    size: { files, sourceBytes, exemptBytes },
    hash: bundleHashOf(manifest, source.files, vendored),
  };
  return { bundle, diagnostics: diagnostics.sorted() };
}
