// Synonyms (the spec's Parsing › Synonyms): another word for a verb,
// which takes every phrase of the verb that writes the verb's name, the
// synonym's words in its place. A verb's own hold everywhere the verb
// does, a world's throughout the world, and an object's only in readings
// that object takes part in; a kind's body holds none, since the spec
// gives synonyms those three places. A phrase a synonym gives collides
// with another of its verb's, written or given, as a written one does,
// and is as long as a phrase may be, and none counts toward the phrases a
// verb may have.
//
// A verb's name is written in a phrase as its words: `look_in` is written
// `look in`.

import type { Diagnostics } from '../source/diagnostics.js';
import type { Span } from '../source/source.js';
import type { KindDeclaration, KindMember, WorldDeclaration, WorldMember } from '../syntax/ast.js';
import type { SynonymsDeclaration, SynonymWords, VerbDeclaration } from '../syntax/ast-verbs.js';
import { typedWords } from './addressing.js';
import { nearestOption } from './enums.js';
import { objectsIn } from './objects.js';
import type { ObjectTree, TreePath } from './tree.js';
import type { ResolvedPhrase, ResolvedPhrasePart, ResolvedVerb, VerbCaps } from './verbs.js';

/** A phrase's parts as a synonym rewrites them: runs of words, and slots it keeps. */
type Part<S> = { readonly part: 'words'; readonly text: string } | S;

/**
 * `parts` with each run of `name`'s words replaced by `words`; null where
 * no run of words writes the name, and the synonym gives that phrase nothing.
 */
export function withSynonym<S extends { readonly part: 'slot' }>(
  parts: readonly Part<S>[],
  name: string,
  words: string,
): Part<S>[] | null {
  const named = name.split('_');
  let wrote = false;
  const out = parts.map((part): Part<S> => {
    if (part.part !== 'words') return part;
    const written = part.text.split(' ');
    const kept: string[] = [];
    for (let i = 0; i < written.length;) {
      if (named.every((word, k) => written[i + k]?.toLowerCase() === word)) {
        kept.push(words);
        wrote = true;
        i += named.length;
      } else {
        kept.push(written[i]!);
        i += 1;
      }
    }
    return { part: 'words', text: kept.join(' ') };
  });
  return wrote ? out : null;
}

/** The phrases `words` gives `verb`, in the order of the phrases they come from. */
export function synonymPhrases(verb: ResolvedVerb, words: string): ResolvedPhrase[] {
  return verb.phrases.flatMap((phrase) => {
    const parts = withSynonym<Extract<ResolvedPhrasePart, { part: 'slot' }>>(
      phrase.parts,
      verb.name,
      words,
    );
    if (parts === null) return [];
    const text = parts
      .map((part) => (part.part === 'slot' ? `[${verb.roles[part.role]!.name}]` : part.text))
      .join(' ');
    return [{ text, parts, declaration: phrase.declaration }];
  });
}

/** A phrase as it means, for telling two apart: its words as a visitor types them, and its slots by role. */
function meaning(parts: readonly Part<{ readonly part: 'slot'; readonly role: string }>[]): string {
  return parts
    .map((part) => (part.part === 'slot' ? `[${part.role}]` : typedWords(part.text).join(' ')))
    .join(' ');
}

/** What one phrase a synonym gives is checked for, against what its verb already has. */
interface Given {
  readonly verb: string;
  readonly synonym: SynonymWords;
  readonly text: string;
  readonly key: string;
}

/**
 * Refuse, at `synonym`, each phrase it gives that its verb already has or
 * that is longer than a phrase may be, every one named; add each other to
 * `known`.
 */
function checkGiven(
  given: readonly Given[],
  known: Set<string>,
  caps: VerbCaps,
  diagnostics: Diagnostics,
): void {
  for (const one of given) {
    const length = [...one.text].length;
    if (length > caps.phraseCharacters) {
      diagnostics.refuse(
        one.synonym.at,
        `\`"${one.synonym.text}"\` gives \`${one.verb}\` the phrase \`"${one.text}"\`, which is ${length} characters long, and ${caps.phraseCharacters} is as long as a phrase may be.`,
        'Say it in fewer words: a synonym takes the place of the verb’s name in each phrase.',
      );
      continue;
    }
    if (known.has(one.key)) {
      diagnostics.refuse(
        one.synonym.at,
        `\`"${one.synonym.text}"\` gives \`${one.verb}\` the phrase \`"${one.text}"\`, which it has already.`,
        'Take the synonym out, or the phrase it repeats.',
      );
      continue;
    }
    known.add(one.key);
  }
}

/** A verb's own synonyms, checked against its phrases and each other as its file is read. */
export function checkVerbSynonyms(
  declared: VerbDeclaration,
  caps: VerbCaps,
  diagnostics: Diagnostics,
): void {
  const verb = declared.name.text;
  const partsOf = (phrase: VerbDeclaration['phrases'][number]) =>
    phrase.parts.map((part) =>
      part.kind === 'phrase-slot'
        ? { part: 'slot' as const, role: part.role.text }
        : { part: 'words' as const, text: part.text },
    );
  const known = new Set(declared.phrases.map((phrase) => meaning(partsOf(phrase))));
  for (const synonym of declared.synonyms) {
    const given = declared.phrases.flatMap((phrase): Given[] => {
      const parts = withSynonym<{ readonly part: 'slot'; readonly role: string }>(
        partsOf(phrase),
        verb,
        synonym.text,
      );
      if (parts === null) return [];
      const text = parts.map((part) => (part.part === 'slot' ? `[${part.role}]` : part.text));
      return [{ verb, synonym, text: text.join(' '), key: meaning(parts) }];
    });
    checkGiven(given, known, caps, diagnostics);
  }
}

