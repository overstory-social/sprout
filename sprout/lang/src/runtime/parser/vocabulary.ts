// The words a noun may be made of anywhere in the world (the spec's
// Parsing › When nothing matches): every word some thing in the world is
// named by, whatever its reach, or was or could be, destroyed or not yet
// spawned; every kind's name; and the parser's own words a noun may hold.
// A noun that names nothing in reach is `not_here` only where each of its
// words is one of these; a word nothing in the world is named by is the
// grammar's failure, not reach's, and the line is `unknown`.

import type { KindContent } from '../../declare/contents.js';
import type { KindRef } from '../../declare/kinds.js';
import {
  ALL_WORDS,
  CONNECTORS,
  DETERMINERS,
  humanisedIdentifier,
  humanisedKind,
  RELATIVE_WORDS,
  typedWords,
} from '../../declare/addressing.js';
import { TYPED_PRONOUNS } from '../../syntax/ast-grammar.js';
import type { Budget } from '../budget.js';
import type { Catalogue } from '../catalogue.js';
import type { InstanceId } from '../ids.js';
import type { Instance, StateReader } from '../state.js';
import type { Address } from './address.js';

/**
 * The parser's words a noun may hold: articles and the like, `and`, the
 * relative phrases' words, pronouns, `all`, `everything` and `except`.
 */
const NOUN_WORDS: readonly string[] = [
  ...DETERMINERS,
  ...CONNECTORS,
  ...RELATIVE_WORDS,
  ...Object.keys(TYPED_PRONOUNS),
  ...ALL_WORDS,
  'except',
];

/**
 * What reading the world's words needs: the bundle, the turn's state, what
 * each thing is called, and the meter.
 */
export interface VocabularyContext {
  readonly catalogue: Catalogue;
  readonly state: StateReader;
  readonly address: (id: InstanceId) => Address;
  readonly budget: Budget;
}

/** Each catalogue's words, read once: what its bundle could ever name. */
const WRITTEN = new WeakMap<Catalogue, ReadonlySet<string>>();

/**
 * Every word a noun may hold in the world: each word of every thing's
 * nouns, adjectives and name, and of the kinds it is made of, which
 * `except` names; and the parser's own. What the bundle writes counts
 * whether or not the thing is in the world now, so a thing destroyed, or
 * of a kind not yet spawned, is still `not_here`; a live thing, a
 * visitor's nickname among them, adds its own, each a step.
 */
export function worldWords(context: VocabularyContext): ReadonlySet<string> {
  const words = new Set<string>(writtenWords(context.catalogue));
  const visit = (id: InstanceId): void => {
    context.budget.spend();
    const instance: Instance | undefined = context.state.instance(id);
    if (instance === undefined) return;
    if (id !== context.state.world) {
      const { nouns, adjectives } = context.address(id);
      for (const noun of nouns) for (const word of noun) words.add(word);
      for (const word of adjectives) words.add(word);
      addKinds(words, instance.kind.composes);
    }
    for (const child of context.state.children(id)) visit(child);
  };
  visit(context.state.world);
  return words;
}

/**
 * The words the bundle writes for what it could ever hold: every declared
 * object's identifier and every kind's name, the grammar each writes, and
 * every object a kind's body gives, with the parser's own noun words.
 */
function writtenWords(catalogue: Catalogue): ReadonlySet<string> {
  const known = WRITTEN.get(catalogue);
  if (known !== undefined) return known;
  const words = new Set<string>(NOUN_WORDS);
  const add = (text: string) => {
    for (const word of typedWords(text)) words.add(word);
  };
  const addGrammar = (kind: KindRef | null) => {
    if (kind === null) return;
    const { grammar } = kind;
    if (grammar.name !== null) add(grammar.name.value);
    for (const noun of grammar.nouns) add(noun);
    for (const adjective of grammar.adjectives) add(adjective);
    addKinds(words, kind.composes);
  };
  for (const entry of catalogue.declared.values()) {
    const identifier = entry.path.at(-1);
    if (identifier !== undefined) add(humanisedIdentifier(identifier));
    addGrammar(entry.kind);
  }
  for (const [name, kind] of catalogue.kinds) {
    add(humanisedKind(name.slice(name.lastIndexOf('.') + 1)));
    addGrammar(kind);
  }
  const addGiven = (given: readonly KindContent[]) => {
    for (const content of given) {
      const identifier = content.path.at(-1);
      if (identifier !== undefined) add(humanisedIdentifier(identifier));
      addGrammar(content.kind);
      addGiven(content.holds);
    }
  };
  for (const given of catalogue.contents.values()) addGiven(given);
  WRITTEN.set(catalogue, words);
  return words;
}

/** Each word of the names of `kinds`, by qualified name, which `except` reads. */
function addKinds(words: Set<string>, kinds: Iterable<string>): void {
  for (const kind of kinds) {
    for (const word of typedWords(humanisedKind(kind.slice(kind.lastIndexOf('.') + 1)))) {
      words.add(word);
    }
  }
}

/** Whether every one of `words` is a word a noun may hold in the world. */
export function inVocabulary(words: readonly string[], vocabulary: ReadonlySet<string>): boolean {
  return words.every((word) => vocabulary.has(word));
}
