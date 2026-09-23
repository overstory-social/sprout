// Compiling, in two tiers and two modes (the spec's The compiler › Two
// tiers, Strict and lenient, What absent means).
//
// THE TIERS. A single definition can be checked ALONE for its shape:
// syntax, the caps that apply to it, its own declarations agreeing with
// themselves, every write going to `self`. That is `checkShape`, in
// `first-tier.ts`, and it is what an editor runs on each keystroke.
// Everything typed needs the
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
//
// `compileBundle` runs the steps in order, each a module of this folder
// taking the report: the caps to check against, the manifest's own
// fields, the files, the libraries, what the bundle weighs, the first tier over every file, the
// one world, the declarations, what the world and its visitors are made
// of, where visitors arrive, which actors may be declared where, the
// bodies every kind writes, and which of them destroy a declared object.

import type { KindDeclaration } from '../../syntax/ast.js';
import type { CompileMode } from '../absent.js';
import { bundleHashOf, LANGUAGE_LEVEL } from '../bundle.js';
import type { Bundle, MicroworldSource } from '../bundle.js';
import { softenPolicy, type Diagnostic } from '../../source/diagnostics.js';
import { resolveDeclarations } from '../declarations.js';
import { checkActors } from '../../declare/actors.js';
import { everyContent } from '../../declare/contents.js';
import { countWorld } from '../counts.js';
import { DEFAULT_LIMITS, type Limits } from '../limits.js';
import { arrivalPlace } from './arrival.js';
import { checkBodies } from './bodies.js';
import { warnDestroyingDeclared } from './destroyed.js';
import { checkFiles } from './files.js';
import { readFirstTier } from './first-tier.js';
import { checkLibraries } from './libraries.js';
import { checkManifest } from './manifest-fields.js';
import { capsToCheck, type RecordedCaps } from './recorded.js';
import { Report } from './report.js';
import { weighBundle } from './weight.js';
import { oneWorld, worldKinds } from './world.js';

/** What a host brings to a compile. */
export interface CompileOptions {
  /** Strict at save and publish, lenient at load. Strict unless a host says otherwise. */
  readonly mode?: CompileMode;
  /** The host's limits. The caps a bundle is checked against are recorded in it. */
  readonly limits?: Limits;
  /**
   * At load, the caps the world was checked against when it was
   * published and whether the host made an exception for it. Unread at
   * publish, which is checked against the host's own caps.
   */
  readonly recorded?: RecordedCaps;
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

/** What compiling a bundle makes of it: the bundle, or nothing, and everything there was to say. */
export interface BundleResult {
  readonly bundle: Bundle | null;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * The second tier: a closed bundle, checked whole. Strict at publish,
 * lenient at load.
 */
export function compileBundle(
  source: MicroworldSource,
  options: CompileOptions = {},
): BundleResult {
  const limits = options.limits ?? DEFAULT_LIMITS;
  const { manifest, manifestFile } = source;
  const report = new Report(options.mode ?? 'publish', manifestFile.span(0, 0));
  const caps = capsToCheck(limits.caps, options.recorded, manifestFile, report);

  checkManifest(source, report);
  const withheld = checkFiles(source, report);
  const usable = checkLibraries(source, options.blessed ?? new Set<string>(), report);
  const { level, arrived, charged, files, sourceBytes, exemptBytes } = weighBundle(
    source,
    usable,
    withheld,
    caps,
    options.compilerLevel ?? LANGUAGE_LEVEL,
    report,
  );
  const { declarations, byLibrary, ownFileRefused } = readFirstTier(
    arrived,
    usable,
    manifest.namespace,
    caps,
    report,
  );
  const theWorld = oneWorld(source, byLibrary, ownFileRefused, report);

  // The second tier over what parsed.
  const tables = resolveDeclarations(
    byLibrary,
    { namespace: manifest.namespace, name: manifest.name },
    report,
  );
  // A world missing, doubled or misnamed has been said, and nothing more
  // is said about what it is made of or where its visitors arrive.
  const { world, visitor } =
    theWorld === null
      ? { world: null, visitor: null }
      : worldKinds(theWorld, tables, manifest.namespace, ownFileRefused, report);
  const arrival =
    theWorld === null ? null : arrivalPlace(theWorld, tables, manifest.namespace, report);
  checkActors({
    tree: tables.tree,
    objects: tables.composed,
    world,
    visitor,
    diagnostics: report.diagnostics,
  });

  // Every body, against the kind that wrote it: a kind's content once,
  // however many instances hold a copy.
  checkBodies(
    [
      ...tables.kinds.all(),
      ...everyContent(tables.contents).flatMap(({ kind }) => (kind === null ? [] : [kind])),
      ...tables.composed.flatMap(({ kind, giver }) =>
        kind === null || giver !== null ? [] : [kind],
      ),
      ...(world === null ? [] : [world]),
    ],
    { kinds: tables.kinds, verbs: tables.verbs, visitor, diagnostics: report.diagnostics },
  );
  warnDestroyingDeclared(tables.composed, tables.tree, report.diagnostics);

  // The kinds, objects and places caps count what resolved, on the same
  // footing as the source and file caps, and so refuse at load too.
  const own = byLibrary.get(manifest.namespace) ?? [];
  const counts = countWorld(
    {
      kinds: [own, ...charged.map((library) => byLibrary.get(library.name) ?? [])].flatMap(
        (declared) => declared.filter((d): d is KindDeclaration => d.kind === 'kind'),
      ),
      objects: tables.composed.map((object) => object.declaration),
      composed: tables.composed,
    },
    caps,
    report.diagnostics,
  );

  // A world accepted at one level keeps loading when the language
  // tightens: a refusal introduced after that level applies to it as a
  // warning. The level it was ACCEPTED at is the bundle's — the highest
  // of any of its parts — and not the one the manifest was written for,
  // which can be lower when a library it vendored is newer.
  const diagnostics =
    report.mode === 'load'
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
    kindLookup: tables.kinds,
    verbs: tables.verbs,
    contents: tables.contents,
    world,
    visitor,
    objects: tables.objects,
    tree: tables.tree,
    arrival,
    // B27 fills this from nouns, tokens, directions, articles,
    // connectors and phrase words, once there is a grammar to read.
    words: [],
    level,
    extensions: manifest.extensions,
    libraries: usable,
    caps,
    size: { files, sourceBytes, exemptBytes, ...counts },
    absent: report.absent,
    hash: bundleHashOf(manifest, arrived, usable),
  };
  return { bundle, diagnostics };
}
