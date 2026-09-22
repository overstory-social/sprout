// The reserved words (the spec's The compiler › Lexical rules).
//
// The lexer does not know them: a reserved word is an ordinary `name`
// token, because these words are read as syntax only where syntax may
// stand. What this set decides is the other half of the spec's sentence
// — "None may name an enum's option or a binding" — so the parser asks
// it at each place a name is being GIVEN to something.

/**
 * Every reserved word, in the spec's order: the type names, the
 * value-role word, the literals, then the words of the language's own
 * syntax. A spec holds this set against the spec file, so the two
 * cannot drift.
 */
export const RESERVED_WORDS: ReadonlySet<string> = new Set([
  // the type names
  'boolean',
  'integer',
  'string',
  'object',
  // the value-role word
  'symbol',
  // the literals
  'true',
  'false',
  // the words of the language's own syntax
  'accept',
  'act',
  'actors',
  'allow',
  'any',
  'are',
  'arrive',
  'article',
  'as',
  'at',
  'bound',
  'broadcast',
  'changed',
  'connect',
  'contains',
  'default',
  'depart',
  'describe',
  'destroy',
  'do',
  'each',
  'else',
  'enum',
  'exit',
  'for',
  'from',
  'grammar',
  'hours',
  'if',
  'in',
  'kind',
  'let',
  'link',
  'many',
  'max',
  'message',
  'min',
  'minutes',
  'move',
  'name',
  'nouns',
  'of',
  'on',
  'optional',
  'pass',
  'passage',
  'permit',
  'prose',
  'refuse',
  'release',
  'role',
  'say',
  'seconds',
  'send',
  'spawn',
  'tell',
  'text',
  'to',
  'verb',
  'visitors',
  'wake',
  'when',
  'with',
  'without',
  'world',
]);

/** Whether a word is the language's own, and so may not be given as a name. */
export function isReserved(word: string): boolean {
  return RESERVED_WORDS.has(word);
}
