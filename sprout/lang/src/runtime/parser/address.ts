// What an instance is called and answers to while the world runs (the
// spec's Names › Addressing and display, Articles, Nicknames; Verbs ›
// Slots). Its composed grammar block says what it writes, and the rest is
// the defaults: a thing's name is its identifier humanised, or its kind's
// name humanised where it has no identifier, as a spawn has none; its
// article is `a`, or `an` before a name beginning with a vowel; it answers
// to its full name, the last word of it, its identifier and every noun its
// closure writes; and its adjectives are its name's words before the last
// and every adjective its closure writes. A visitor is called by their
// nickname, with no article, and answers to the whole of it, with the
// adjectives their kind writes.

import {
  defaultAdjectives,
  defaultArticle,
  defaultNouns,
  humanisedIdentifier,
  humanisedKind,
  typedWords,
} from '../../declare/addressing.js';
import type { Article, Pronoun } from '../../syntax/ast-grammar.js';
import { declaredPathOf, type InstanceId } from '../ids.js';
import type { Instance } from '../state.js';

/** How the engine writes a thing and what a visitor may type for it. */
export interface Address {
  /** As the engine writes it, after its article. */
  readonly name: string;
  readonly article: Article;
  /** The pronoun it declares, which a visitor's other pronoun for it is corrected to; null where it declares none. */
  readonly pronoun: Pronoun | null;
  /** Every noun it answers to as words, the full name first, each once. */
  readonly nouns: readonly (readonly string[])[];
  /** Every adjective it answers to, each one word, each once: a name of these alone names it weakly. */
  readonly adjectives: readonly string[];
}

/** What addressing reads beyond the instance: the world's name, and each visitor's nickname. */
export interface AddressContext {
  readonly world: InstanceId;
  /** Each visitor's nickname, by the instance that is them. */
  readonly nicknames: ReadonlyMap<InstanceId, string>;
}

/** What `instance` is called and answers to. */
export function addressOf(instance: Instance, context: AddressContext): Address {
  const { grammar } = instance.kind;
  const written = grammar.nouns.map(typedWords);
  const adjectives = grammar.adjectives.flatMap(typedWords);
  const nickname = context.nicknames.get(instance.id);
  if (instance.made.from === 'visitor' && nickname !== undefined) {
    return {
      name: nickname,
      article: 'none',
      pronoun: grammar.pronoun?.value ?? null,
      nouns: once([typedWords(nickname), ...written]),
      adjectives: [...new Set(adjectives)],
    };
  }
  const identifier = identifierOf(instance, context.world);
  const name =
    grammar.name?.value ??
    (identifier === null ? humanisedKind(instance.kind.name) : humanisedIdentifier(identifier));
  const nouns = defaultNouns(name).map(typedWords);
  if (identifier !== null) nouns.push(typedWords(humanisedIdentifier(identifier)));
  return {
    name,
    article: grammar.article?.value ?? defaultArticle(name),
    pronoun: grammar.pronoun?.value ?? null,
    nouns: once([...nouns, ...written]),
    adjectives: [...new Set([...defaultAdjectives(name), ...adjectives])],
  };
}

/** The identifier a thing was declared by, or null for a spawn, which has none. */
function identifierOf(instance: Instance, world: InstanceId): string | null {
  switch (instance.made.from) {
    case 'world':
      return world;
    case 'declared':
      return declaredPathOf(world, instance.id)?.at(-1) ?? null;
    case 'given':
      return instance.made.path.at(-1) ?? null;
    case 'visitor':
    case 'spawned':
      return null;
  }
}

/** Nouns each once, the first kept. */
function once(nouns: readonly (readonly string[])[]): (readonly string[])[] {
  const seen = new Set<string>();
  return nouns.filter((noun) => {
    const key = noun.join(' ');
    if (noun.length === 0 || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
