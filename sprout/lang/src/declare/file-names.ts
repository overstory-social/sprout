// Which file a kind and the world are declared in (the spec's The world
// model › Objects: "Each kind is declared in a file of its own, named for
// it: `kind Chest` in `chest.sprout`", and "The world is declared in the
// file named for the world's name"). Enums, verbs and messages may sit in
// any file; a library's files are held to the same rule. A file named for
// a name is that name in lower case, a `_` between its words, and the
// name a file is asked for is the last part of its path, compared
// exactly. The world's file is named for the manifest's `name`, which the
// one `world` declaration repeats.

import type { Declaration, KindDeclaration, WorldDeclaration } from '../syntax/ast.js';
import type { Diagnostics } from '../source/diagnostics.js';

const isUpper = (ch: string | undefined): boolean => ch !== undefined && ch >= 'A' && ch <= 'Z';
const isLower = (ch: string | undefined): boolean => ch !== undefined && ch >= 'a' && ch <= 'z';

/**
 * The file named for a kind or a world: `Chest` in `chest.sprout`,
 * `PrintedSheet` in `printed_sheet.sprout`, `printers_shop` in
 * `printers_shop.sprout`. A capital starts a word after a lower-case
 * letter or a digit, and the last capital of a run starts one when a
 * lower-case letter follows it, so `TVSet` is `tv_set.sprout`.
 */
export function fileNamedFor(name: string): string {
  let file = '';
  for (let i = 0; i < name.length; i++) {
    const ch = name[i]!;
    const before = name[i - 1];
    const starts =
      i > 0 && isUpper(ch) && before !== '_' && (!isUpper(before) || isLower(name[i + 1]));
    file += `${starts ? '_' : ''}${ch.toLowerCase()}`;
  }
  return `${file}.sprout`;
}

/** The last part of a file's path, which is the name the rule reads: `sprout/actor.sprout` is `actor.sprout`. */
function fileNameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/**
 * Refuse a kind in a file not named for it, a kind sharing the file of
 * the one it is named for, and a kind in the file named for a world
 * declared there. Each refusal is at the kind's name, and names where it
 * goes.
 */
export function checkKindFiles(
  path: string,
  declarations: readonly Declaration[],
  diagnostics: Diagnostics,
): void {
  const file = fileNameOf(path);
  const kinds = declarations.filter((d): d is KindDeclaration => d.kind === 'kind');
  const owner = kinds.find((kind) => fileNamedFor(kind.name.text) === file);
  const world = declarations.find(
    (d): d is WorldDeclaration => d.kind === 'world' && fileNamedFor(d.name.text) === file,
  );
  for (const kind of kinds) {
    const name = kind.name.text;
    // A second kind of the owner's name is the same name declared twice,
    // which resolving the kinds says.
    if (owner !== undefined && kind !== owner && name === owner.name.text) continue;
    if (kind === owner) {
      // A kind named for the world's file has no file of its own to go to.
      if (world === undefined) continue;
      diagnostics.refuse(
        kind.name.at,
        `\`${name}\` shares \`${file}\` with the world \`${world.name.text}\`, and each kind is declared in a file of its own.`,
        `Rename \`kind ${name}\`, since \`${file}\` is the world's file.`,
      );
      continue;
    }
    const remedy = `Move \`kind ${name}\` to a file of its own called \`${fileNamedFor(name)}\`.`;
    if (owner === undefined) {
      diagnostics.refuse(
        kind.name.at,
        `\`${name}\` is declared in \`${file}\`, and a kind is declared in the file named for it.`,
        remedy,
      );
    } else {
      diagnostics.refuse(
        kind.name.at,
        `\`${name}\` shares \`${file}\` with \`${owner.name.text}\`, and each kind is declared in a file of its own.`,
        remedy,
      );
    }
  }
}

/**
 * Refuse the world declared anywhere but the file named for `name`, the
 * manifest's name for it, at the world's name, naming the file it goes in.
 */
export function checkWorldFile(
  world: WorldDeclaration,
  name: string,
  diagnostics: Diagnostics,
): void {
  const file = fileNameOf(world.name.at.source.name);
  const wanted = fileNamedFor(name);
  if (file === wanted) return;
  diagnostics.refuse(
    world.name.at,
    `The world \`${world.name.text}\` is declared in \`${file}\`, and the world is declared in the file named for it.`,
    `Move \`world ${world.name.text}\` to a file called \`${wanted}\`, and name that file in the manifest's files.`,
  );
}
