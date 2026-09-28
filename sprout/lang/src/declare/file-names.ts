// The file a kind or a world would be named for: which file holds what
// is the author's to choose (the spec's The world model › Objects), and
// this is the convention `sprout init` and a remedy that suggests a file
// follow. A file named for a name is that name in lower case, a `_`
// between its words.

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
