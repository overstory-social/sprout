// How a visitor's words are read as words, and what a thing answers to
// when its grammar block says nothing (the spec's Names › Addressing and
// display, Articles; Verbs › Set roles). One tokeniser serves a typed
// command, a name, a noun and a phrase's words, so what an author wrote
// and what a visitor types are compared on the same footing: lower case,
// split on white space, a comma a word of its own.

/** The words an article may be on input, where each is optional before a noun (the spec's Articles). */
export const DETERMINERS: readonly string[] = ['a', 'an', 'the', 'my', 'this', 'that'];

/** What separates the things a set role's run names (the spec's Set roles). */
export const CONNECTORS: readonly string[] = ['and', ','];

/** A line as words: lower case, split on white space, each comma a word of its own. */
export function typedWords(text: string): string[] {
  return text
    .toLowerCase()
    .replaceAll(',', ' , ')
    .split(/\s+/)
    .filter((word) => word !== '');
}

/** An identifier as a name: `oak_door` is "oak door" (the spec's Addressing and display). */
export function humanisedIdentifier(identifier: string): string {
  return identifier.replaceAll('_', ' ');
}

/** A kind's name as a name, in lower case: `MazeCell` is "maze cell". */
export function humanisedKind(kind: string): string {
  return kind
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .toLowerCase();
}

/** The nouns a name gives by default: the full name and its last word (the spec's Addressing and display). */
export function defaultNouns(name: string): string[] {
  const words = typedWords(name);
  const last = words.at(-1);
  const full = words.join(' ');
  return last === undefined || last === full ? [full] : [full, last];
}
