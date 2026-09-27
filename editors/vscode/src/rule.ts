// The shape of a TextMate grammar, as far as the two Sprout grammars use
// it: rules that match one line, rules that begin and end, includes, and
// the repository they are named in.

/** What a capture group is coloured as, or read further as. */
export interface Capture {
  readonly name?: string;
  readonly patterns?: readonly Rule[];
}

/** One rule of a TextMate grammar. */
export interface Rule {
  readonly name?: string;
  readonly contentName?: string;
  readonly match?: string;
  readonly begin?: string;
  readonly end?: string;
  readonly captures?: Readonly<Record<string, Capture>>;
  readonly beginCaptures?: Readonly<Record<string, Capture>>;
  readonly endCaptures?: Readonly<Record<string, Capture>>;
  readonly include?: string;
  readonly patterns?: readonly Rule[];
}

/** A whole grammar, as `syntaxes/*.tmLanguage.json` holds it. */
export interface Grammar {
  readonly $schema: string;
  readonly name: string;
  readonly scopeName: string;
  readonly fileTypes: readonly string[];
  readonly patterns: readonly Rule[];
  readonly repository: Readonly<Record<string, Rule>>;
}

/** The schema VS Code's editors check a grammar file against. */
export const SCHEMA =
  'https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json';

/** Captures numbered from 1, one scope name each; `undefined` leaves a group uncoloured. */
export function named(...names: (string | undefined)[]): Record<string, Capture> {
  const captures: Record<string, Capture> = {};
  names.forEach((name, i) => {
    if (name !== undefined) captures[String(i + 1)] = { name };
  });
  return captures;
}
