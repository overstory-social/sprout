// The phrases a visitor may type, as the command parser tries them (the
// spec's Verbs › Declaring a verb, Slots, Engine verbs; Kinds › Libraries
// and namespaces). Built once per load from every verb the bundle
// declares that has phrases, each phrase's words read by the tokeniser a
// typed line is read by, so the two compare as words.
//
// The order is the order they are tried in, and the first that reads
// wins: the world's own verbs, then the standard library's, then every
// other library's, each in declared order. A world's own verb shadows a
// library verb of its name, whose phrases are then not typed at all.
// Each verb's written phrases come first, then those its synonyms give
// (the spec's Parsing › Synonyms): its own, the world's, then each
// object's, which is tried only in readings that object takes part in.

import { typedWords } from '../../declare/addressing.js';
import { SPROUT } from '../../declare/enums.js';
import type { ResolvedIntent } from '../../declare/intents.js';
import { synonymPhrases, type ScopedSynonym } from '../../declare/synonyms.js';
import type { ResolvedPhrase, ResolvedVerb } from '../../declare/verbs.js';
import { declaredId, type InstanceId } from '../ids.js';

/** One part of a phrase as the parser reads it: words, or a slot by the index of its role. */
export type TypedPart = { readonly words: readonly string[] } | { readonly slot: number };

/** One phrase, ready to try against a typed line. */
export interface TypedPhrase {
  readonly verb: ResolvedVerb;
  readonly parts: readonly TypedPart[];
  /** The object an object's synonym gave it for, which must take part in a reading of it; null for every other. */
  readonly only: InstanceId | null;
}

/** Every phrase a visitor of `world` may type, in the order they are tried. */
export function typedPhrasesOf(
  verbs: readonly ResolvedVerb[],
  world: string,
  synonyms: readonly ScopedSynonym[] = [],
): TypedPhrase[] {
  const own = new Set(verbs.filter((verb) => verb.library === world).map((verb) => verb.name));
  const rank = (verb: ResolvedVerb): number =>
    verb.library === world ? 0 : verb.library === SPROUT ? 1 : 2;
  const typed = verbs
    .filter((verb) => verb.library === world || !own.has(verb.name))
    .map((verb, at) => ({ verb, at }))
    .sort((a, b) => rank(a.verb) - rank(b.verb) || a.at - b.at);
  return typed.flatMap(({ verb }) => {
    const scoped = synonyms.filter((synonym) => synonym.verb === verb);
    return [
      ...[...verb.phrases, ...verb.synonyms.flatMap((words) => synonymPhrases(verb, words))].map(
        (phrase) => typedPhrase(verb, phrase, null),
      ),
      ...[
        ...scoped.filter((one) => one.object === null),
        ...scoped.filter((one) => one.object !== null),
      ].flatMap((synonym) => {
        const only = synonym.object === null ? null : declaredId(world, synonym.object);
        return synonym.phrases.map((phrase) => typedPhrase(verb, phrase, only));
      }),
    ];
  });
}

/** `phrase` as the parser reads it, its words read by the tokeniser a typed line is. */
function typedPhrase(
  verb: ResolvedVerb,
  phrase: ResolvedPhrase,
  only: InstanceId | null,
): TypedPhrase {
  return {
    verb,
    parts: phrase.parts.flatMap((part): TypedPart[] => {
      if (part.part === 'slot') return [{ slot: part.role }];
      const words = typedWords(part.text);
      return words.length === 0 ? [] : [{ words }];
    }),
    only,
  };
}

/** One of an intent's phrases, ready to try against a typed line: each slot by its index among the intent's slots. */
export interface TypedIntentPhrase {
  readonly intent: ResolvedIntent;
  readonly parts: readonly TypedPart[];
}

/** Every phrase of `intents`, each intent's in the order written. */
export function typedIntentPhrasesOf(intents: readonly ResolvedIntent[]): TypedIntentPhrase[] {
  return intents.flatMap((intent) =>
    intent.phrases.map((phrase) => ({
      intent,
      parts: phrase.parts.flatMap((part): TypedPart[] => {
        if (part.part === 'slot') return [{ slot: part.role }];
        const words = typedWords(part.text);
        return words.length === 0 ? [] : [{ words }];
      }),
    })),
  );
}
