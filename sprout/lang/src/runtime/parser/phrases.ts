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

import { typedWords } from '../../declare/addressing.js';
import { SPROUT } from '../../declare/enums.js';
import type { ResolvedVerb } from '../../declare/verbs.js';

/** One part of a phrase as the parser reads it: words, or a slot by the index of its role. */
export type TypedPart = { readonly words: readonly string[] } | { readonly slot: number };

/** One phrase, ready to try against a typed line. */
export interface TypedPhrase {
  readonly verb: ResolvedVerb;
  readonly parts: readonly TypedPart[];
}

/** Every phrase a visitor of `world` may type, in the order they are tried. */
export function typedPhrasesOf(verbs: readonly ResolvedVerb[], world: string): TypedPhrase[] {
  const own = new Set(verbs.filter((verb) => verb.library === world).map((verb) => verb.name));
  const rank = (verb: ResolvedVerb): number =>
    verb.library === world ? 0 : verb.library === SPROUT ? 1 : 2;
  const typed = verbs
    .filter((verb) => verb.library === world || !own.has(verb.name))
    .map((verb, at) => ({ verb, at }))
    .sort((a, b) => rank(a.verb) - rank(b.verb) || a.at - b.at);
  return typed.flatMap(({ verb }) =>
    verb.phrases.map((phrase) => ({
      verb,
      parts: phrase.parts.flatMap((part): TypedPart[] => {
        if (part.part === 'slot') return [{ slot: part.role }];
        const words = typedWords(part.text);
        return words.length === 0 ? [] : [{ words }];
      }),
    })),
  );
}
