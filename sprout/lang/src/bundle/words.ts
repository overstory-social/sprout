// The world's complete word set (the spec's Names › Nicknames; The
// compiler › What compiling produces): every word its grammar can match,
// which a nickname is admitted against with no scan of live state. Names
// are declaration syntax and every spawn instantiates a declared kind, so
// the set is known at compile time: each word of every name, noun and
// exit or link label a kind or an object writes, of every identifier and
// of every kind's name as a spawn is called by default, the directions
// and their abbreviations, the articles and determiners, the connectors,
// and the words of every phrase. A link's name is not among them: a
// visitor takes a link by its label, and the name is source's alone.

import {
  CONNECTORS,
  DETERMINERS,
  humanisedIdentifier,
  humanisedKind,
  typedWords,
} from '../declare/addressing.js';
import { ABBREVIATIONS, DIRECTIONS } from '../declare/directions.js';
import type { KindRef } from '../declare/kinds.js';
import type { ResolvedVerb } from '../declare/verbs.js';
import type { WordSet } from './bundle.js';

/** What the word set is drawn from. */
export interface WordSources {
  /** Every composed kind: the named ones, and every object's own. */
  readonly kinds: readonly KindRef[];
  /** The kinds a spawn may name, whose names a spawn of one is called by where it writes none. */
  readonly named: readonly KindRef[];
  /** Every object's identifier, at every depth, a kind's contents' included. */
  readonly identifiers: readonly string[];
  readonly verbs: readonly ResolvedVerb[];
}

/** The word set: single words, sorted, each once. A comma separates and is no word. */
export function wordSetOf(sources: WordSources): WordSet {
  const words = new Set<string>();
  const add = (text: string): void => {
    for (const word of typedWords(text)) if (word !== ',') words.add(word);
  };
  for (const kind of sources.kinds) {
    if (kind.grammar.name !== null) add(kind.grammar.name.value);
    for (const noun of kind.grammar.nouns) add(noun);
    for (const exit of kind.exits) add(exit.line.label.text);
  }
  for (const kind of sources.named) if (kind.grammar.name === null) add(humanisedKind(kind.name));
  for (const identifier of sources.identifiers) add(humanisedIdentifier(identifier));
  for (const verb of sources.verbs) {
    for (const phrase of verb.phrases) {
      for (const part of phrase.parts) if (part.part === 'words') add(part.text);
    }
  }
  for (const word of [...DIRECTIONS, ...ABBREVIATIONS.keys(), ...DETERMINERS, ...CONNECTORS]) {
    add(word);
  }
  return [...words].sort();
}
