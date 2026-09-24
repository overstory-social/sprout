// What the runtime's specs load a world from: a real bundle, compiled
// through `compileBundle` from the files given, under a manifest naming
// exactly them and pinning the standard library, which travels with it
// blessed, as a host starts from. A case writes its world in as few files
// as it likes, and each kind is given the file named for it before the
// world compiles, since what these specs test is not where a kind is
// written. Spec support: the package build leaves it out.

import { libraryHash, type Bundle, type Manifest } from '../bundle/bundle.js';
import { compileBundle, type BundleResult } from '../bundle/compile/compile.js';
import { DEFAULT_LIMITS, type Limits } from '../bundle/limits.js';
import { STANDARD_LIBRARY } from '../bundle/standard-library.js';
import { fileNamedFor } from '../declare/file-names.js';
import type { Extension } from '../declare/extensions.js';
import { Diagnostics } from '../source/diagnostics.js';
import { SourceFile } from '../source/source.js';
import type { KindDeclaration } from '../syntax/ast.js';
import { parseDeclarations } from '../syntax/parse.js';

export interface WorldOptions {
  /** Strict unless a case says otherwise. */
  readonly mode?: 'publish' | 'load';
  /** Files the host holds back; they read as absent at load. */
  readonly withheld?: readonly string[];
  readonly limits?: Limits;
  /** The extensions the manifest pins, none unless a case says so. */
  readonly pins?: Manifest['extensions'];
  /** The extensions the host installed, none unless a case says so. */
  readonly installed?: readonly Extension[];
}

/** `text` with everything outside `[start, end)` blanked and its lines kept, so what stays reads at its own line and column. */
function only(text: string, start: number, end: number): string {
  const blank = (part: string): string => part.replace(/[^\n]/g, ' ');
  return `${blank(text.slice(0, start))}${text.slice(start, end)}${blank(text.slice(end))}`;
}

/**
 * `files` with every kind moved to the file named for it, at the line and
 * column it was written at where that file is new, and what is withheld
 * widened to the files moved out of a withheld one.
 */
function laidOut(
  files: Readonly<Record<string, string>>,
  withheld: readonly string[] = [],
): { files: Record<string, string>; withheld: string[] } {
  const out: Record<string, string> = { ...files };
  const held = new Set(withheld);
  const moved: { target: string; alone: string; written: string }[] = [];
  for (const [name, text] of Object.entries(files)) {
    if (!name.endsWith('.sprout')) continue;
    const kinds = parseDeclarations(new SourceFile(name, text), new Diagnostics()).filter(
      (d): d is KindDeclaration => d.kind === 'kind' && fileNamedFor(d.name.text) !== name,
    );
    let kept = text;
    for (const { name: kindName, at } of kinds) {
      const target = fileNamedFor(kindName.text);
      moved.push({
        target,
        alone: only(text, at.start, at.end),
        written: text.slice(at.start, at.end),
      });
      kept = `${kept.slice(0, at.start)}${' '.repeat(at.end - at.start)}${kept.slice(at.end)}`;
      if (held.has(name)) held.add(target);
    }
    out[name] = kept;
  }
  for (const { target, alone, written } of moved) {
    out[target] = target in out ? `${out[target]}\n${written}\n` : alone;
  }
  return { files: out, withheld: [...held] };
}

/**
 * Compile `files`, by name and text, as the world `name`. A world that
 * does not compile throws with what was said, since a fixture that does
 * not compile proves nothing.
 */
export function compiledWorld(
  name: string,
  files: Readonly<Record<string, string>>,
  options: WorldOptions = {},
): Bundle {
  const { bundle, diagnostics } = compileWorld(name, files, options);
  if (bundle === null) {
    throw new Error(diagnostics.map((diagnostic) => diagnostic.message).join('\n'));
  }
  return bundle;
}

/** Compile `files` as the world `name`, as `compiledWorld` does, with what was said and no throw. */
export function compileWorld(
  name: string,
  files: Readonly<Record<string, string>>,
  options: WorldOptions = {},
): BundleResult {
  const { files: laid, withheld } = laidOut(files, options.withheld);
  const sha = libraryHash(STANDARD_LIBRARY);
  const manifest: Manifest = {
    name,
    namespace: name,
    version: '0.1.0',
    author: 'Eric Eslinger',
    license: 'MIT',
    level: 1,
    extensions: options.pins ?? [],
    libraries: [{ name: STANDARD_LIBRARY.name, version: STANDARD_LIBRARY.version, sha }],
    files: Object.keys(laid),
  };
  return compileBundle(
    {
      manifestFile: new SourceFile('sprout.json', JSON.stringify(manifest, null, 2)),
      manifest,
      files: Object.entries(laid).map(([file, text]) => new SourceFile(file, text)),
      libraries: [STANDARD_LIBRARY],
      ...(withheld.length === 0 ? {} : { withheld }),
    },
    {
      mode: options.mode ?? 'publish',
      limits: options.limits ?? DEFAULT_LIMITS,
      extensions: options.installed ?? [],
    },
  );
}

/**
 * A small shop: a world that is open, two rooms, a shelf holding a jar
 * and a cup, `Person` for visitors to be made of, sharing `Creature`
 * with any NPC a case declares, and a box and a kiln whose kind `Crate`
 * lives in `crate.sprout`, each kind in the file named for it. Withhold
 * `crate.sprout` at load and the box and the kiln are absent, while the
 * tin the box holds still composes.
 */
export const SHOP: Readonly<Record<string, string>> = {
  'printers_shop.sprout': [
    'world printers_shop is sprout.World { contains visitors are Person visitors arrive at hall :open true',
    '  object hall is Room {',
    '    object shelf is Shelf {',
    '      object jar is Jar',
    '      object cup is Jar',
    '    }',
    '    object box is Crate {',
    '      object tin is Jar',
    '    }',
    '  }',
    '  object yard is Room {',
    '    object kiln is Crate',
    '  }',
    '}',
    'enum Glaze { none, shino, tenmoku }',
    '',
  ].join('\n'),
  'room.sprout': 'kind Room { contains actors :lit true }\n',
  'shelf.sprout': 'kind Shelf { contains }\n',
  'jar.sprout':
    'kind Jar { :glaze Glaze default none :fill 3 min 0 max 9 remembers { :seen false } }\n',
  'creature.sprout': 'kind Creature is sprout.Actor { :score 0 }\n',
  'person.sprout': 'kind Person is Creature, sprout.Visitor { }\n',
  'crate.sprout': 'kind Crate { contains :lid false }\n',
};

/** The shop as published. */
export const shop = (): Bundle => compiledWorld('printers_shop', SHOP);

/** The shop loaded with `crate.sprout` withheld: `Crate` and the kiln are absent. */
export const shopWithheld = (): Bundle =>
  compiledWorld('printers_shop', SHOP, { mode: 'load', withheld: ['crate.sprout'] });
