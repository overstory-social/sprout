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
// fields, the files, the libraries, what the bundle weighs, the first tier over every file,
// the `.prose` files each kind points at, the one world, the extensions it
// pins, the declarations, what the world and its visitors are made
// of, where visitors arrive, which actors may be declared where, the
// bodies every kind writes, which of them destroy a declared object, and
// what they leave unsent, unhandled, untimed, unheard, unplayed, unfilled
// or unsaid.

import type { KindDeclaration } from '../../syntax/ast.js';
import type { CompileMode } from '../absent.js';
import { DEFAULT_BLESSED } from '../blessed.js';
import { bundleHashOf, LANGUAGE_LEVEL } from '../bundle.js';
import type { Bundle, MicroworldSource } from '../bundle.js';
import { softenPolicy, type Diagnostic } from '../../source/diagnostics.js';
import { resolveDeclarations, unknownMessageGap } from '../declarations.js';
import { kindName } from '../../declare/kinds.js';
import type { Named } from '../../declare/names.js';
import type { Node } from '../../source/nodes.js';
import { describeWord } from '../../syntax/ast-speech.js';
import { checkActors, isVisitorKind } from '../../declare/actors.js';
import { WORLD } from '../../declare/sprout-world.js';
import { everyContent } from '../../declare/contents.js';
import { hereKindOf } from '../../declare/places.js';
import { countWorld } from '../counts.js';
import { DEFAULT_LIMITS, type Limits } from '../limits.js';
import { arrivalPlace } from './arrival.js';
import { checkBodies, type Written } from './bodies.js';
import { warnUnheard } from './unheard.js';
import { warnDestroyingDeclared } from './destroyed.js';
import { warnUnsentAndUnhandled } from './events.js';
import { warnUntimed } from './timed.js';
import { warnUnsaid } from './unsaid.js';
import { warnUnplayed } from './unplayed.js';
import { spawnedKinds } from './written.js';
import { checkFiles } from './files.js';
import { readFirstTier } from './first-tier.js';
import { attachProse } from './prose.js';
import { absenceRule } from '../absent.js';
import { checkLibraries } from './libraries.js';
import { checkManifest } from './manifest-fields.js';
import { pinnedExtensions } from './extensions.js';
import type { Extension } from '../../declare/extensions.js';
import { capsToCheck, type RecordedCaps } from './recorded.js';
import { Report } from './report.js';
import { weighBundle } from './weight.js';
import { wordSetOf } from '../words.js';
import { objectsIn } from '../../declare/objects.js';
import { oneWorld, worldKinds } from './world.js';

/** What a host brings to a compile. */
export interface CompileOptions {
  /** Strict at save and publish, lenient at load. Strict unless a host says otherwise. */
  readonly mode?: CompileMode;
  /** The host's limits. The caps a bundle is checked against are recorded in it. */
  readonly limits?: Limits;
  /**
   * At load, the caps the world was checked against when it was
   * published, and whether the host made an exception for it. Unread at
   * publish, which is checked against the host's own caps.
   */
  readonly recorded?: RecordedCaps;
  /**
   * The library hashes the host blesses now, `DEFAULT_BLESSED` unless it
   * says otherwise. A blessed library costs the author nothing toward the
   * caps, at publish and at every load alike (the spec's Host › Two
   * decisions).
   */
  readonly blessed?: ReadonlySet<string>;
  /** The level this compiler understands. Text needing a newer one is refused, in either mode. */
  readonly compilerLevel?: number;
  /**
   * The extensions the host installed, none unless it says otherwise
   * (the spec's The host contract › Two decisions). One the world pins
   * and the host lacks at that major refuses at publish, and is absent at load.
   */
  readonly extensions?: readonly Extension[];
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
  const usable = checkLibraries(source, report);
  const { level, arrived, charged, files, sourceBytes, exemptBytes } = weighBundle(
    source,
    usable,
    options.blessed ?? DEFAULT_BLESSED,
    withheld,
    caps,
    options.compilerLevel ?? LANGUAGE_LEVEL,
    report,
  );
  const first = readFirstTier(arrived, usable, manifest.namespace, caps, report);
  const { ownFileRefused } = first;
  const { declarations, byLibrary, gone } = attachProse(
    first.byLibrary,
    { prose: first.prose, named: new Set(manifest.files) },
    report,
  );
  const theWorld = oneWorld(source, byLibrary, ownFileRefused, report);

