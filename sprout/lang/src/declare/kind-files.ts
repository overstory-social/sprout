// Which file a kind is declared in (the spec's The world model › Objects:
// "Each kind is declared in a file of its own, named for it: `kind Chest`
// in `chest.sprout`"). Enums, verbs and messages may sit in any file; a
// library's files are held to the same rule. A kind's file is its name in
// lower case, a `_` between its words, and the name a file is asked for
// is the last part of its path, compared exactly. The world does not
// share a kind's file.

import type { Declaration, KindDeclaration } from '../syntax/ast.js';
import type { Diagnostics } from '../source/diagnostics.js';

const isUpper = (ch: string | undefined): boolean => ch !== undefined && ch >= 'A' && ch <= 'Z';
const isLower = (ch: string | undefined): boolean => ch !== undefined && ch >= 'a' && ch <= 'z';

/**
 * The file a kind is declared in: `Chest` in `chest.sprout`,
 * `PrintedSheet` in `printed_sheet.sprout`. A capital starts a word after
 * a lower-case letter or a digit, and the last capital of a run starts
 * one when a lower-case letter follows it, so `TVSet` is `tv_set.sprout`.
 */
export function kindFileName(name: string): string {
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
 * the one it is named for, and the world written in a kind's file. Each
 * refusal is at the name of what should move, and names where it goes.
 */
export function checkKindFiles(
  path: string,
  declarations: readonly Declaration[],
  diagnostics: Diagnostics,
): void {
  const file = fileNameOf(path);
  const kinds = declarations.filter((d): d is KindDeclaration => d.kind === 'kind');
  const owner = kinds.find((kind) => kindFileName(kind.name.text) === file);
  for (const kind of kinds) {
    const name = kind.name.text;
    // A second kind of the owner's name is the same name declared twice,
    // which resolving the kinds says.
    if (owner !== undefined && name === owner.name.text) continue;
    const remedy = `Move \`kind ${name}\` to a file of its own called \`${kindFileName(name)}\`.`;
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
  if (owner === undefined) return;
  for (const world of declarations.filter((d) => d.kind === 'world')) {
    diagnostics.refuse(
      world.name.at,
      `The world \`${world.name.text}\` shares \`${file}\` with \`${owner.name.text}\`, and a kind's file holds no world.`,
      'Move the world to a file with no kind in it, such as `world.sprout`.',
    );
  }
}
