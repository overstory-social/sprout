// Compiling, in two tiers and two modes (the spec's The compiler › Two
// tiers, Strict and lenient, What absent means).
//
// THE TIERS. A single definition can be checked ALONE for its shape:
// syntax, the caps that apply to it, its own declarations agreeing with
// themselves, every write going to `self`. That is `checkShape`, and it
// is what an editor runs on each keystroke. Everything typed needs the
// WHOLE BUNDLE: composition resolved across kinds, properties merged,
// exclusive members checked for collision, every `get` and `set` against
// a resolved kind, `chance` and `actor` reachability through passages,
// the world's word set. That is `compileBundle`. Because libraries are
// vendored the bundle is closed, so whole-bundle checking is exact
// rather than a guess — and an editor cannot catch every error live.
//
// THE MODES. Saving and publishing are STRICT: any problem is a refusal.
// Loading is LENIENT: a file that is missing, withheld, mismatched or
// broken reads as absent, what referred to it keeps compiling, and the
// world runs with a visible gap. That is what makes a takedown safe, and
// why every gap is recorded in the bundle rather than swallowed.
//
// The manifest names every file the world is made of and every library
// it vendored, with the hash of the source that travelled, so
// completeness and closedness are settled by comparison before a line
// has parsed. What each tier can check grows as the syntax lands; where
// a check is not yet possible, this says so rather than pretending.

import type { CompileMode, Absent } from './absent.js';
import type {
  Declaration,
  KindDeclaration,
  ObjectDeclaration,
  WorldDeclaration,
} from '../syntax/ast.js';
import { bundleHashOf, bytesOf, libraryHash, LANGUAGE_LEVEL } from './bundle.js';
import type { Bundle, LibrarySource, MicroworldSource, VendoredLibrary } from './bundle.js';
import { Diagnostics, softenPolicy, type Diagnostic } from '../source/diagnostics.js';
import { checkEnumDeclaration } from '../declare/enums.js';
import { checkKindDeclaration } from '../declare/kinds.js';
import { checkWorldDeclaration, resolveArrival } from '../declare/world.js';
import type { TreePath } from '../declare/tree.js';
import { writtenPath } from '../syntax/ast.js';
import { absenceRule } from './absent.js';
import { resolveDeclarations } from './declarations.js';
import { countWorld } from './counts.js';
import { parseDeclarations } from '../syntax/parse.js';
import { DEFAULT_LIMITS, type Limits, type StaticCaps } from './limits.js';
import type { Span, SourceFile } from '../source/source.js';

/** What a host brings to a compile. */
export interface CompileOptions {
  /** Strict at save and publish, lenient at load. Strict unless a host says otherwise. */
  readonly mode?: CompileMode;
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
  /** The level this compiler understands. Text needing a newer one is refused, in either mode. */
  readonly compilerLevel?: number;
}

