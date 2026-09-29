import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fileNamedFor } from '@overstory/sprout/lang';

import { checkWorld } from '../check.js';
import { applyScaffold, importsFor, withImports, type Scaffolded } from './edits.js';

// `sprout scaffold kind` and `sprout scaffold object`: a declaration
// written into a world, in a file of its own by default and appended to an
// existing one where `--path` names it, with the imports it needs; the
// world checked with it, and nothing written where it would not compile.

/** A kind's name as a kind is written: a capital, then letters and digits. */
const KIND_NAME = /^[A-Z][A-Za-z0-9]*$/;
/** An object's name as an object is written: lower case, digits and `_`. */
const OBJECT_NAME = /^[a-z][a-z0-9_]*$/;

/** What `--is` names, each kind by its name, `sprout.Container` or `Key`. */
function kindsOf(is: string | undefined): string[] {
  return is === undefined
    ? []
    : is
        .split(',')
        .map((one) => one.trim())
        .filter((one) => one !== '');
}

/**
 * `declaration` written into the world in `dir`, with what it composes
 * imported: in a new file named for it, or appended to `path` where one is
 * given. The file named for it being there already is refused, since only
 * `--path` adds to a file.
 */
function scaffoldDeclaration(
  dir: string,
  named: string,
  path: string | undefined,
  kinds: readonly string[],
  declaration: string,
): Scaffolded {
  if (path === undefined && existsSync(join(dir, named))) {
    return {
      ok: false,
      page: `${named} is there already. Write --path ${named} to add to it, or --path another.sprout. Nothing was written.\n`,
    };
  }
  const file = path ?? named;
  const checked = checkWorld(dir);
  if (checked.bundle === null) {
    return {
      ok: false,
      page: 'The world does not compile as it is; `sprout check` says why. Nothing was written.\n',
    };
  }
  const needs = importsFor(kinds, file, checked.bundle);
  if ('missing' in needs) return { ok: false, page: `${needs.missing} Nothing was written.\n` };
  const at = join(dir, file);
  // A new file opens with its imports; an existing one keeps its own, the new ones after them.
  const text = existsSync(at)
    ? withImports(
        `${readFileSync(at, 'utf8').replace(/\n*$/, '')}\n\n${declaration}`,
        needs.imports,
      )
    : `${needs.imports.map((one) => `${one}\n`).join('')}${needs.imports.length > 0 ? '\n' : ''}${declaration}`;
  return applyScaffold(dir, [{ file, text }]);
}

/** `sprout scaffold kind <Name> [dir] [--path file] [--is Kind,…]`. */
export function scaffoldKind(name: string, dir: string, path?: string, is?: string): Scaffolded {
  if (!KIND_NAME.test(name)) {
    return {
      ok: false,
      page: `A kind's name begins with a capital and holds letters and digits: \`${name}\` does not. Write \`Key\`.\n`,
    };
  }
  const kinds = kindsOf(is);
  const composes = kinds.length === 0 ? '' : ` is ${kinds.join(', ')}`;
  return scaffoldDeclaration(dir, fileNamedFor(name), path, kinds, `kind ${name}${composes} { }\n`);
}

/** `sprout scaffold object <name> [dir] --in path --is Kind,… [--path file]`. */
export function scaffoldObject(
  name: string,
  dir: string,
  into: string | undefined,
  is: string | undefined,
  path?: string,
): Scaffolded {
  if (!OBJECT_NAME.test(name)) {
    return {
      ok: false,
      page: `An object's name is lower case, digits and \`_\`: \`${name}\` is not. Write \`brass_key\`.\n`,
    };
  }
  if (into === undefined) {
    return {
      ok: false,
      page: 'Say what holds it after `--in`, as the world names it: --in hall\n',
    };
  }
  const kinds = kindsOf(is);
  if (kinds.length === 0) {
    return {
      ok: false,
      page: 'Say what it is made of after `--is`: --is sprout.Container, or a kind of the world’s\n',
    };
  }
  return scaffoldDeclaration(
    dir,
    fileNamedFor(name),
    path,
    kinds,
    `object ${name} is ${kinds.join(', ')} in ${into} { }\n`,
  );
}