  // The second tier over what parsed, with the extensions the world pins
  // against the ones the host installed.
  const extensions = pinnedExtensions(source, options.extensions ?? [], byLibrary, report);
  const tables = resolveDeclarations(
    byLibrary,
    { namespace: manifest.namespace, name: manifest.name },
    report,
    extensions,
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
    diagnostics: report.diagnostics,
  });

  // Every composed kind: the named ones, what each gives its instances,
  // every declared object's own, and the world's.
  const everyKind = [
    ...tables.kinds.all(),
    ...everyContent(tables.contents).flatMap(({ kind }) => (kind === null ? [] : [kind])),
    ...tables.composed.flatMap(({ kind, giver }) =>
      kind === null || giver !== null ? [] : [kind],
    ),
    ...(world === null ? [] : [world]),
  ];

  // Every body, against the kind that wrote it: a kind's content once,
  // however many instances hold a copy.
  const names = new Map<Node, Named>();
  const written: Written[] = [
    ...tables.kinds.all().map((kind) => ({
      kind,
      vantage: { in: 'kind' as const, giver: kindName(kind), path: [], self: kind },
    })),
    ...everyContent(tables.contents).flatMap(({ kind, giver, path }) =>
      kind === null ? [] : [{ kind, vantage: { in: 'kind' as const, giver, path, self: kind } }],
    ),
    ...tables.composed.flatMap((object) => {
      const placement = tables.tree.placements.get(object);
      return object.kind === null || object.giver !== null || placement === undefined
        ? []
        : [{ kind: object.kind, vantage: { in: 'tree' as const, path: placement.path } }];
    }),
    ...(world === null ? [] : [{ kind: world, vantage: { in: 'tree' as const, path: [] } }]),
  ];
  const { optionSlots, unheard } = checkBodies(written, {
    kinds: tables.kinds,
    here: hereKindOf(everyKind, tables.kinds),
    verbs: tables.verbs,
    diagnostics: report.diagnostics,
    messages: { lookup: tables.messages, onUnknown: unknownMessageGap(report) },
    source: { tree: tables.tree, contents: tables.contents },
    world,
    names,
    extensions,
    absentPassage: (self, name, at) => {
      if (![...self.composes].some((identity) => gone.has(identity))) return false;
      // At publish the file's absence is the one refusal; at load each
      // passage it held is a gap where it is said.
      if (report.mode === 'publish') return true;
      report.gap(
        {
          what: name,
          kind: 'passage',
          reason: 'missing',
          at,
          consequence: absenceRule('passage').consequence,
        },
        `\`${self.name}\` has no passage \`${name}\` while its \`.prose\` file is absent.`,
        'Restore the file, or give the words here in quotes.',
      );
      return true;
    },
    emptiedDescribe: (self, describe) => {
      // At load each passage it names is a gap already; at publish the
      // description is refused for what the file's absence leaves it.
      if (report.mode !== 'publish') return;
      if (![...self.composes].some((identity) => gone.has(identity))) return;
      report.diagnostics.refuse(
        describeWord(describe),
        `This \`describe\` says nothing while \`${self.name}\`'s \`.prose\` file is absent: every \`text\` in it names a passage that file holds.`,
        'Restore the file, or give the description words of its own in quotes, as in `text "A lever, waist high."`.',
      );
    },
  });
  warnDestroyingDeclared(tables.composed, tables.tree, report.diagnostics);
  warnUnsentAndUnhandled({
    kinds: everyKind,
    messages: tables.messages,
    namespace: manifest.namespace,
    diagnostics: report.diagnostics,
  });
  warnUntimed({
    kinds: everyKind,
    lookup: tables.kinds,
    composed: tables.composed,
    tree: tables.tree,
    namespace: manifest.namespace,
    diagnostics: report.diagnostics,
  });
  // A refused bundle is missing what was refused, so nothing is said of
  // the passages nothing says, or of what its verbs' plays leave
  // unplayed, unfilled or unsaid.
  if (!report.diagnostics.refused) {
    warnUnheard({
      written,
      unheard,
      kinds: tables.kinds,
      namespace: manifest.namespace,
      diagnostics: report.diagnostics,
    });
    const unplayed = warnUnplayed({
      takingPart: [
        ...new Set([
          ...tables.composed.flatMap(({ kind }) => (kind === null ? [] : [kind])),
          ...everyContent(tables.contents).flatMap(({ kind }) => (kind === null ? [] : [kind])),
          ...(world === null ? [] : [world]),
          ...(visitor === null ? [] : [visitor]),
          ...spawnedKinds(everyKind, tables.kinds).map(({ kind }) => kind),
        ]),
      ],
      kinds: everyKind,
      verbs: tables.verbs.all(),
      namespace: manifest.namespace,
      diagnostics: report.diagnostics,
    });
    warnUnsaid({
      kinds: everyKind,
      verbs: tables.verbs.all().filter((verb) => !unplayed.has(verb)),
      namespace: manifest.namespace,
      diagnostics: report.diagnostics,
    });
  }

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
    messages: tables.messages,
    names,
    optionSlots,
    contents: tables.contents,
    world,
    visitor,
    objects: tables.objects,
    tree: tables.tree,
    arrival,
    words: wordSetOf({
      kinds: everyKind,
      named: tables.kinds.all().filter((kind) => !kind.composes.has(WORLD) && !isVisitorKind(kind)),
      identifiers: declarations.flatMap((declared) =>
        declared.kind === 'world' || declared.kind === 'kind'
          ? objectsIn(declared).map(({ declaration }) => declaration.name.text)
          : [],
      ),
      verbs: tables.verbs.all(),
    }),
    level,
    extensions: [...extensions.pinned.values()],
    libraries: usable,
    caps,
    size: { files, sourceBytes, exemptBytes, ...counts },
    absent: report.absent,
    hash: bundleHashOf(manifest, arrived, usable),
  };
  return { bundle, diagnostics };
}