/** What the first tier makes of one file. */
export interface ShapeResult {
  readonly declarations: readonly Declaration[];
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

/** A world's own files are its `.sprout` files and the `.prose` files they point at. */
function isWorldFile(name: string): boolean {
  return name.endsWith('.sprout') || name.endsWith('.prose');
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

/**
 * Where a value was written inside the manifest, for a problem about one
 * entry of a list. It finds the first place the value is written, which
 * is the right one for a name that appears once — scaffolding until the
 * manifest is read with spans of its own rather than arriving parsed.
 */
function atValue(manifest: SourceFile, value: string, fallback: Span): Span {
  const at = manifest.text.indexOf(`"${value}"`);
  return at < 0 ? fallback : manifest.span(at, at + value.length + 2);
}

/** A world or library name: the namespace its declarations are unqualified in. */
const NAMESPACE = /^[a-z][a-z0-9_]*$/;

// The manifest's `version` row: "which version of this world this is, as
// semver" (the spec's The world model › The manifest). The expression is
// the one semver.org publishes for recognizing a semantic version.
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/**
 * The first tier: one file, checked alone for its shape. Today that is
 * its syntax, the options cap, `sprout.World` written on the world and
 * nowhere else, and an object naming a kind; the rest of the caps that
 * apply to a definition on its own, its declarations agreeing with
 * themselves and every write going to `self` join it as the syntax that
 * expresses them lands. The caps are the host's, as every limit is.
 */
export function checkShape(file: SourceFile, caps?: StaticCaps): ShapeResult {
  const diagnostics = new Diagnostics();
  if (!isCode(file)) return { declarations: [], diagnostics: [] };
  const using = caps ?? DEFAULT_LIMITS.caps;
  const declarations = parseDeclarations(file, diagnostics, using);
  for (const declared of declarations) {
    if (declared.kind === 'enum') {
      checkEnumDeclaration(declared, using.optionsPerEnum, diagnostics);
    }
    // One declaration answers on its own whether it wrote
    // `sprout.World`, so the first tier is where a world that did not
    // is refused.
    if (declared.kind === 'world') {
      checkWorldDeclaration(declared, diagnostics);
    }
    // As it does whether a kind or an object wrote it, which anything
    // but a world may not, and whether an object named a kind at all.
    if (declared.kind === 'kind' || declared.kind === 'object') {
      checkKindDeclaration(declared, diagnostics);
    }
  }
  return { declarations, diagnostics: diagnostics.all };
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

/** A table cell, written as a sentence: the rows read as `the object is absent`, lower-case. */
function sentence(cell: string): string {
  return `${cell.charAt(0).toUpperCase()}${cell.slice(1)}.`;
}

/**
 * The one decision the two modes turn on: at publish a problem refuses,
 * at load the same problem is a gap the world runs around. Everything
 * below says which it is raising and lets this answer.
 */
class Report {
  readonly diagnostics = new Diagnostics();
  readonly absent: Absent[] = [];

  /** @param anywhere where a gap with nothing of its own to point at is reported. */
  constructor(
    readonly mode: CompileMode,
    private readonly anywhere: Span,
  ) {}

  /** Always wrong, in either mode: a refusal that leniency does not soften. */
  refuse(at: Span, message: string, remedy?: string): void {
    this.diagnostics.refuse(at, message, remedy);
  }

  /** Worth saying, never fatal. */
  warn(at: Span, message: string, remedy?: string): void {
    this.diagnostics.warn(at, message, remedy);
  }

  /**
   * Wrong to publish and survivable to run: a refusal at publish, a
   * warning at load. Refusing at load would darken a world that was
   * accepted once, which is the opposite of what leniency is for.
   */
  strict(at: Span, message: string, remedy?: string): void {
    if (this.mode === 'publish') this.refuse(at, message, remedy);
    else this.warn(at, message, remedy);
  }

  /**
   * Something is not there. At publish that refuses — a world is not
   * published with a piece missing. At load it is a gap: recorded,
   * warned about, and run around.
   */
  gap(absent: Absent, message: string, remedy?: string): void {
    const at = absent.at ?? this.anywhere;
    if (this.mode === 'publish') {
      this.refuse(at, message, remedy);
      return;
    }
    this.absent.push(absent);
    this.warn(at, `${message} ${sentence(absent.consequence)}`, remedy);
  }
}

/** Refuse a name that appears twice in a list, naming the second one. */
function refuseRepeats(
  report: Report,
  named: readonly { name: string; at: Span }[],
  what: string,
): void {
  const seen = new Set<string>();
  for (const { name, at } of named) {
    if (seen.has(name)) {
      report.refuse(
        at,
        `There are two ${what} called "${name}".`,
        'Give one of them another name, or remove it.',
      );
    }
    seen.add(name);
  }
}

/** What a world runs without when a library is not there. */
const LIBRARY_GONE = 'every kind, enum, verb and message it holds reads as absent';
/** What a world runs without when one of its own files is not there. */
const FILE_GONE = 'everything it declared reads as absent, and its objects keep their state';

/**
 * The second tier: a closed bundle, checked whole. Strict at publish,
 * lenient at load.
 */
export function compileBundle(
  source: MicroworldSource,
  options: CompileOptions = {},
): BundleResult {
  const mode = options.mode ?? 'publish';
  const limits = options.limits ?? DEFAULT_LIMITS;
  const blessed = options.blessed ?? new Set<string>();
  const compilerLevel = options.compilerLevel ?? LANGUAGE_LEVEL;
  const { manifest, manifestFile } = source;
  const report = new Report(mode, manifestFile.span(0, 0));

  // --- what the world says it is ------------------------------------------

  if (!NAMESPACE.test(manifest.name)) {
    report.refuse(
      atKey(manifestFile, 'name'),
      `"${manifest.name}" cannot be a world's name.`,
      'A name starts with a lower-case letter and holds letters, digits and _.',
    );
  }
  if (manifest.namespace !== manifest.name && !NAMESPACE.test(manifest.namespace)) {
    report.refuse(
      atKey(manifestFile, 'namespace'),
      `"${manifest.namespace}" cannot be a world's namespace.`,
      'A namespace starts with a lower-case letter and holds letters, digits and _.',
    );
  }
  for (const [key, value] of [
    ['version', manifest.version],
    ['author', manifest.author],
    ['license', manifest.license],
  ] as const) {
    if (value.trim() === '') {
      report.refuse(
        atKey(manifestFile, key),
        `This world's ${key} is empty.`,
        key === 'license'
          ? 'Write the terms it is offered under, such as MIT.'
          : `Write the ${key} in the manifest.`,
      );
    }
  }
  if (manifest.version.trim() !== '' && !SEMVER.test(manifest.version)) {
    report.refuse(
      atKey(manifestFile, 'version'),
      `"${manifest.version}" is not a version.`,
      'A version is three numbers with dots, as in 0.1.0; a pre-release or build tag may follow, as in 1.2.0-beta.1.',
    );
  }
  if (!Number.isInteger(manifest.level) || manifest.level < 1) {
    report.refuse(
      atKey(manifestFile, 'level'),
      `A language level is a whole number from 1 up, not ${manifest.level}.`,
      'Write 1 if you are not sure which level this world needs.',
    );
  }

  const extensionsKey = atKey(manifestFile, 'extensions');
  for (const pin of manifest.extensions) {
    if (!Number.isInteger(pin.major) || pin.major < 0) {
      report.refuse(
        atValue(manifestFile, pin.name, extensionsKey),
        `The extension "${pin.name}" is pinned to major version ${pin.major}.`,
        'A major version is a whole number from 0 up.',
      );
    }
  }
  refuseRepeats(
    report,
    manifest.extensions.map((pin) => ({
      name: pin.name,
      at: atValue(manifestFile, pin.name, extensionsKey),
    })),
    'extensions pinned',
  );

  // --- the files the world is made of --------------------------------------

  const withheld = new Set(source.withheld ?? []);
  const filesKey = atKey(manifestFile, 'files');
  refuseRepeats(
    report,
    manifest.files.map((name) => ({ name, at: atValue(manifestFile, name, filesKey) })),
    'files named',
  );
  for (const name of manifest.files) {
    if (!isWorldFile(name)) {
      report.refuse(
        atValue(manifestFile, name, filesKey),
        `"${name}" is not a file this world can be made of.`,
        'A world is written in `.sprout` files and the `.prose` files they point at.',
      );
    }
  }

  const arrivedByName = new Map(source.files.map((file) => [file.name, file]));
  refuseRepeats(
    report,
    source.files.map((file) => ({ name: file.name, at: file.span(0, 0) })),
    'files',
  );

  // A file the host is withholding did not travel. At publish that
  // refuses: a world is not published with a piece held back. At load it
  // is a gap, and a reversible one — restoring the file brings its
  // objects back as they were, because their state was never touched.
  for (const name of withheld) {
    report.gap(
      {
        what: name,
        kind: 'file',
        reason: 'withheld',
        at: atValue(manifestFile, name, filesKey),
        consequence: FILE_GONE,
      },
      `The file "${name}" is being withheld.`,
      'Restore it, or publish the world without what it held.',
    );
  }

  // The manifest enumerates the world's own files, so what travelled is
  // checked against what was meant to rather than inferred from it.
  for (const name of manifest.files) {
    if (arrivedByName.has(name) || withheld.has(name)) continue;
    report.gap(
      {
        what: name,
        kind: 'file',
        reason: 'missing',
        at: atValue(manifestFile, name, filesKey),
        consequence: FILE_GONE,
      },
      `The manifest names the file "${name}", and it did not travel with the world.`,
      'Add the file, or take its name out of the manifest.',
    );
  }
  const named = new Set(manifest.files);
  for (const file of source.files) {
    if (named.has(file.name)) continue;
    report.strict(
      file.span(0, 0),
      `The file "${file.name}" travelled with this world and the manifest does not name it.`,
      'Name it among the world’s files, or leave it out of the world.',
    );
  }

  // --- the libraries it vendored -------------------------------------------

  // A closed bundle: everything the world says it uses travels with it,
  // because nothing is resolved or fetched at run time. A library that
  // did not travel, or whose source is not the source the manifest
  // recorded, is a gap — refused at publish, absent at load, where every
  // kind it holds reads as absent by the table's first row.
  const vendored = vendor(source.libraries, blessed);
  const byName = new Map(vendored.map((library) => [library.name, library]));
  const librariesKey = atKey(manifestFile, 'libraries');
  refuseRepeats(
    report,
    vendored.map((library) => ({
      name: library.name,
      at: library.files[0]?.span(0, 0) ?? librariesKey,
    })),
    'libraries vendored',
  );
  refuseRepeats(
    report,
    manifest.libraries.map((pin) => ({
      name: pin.name,
      at: atValue(manifestFile, pin.name, librariesKey),
    })),
    'libraries used',
  );

  const unusable = new Set<string>();
  for (const pin of manifest.libraries) {
    const at = atValue(manifestFile, pin.name, librariesKey);
    if (!NAMESPACE.test(pin.name)) {
      report.refuse(
        at,
        `"${pin.name}" cannot be a library's name.`,
        'A name starts with a lower-case letter and holds letters, digits and _.',
      );
    }
    const library = byName.get(pin.name);
    if (library === undefined) {
      unusable.add(pin.name);
      report.gap(
        { what: pin.name, kind: 'library', reason: 'missing', at, consequence: LIBRARY_GONE },
        `This world uses the library "${pin.name}", and its source did not travel with it.`,
        'A published world carries the full source of every library it uses: vendor it, or stop using it.',
      );
      continue;
    }
    if (library.hash !== pin.sha) {
      unusable.add(pin.name);
      report.gap(
        { what: pin.name, kind: 'library', reason: 'mismatched', at, consequence: LIBRARY_GONE },
        `The library "${pin.name}" that travelled is not the source the manifest recorded.`,
        'Vendor the library again, so that what travels and what the manifest records are one thing.',
      );
      continue;
    }
    if (library.version !== pin.version) {
      report.strict(
        at,
        `The manifest records "${pin.name}" at version ${pin.version}, and the source that travelled says ${library.version}.`,
        'The source is what runs; correct the version the manifest records.',
      );
    }
  }
  const used = new Set(manifest.libraries.map((pin) => pin.name));
  for (const library of vendored) {
    if (used.has(library.name)) continue;
    report.warn(
      library.files[0]?.span(0, 0) ?? librariesKey,
      `The library "${library.name}" travels with this world and the world does not use it.`,
      'Remove it from the world, or name it among the libraries the world uses.',
    );
  }
  for (const library of vendored) {
    refuseRepeats(
      report,
      library.files.map((file) => ({ name: file.name, at: file.span(0, 0) })),
      `files in the library "${library.name}"`,
    );
  }

  // A library whose source is not the recorded source is not used at
  // all. Running a world against a library it did not mean to vendor
  // would be worse than running it without one.
  const usable = vendored.filter((library) => !unusable.has(library.name));

  // --- the level, the caps, and the files themselves ------------------------

  // A bundle's level is the highest of any of its parts, library source
  // included, and a runtime refuses text newer than its compiler — in
  // either mode, because a compiler cannot read what it does not know.
  const level = usable.reduce(
    (highest, library) => Math.max(highest, library.level),
    manifest.level,
  );
  if (level > compilerLevel) {
    const newer = usable.filter((library) => library.level > compilerLevel);
    report.refuse(
      newer.length > 0 && manifest.level <= compilerLevel
        ? librariesKey
        : atKey(manifestFile, 'level'),
      `This world needs Sprout level ${level}, and this one understands level ${compilerLevel}.`,
      newer.length > 0
        ? `The newer part is the library "${newer[0]!.name}". Update Sprout, or vendor a copy written for level ${compilerLevel}.`
        : 'Update Sprout, or rewrite the world for the level this one understands.',
    );
  }

  // Blessed library source costs the author nothing; a modified copy is
  // the author's own source and counts as it.
  const arrived = source.files.filter((file) => !withheld.has(file.name));
  const exemptBytes = usable
    .filter((library) => library.blessed)
    .reduce((bytes, library) => bytes + library.bytes, 0);
  const ownBytes = arrived.reduce((bytes, file) => bytes + bytesOf(file.text), 0);
  const charged = usable.filter((library) => !library.blessed);
  const sourceBytes = ownBytes + charged.reduce((bytes, library) => bytes + library.bytes, 0);
  const files =
    arrived.length + charged.reduce((count, library) => count + library.files.length, 0);

  // The spec's Limits says a host refuses a bundle checked against larger
  // static caps than its own, unless it has recorded an exception for that
  // world — and the host's way of recording one is B43's. Until B43 lands
  // no exception exists to grant, so a cap over the host's own refuses at
  // load exactly as it does at publish.
  if (limits.caps.sourceBytes !== null && sourceBytes > limits.caps.sourceBytes) {
    report.refuse(
      atKey(manifestFile, 'name'),
      `This world is ${sourceBytes} bytes of source, and ${limits.caps.sourceBytes} is as much as it may be.`,
      'Take something out, or use a library the host has blessed, whose source costs nothing.',
    );
  }
  if (limits.caps.files !== null && files > limits.caps.files) {
    report.refuse(
      atKey(manifestFile, 'name'),
      `This world is ${files} files, and ${limits.caps.files} is as many as it may have.`,
      'Put more in each file, or take something out.',
    );
  }
  // The first tier, over every file in the closed bundle — the world's
  // own and every usable library's, because they compile together. A
  // file that does not compile refuses at publish; at load it reads as
  // absent, and what referred to it keeps compiling.
  const readable: { library: string; file: SourceFile }[] = [
    ...arrived.map((file) => ({ library: manifest.namespace, file })),
    ...usable.flatMap((library) => library.files.map((file) => ({ library: library.name, file }))),
  ];
  const declarations: Declaration[] = [];
  const byLibrary = new Map<string, Declaration[]>();
  /** Whether one of the world's own files was refused by the first tier. */
  let ownFileRefused = false;
  for (const { library, file } of readable) {
    const shape = checkShape(file, limits.caps);
    const refused = shape.diagnostics.some((d) => d.severity === 'refusal');
    if (refused && library === manifest.namespace) ownFileRefused = true;
    if (!refused) {
      declarations.push(...shape.declarations);
      byLibrary.set(library, [...(byLibrary.get(library) ?? []), ...shape.declarations]);
      report.diagnostics.add(...shape.diagnostics);
      continue;
    }
    if (mode === 'publish') {
      report.diagnostics.add(...shape.diagnostics);
      continue;
    }
    // A file that does not compile reads as absent: what it declared is
    // not in the world, and what referred to it keeps compiling.
    report.absent.push({
      what: file.name,
      kind: 'file',
      reason: 'broken',
      at: shape.diagnostics[0]!.at,
      consequence: FILE_GONE,
    });
    for (const diagnostic of shape.diagnostics) {
      report.diagnostics.add(
        diagnostic.severity === 'refusal' ? { ...diagnostic, severity: 'warning' } : diagnostic,
      );
    }
  }

  // --- the one `world` declaration, named as the manifest -----------------

  // The world model › The manifest: "A bundle holds exactly one `world`
  // declaration, and its name is the manifest's `name`: none, more than
  // one, or one under another name is refused." Only the world's OWN
  // declarations are read for this, never a library's.
  const ownWorlds = (byLibrary.get(manifest.namespace) ?? []).filter(
    (d): d is WorldDeclaration => d.kind === 'world',
  );
  // At publish, a file the first tier refused may well be the one that
  // holds the world, and the bundle is refused for that defect already,
  // so "none" is not said until every file reads. At load that file is
  // absent instead, and "none" is answered over what is usable, the same
  // as every other gap.
  const noneToRead = mode === 'publish' && ownFileRefused;
  if (ownWorlds.length === 0 && !noneToRead) {
    report.gap(
      {
        what: manifest.name,
        kind: 'world',
        reason: 'missing',
        at: atKey(manifestFile, 'name'),
        consequence: 'the world admits no one until it has one',
      },
      'This world has no `world` declaration.',
      `Write one, in one of its files: \`world ${manifest.name}: sprout.World { … }\`.`,
    );
  } else if (ownWorlds.length > 1) {
    // There is no principled way to choose among several, so every one
    // after the first is the same gap: the world does not have the one
    // declaration the manifest needs.
    for (const extra of ownWorlds.slice(1)) {
      report.gap(
        {
          what: extra.name.text,
          kind: 'world',
          reason: 'missing',
          at: extra.name.at,
          consequence: 'the world admits no one until there is one',
        },
        'There are two `world` declarations, and a world has one.',
        'Remove one, or move what it holds into the other.',
      );
    }
  } else if (ownWorlds.length === 1 && ownWorlds[0]!.name.text !== manifest.name) {
    const named = ownWorlds[0]!;
    report.refuse(
      named.name.at,
      `\`${named.name.text}\` is not this world's name.`,
      `The manifest names it \`${manifest.name}\`; write \`world ${manifest.name}: sprout.World { … }\`, or change the manifest.`,
    );
  }

  // A library is vendored source, not the world: only the world's own
  // files may declare it, or anything in its tree.
  for (const [library, declared] of byLibrary) {
    if (library === manifest.namespace) continue;
    for (const stray of declared) {
      if (stray.kind !== 'world' && stray.kind !== 'object') continue;
      report.refuse(
        stray.name.at,
        stray.kind === 'world'
          ? 'A library does not declare a world.'
          : `A library does not declare an object, and \`${stray.name.text}\` is one.`,
        stray.kind === 'world'
          ? "The world's own files do; move it there, or remove it from the library."
          : "The world's own files do; move it there, or declare a kind here for the world to make it of.",
      );
    }
  }

  // The second tier over what parsed.
  const tables = resolveDeclarations(
    byLibrary,
    { namespace: manifest.namespace, name: manifest.name },
    report,
  );

  // --- where visitors arrive ----------------------------------------------

  // Read from the world's one declaration, without composing the world.
  // A world missing, doubled or misnamed has been said, and nothing more
  // is said about where its visitors arrive. As for the world itself, at
  // publish a file the first tier refused may be where the place was
  // declared, so its absence is not said until every file reads; and
  // what left the place absent, where that has been told, is not told
  // twice. At load the gap is recorded either way.
  const theWorld =
    ownWorlds.length === 1 && ownWorlds[0]!.name.text === manifest.name ? ownWorlds[0]! : null;
  let arrival: TreePath | null = null;
  if (theWorld !== null) {
    const found = resolveArrival(theWorld, {
      tree: tables.tree,
      objects: tables.composed,
      kinds: tables.kinds,
      from: manifest.namespace,
      diagnostics: report.diagnostics,
    });
    if (found.found === 'place') arrival = found.path;
    else if (found.found === 'absent' && !(mode === 'publish' && (found.said || ownFileRefused))) {
      report.gap(
        {
          what: writtenPath(found.path),
          kind: 'place-of-arrival',
          reason: 'missing',
          at: found.at,
          consequence: absenceRule('place-of-arrival').consequence,
        },
        found.message,
        found.remedy,
      );
    }
  }

  // The kinds, objects and places caps count what resolved, on the same
  // footing as the source and file caps above, and so refuse at load too.
  const own = byLibrary.get(manifest.namespace) ?? [];
  const counts = countWorld(
    {
      kinds: [own, ...charged.map((library) => byLibrary.get(library.name) ?? [])].flatMap(
        (declared) => declared.filter((d): d is KindDeclaration => d.kind === 'kind'),
      ),
      objects: own.filter((d): d is ObjectDeclaration => d.kind === 'object'),
      composed: tables.composed,
    },
    limits.caps,
    report.diagnostics,
  );

  // A world accepted at one level keeps loading when the language
  // tightens: a refusal introduced after that level applies to it as a
  // warning. The level it was ACCEPTED at is the bundle's — the highest
  // of any of its parts — and not the one the manifest was written for,
  // which can be lower when a library it vendored is newer.
  const diagnostics =
    mode === 'load'
      ? softenPolicy(report.diagnostics.sorted(), level)
      : report.diagnostics.sorted();
  if (diagnostics.some((d) => d.severity === 'refusal')) return { bundle: null, diagnostics };

  // The files that actually arrived are what the world runs on, so they
  // are what it hashes. A publish hashes the whole of what was
  // published; a load with a file withheld is honestly a different
  // bundle, and the log records the withholding as its own event.
  const bundle: Bundle = {
    manifest,
    definitions: declarations,
    kinds: tables.kinds.all(),
    objects: tables.objects,
    tree: tables.tree,
    arrival,
    // B27 fills this from nouns, tokens, directions, articles,
    // connectors and phrase words, once there is a grammar to read.
    words: [],
    level,
    extensions: manifest.extensions,
    libraries: usable,
    caps: limits.caps,
    size: { files, sourceBytes, exemptBytes, ...counts },
    absent: report.absent,
    hash: bundleHashOf(manifest, arrived, usable),
  };
  return { bundle, diagnostics };
}