/** The phrases a verb has everywhere: its own, and those its own synonyms give. */
function ownPhrases(verb: ResolvedVerb): ResolvedPhrase[] {
  return [...verb.phrases, ...verb.synonyms.flatMap((words) => synonymPhrases(verb, words))];
}

/** A resolved phrase's key, as `meaning` makes one. */
function keyOf(verb: ResolvedVerb, phrase: ResolvedPhrase): string {
  return meaning(
    phrase.parts.map((part) =>
      part.part === 'slot' ? { part: 'slot' as const, role: verb.roles[part.role]!.name } : part,
    ),
  );
}

/**
 * Refuse `synonyms` written in a kind's body, or an object's inside one:
 * a synonym is a verb's, the world's or one object's (the spec's Parsing ›
 * Synonyms).
 */
export function refuseKindSynonyms(kind: KindDeclaration, diagnostics: Diagnostics): void {
  const members = [kind.members, ...objectsIn(kind).map(({ declaration }) => declaration.members)];
  for (const member of members.flat()) {
    if (member.kind !== 'synonyms') continue;
    diagnostics.refuse(
      member.at,
      `\`${kind.name.text}\` is a kind, and a kind's body holds no synonyms.`,
      `A synonym is a verb's own, the world's, or one object's: write \`synonyms ${member.verb.text}: …\` in the world's body, or in the object's.`,
    );
  }
}

/** A world's or an object's synonym for a verb, and the phrases it gives. */
export interface ScopedSynonym {
  readonly verb: ResolvedVerb;
  readonly words: string;
  readonly phrases: readonly ResolvedPhrase[];
  /** The object it holds for, only in readings that object takes part in; null for the world's. */
  readonly object: TreePath | null;
}

/** What resolving the world's and its objects' synonyms reads. */
export interface SynonymContext {
  /** The world's library, which a verb written in its body is looked for from. */
  readonly library: string;
  readonly verbs: {
    unqualified(name: string, from: string): ResolvedVerb | null;
  };
  /** The verb names a misspelling may have meant. */
  readonly named: (from: string) => readonly string[];
  readonly caps: VerbCaps;
  readonly diagnostics: Diagnostics;
}

/**
 * The synonyms the world's body and its objects' write, each checked: a
 * verb nothing declares is refused, as is a phrase a synonym gives that
 * its verb already has where the synonym holds.
 */
export function resolveScopedSynonyms(
  world: WorldDeclaration | null,
  tree: ObjectTree,
  context: SynonymContext,
): ScopedSynonym[] {
  const resolved: ScopedSynonym[] = [];
  const worldKnown = new Map<ResolvedVerb, Set<string>>();
  const knownFor = (verb: ResolvedVerb, from: Map<ResolvedVerb, Set<string>>): Set<string> => {
    let known = from.get(verb);
    if (known === undefined) {
      known = new Set(
        worldKnown.get(verb) ?? ownPhrases(verb).map((phrase) => keyOf(verb, phrase)),
      );
      from.set(verb, known);
    }
    return known;
  };
  const scope = (
    members: readonly (KindMember | WorldMember)[],
    object: TreePath | null,
    known: Map<ResolvedVerb, Set<string>>,
  ): void => {
    for (const member of members) {
      if (member.kind !== 'synonyms') continue;
      const verb = verbOf(member, context);
      if (verb === null) continue;
      for (const synonym of member.words) {
        const phrases = synonymPhrases(verb, synonym.text);
        const given = phrases.map((phrase) => ({
          verb: verb.name,
          synonym,
          text: phrase.text,
          key: keyOf(verb, phrase),
        }));
        checkGiven(given, knownFor(verb, known), context.caps, context.diagnostics);
        resolved.push({ verb, words: synonym.text, phrases, object });
      }
    }
  };
  if (world !== null) scope(world.members, null, worldKnown);
  for (const placement of tree.placed.values()) {
    scope(placement.declaration.members, placement.path, new Map());
  }
  return resolved;
}

/** The verb a `synonyms` line names, looked for from the world; null having said why. */
function verbOf(member: SynonymsDeclaration, context: SynonymContext): ResolvedVerb | null {
  const { verb } = member;
  const found = context.verbs.unqualified(verb.text, context.library);
  if (found !== null) return found;
  const meant = nearestOption(verb.text, context.named(context.library));
  refuseUnknown(verb.at, verb.text, meant, context.diagnostics);
  return null;
}

function refuseUnknown(
  at: Span,
  verb: string,
  meant: string | null,
  diagnostics: Diagnostics,
): void {
  diagnostics.refuse(
    at,
    `\`synonyms ${verb}:\` names a verb, and nothing declares \`${verb}\`.${meant === null ? '' : ` Did you mean \`${meant}\`?`}`,
    meant === null
      ? `Name a verb this world or a library it uses declares, as in \`synonyms open: "jimmy"\`.`
      : `Write \`synonyms ${meant}: …\`.`,
  );
}
