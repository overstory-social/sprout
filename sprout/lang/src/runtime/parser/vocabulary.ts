// The words a noun may be made of anywhere in the world (the spec's
// Parsing › When nothing matches): every word some thing in the world is
// named by, whatever its reach, and the parser's own words a noun may
// hold. A noun that names nothing in reach is `not_here` only where each
// of its words is one of these; a word nothing in the world is named by
// is the grammar's failure, not reach's, and the line is `unknown`.

import {
  CONNECTORS,
  DETERMINERS,
  humanisedKind,
  RELATIVE_WORDS,
  typedWords,
} from '../../declare/addressing.js';
import { TYPED_PRONOUNS } from '../../syntax/ast-grammar.js';
import type { Budget } from '../budget.js';
import type { InstanceId } from '../ids.js';
import type { Instance, StateReader } from '../state.js';
import type { Address } from './address.js';

/** The parser's words a noun may hold: articles and the like, `and`, the relative phrases' words, pronouns, `all` and `except`. */
const NOUN_WORDS: readonly string[] = [
  ...DETERMINERS,
  ...CONNECTORS,
  ...RELATIVE_WORDS,
  ...Object.keys(TYPED_PRONOUNS),
  'all',
  'except',
];

/** What reading the world's words needs: the turn's state, what each thing is called, and the meter. */
export interface VocabularyContext {
  readonly state: StateReader;
  readonly address: (id: InstanceId) => Address;
  readonly budget: Budget;
}

/**
 * Every word a noun may hold in the world as it stands: each word of
 * every noun and adjective of every thing in it, of every kind it is
 * made of, which `except` names, and the parser's own. Each thing is a step.
 */
export function worldWords(context: VocabularyContext): ReadonlySet<string> {
  const words = new Set<string>(NOUN_WORDS);
  const visit = (id: InstanceId): void => {
    context.budget.spend();
    const instance: Instance | undefined = context.state.instance(id);
    if (instance === undefined) return;
    if (id !== context.state.world) {
      const { nouns, adjectives } = context.address(id);
      for (const noun of nouns) for (const word of noun) words.add(word);
      for (const word of adjectives) words.add(word);
      for (const kind of instance.kind.composes) {
        for (const word of typedWords(humanisedKind(kind.slice(kind.lastIndexOf('.') + 1)))) {
          words.add(word);
        }
      }
    }
    for (const child of context.state.children(id)) visit(child);
  };
  visit(context.state.world);
  return words;
}

/** Whether every one of `words` is a word a noun may hold in the world. */
export function inVocabulary(words: readonly string[], vocabulary: ReadonlySet<string>): boolean {
  return words.every((word) => vocabulary.has(word));
}
