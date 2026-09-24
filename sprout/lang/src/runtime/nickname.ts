// Whether a nickname may be admitted (the spec's Names › Nicknames; The
// host contract › Admission and identity). A nickname is kept as its
// words, single-spaced, and is admitted only if none of its words is a
// word of the bundle's word set or a connector, and no one present holds
// it; someone away holds nothing, since reservations are soft. Two
// nicknames are one where they are typed alike, which is lower case. The
// length cap is the host's, and moderation is the host's too: this
// module reads the bundle and the state, and never the person.
//
// Every refusal carries words the host can show the person, asking for
// another nickname; a host may replace them with its own.

import { CONNECTORS, typedWords } from '../declare/addressing.js';
import type { Catalogue } from './catalogue.js';
import type { VisitKey } from './ids.js';
import type { WorldState } from './state.js';

/** What the host sets for nicknames. */
export interface NicknameRules {
  /** The most characters a nickname may have, counted as it is kept; null where the host sets no cap. */
  readonly characters: number | null;
}

/** Why a nickname is not admitted. */
export type NicknameRefusalReason =
  /** It has no words. */
  | 'empty'
  /** It holds a control or format character, which is no part of a word. */
  | 'not-words'
  /** It is longer than the host's cap. */
  | 'too-long'
  /** A word of it is one the world's parser reads. */
  | 'world-word'
  /** Someone present is called by it. */
  | 'held'
  /** The host's moderation declined it. */
  | 'moderated';

/** A nickname refused, with the words the host shows the person, asking them for another. */
export interface NicknameRefused {
  readonly reason: NicknameRefusalReason;
  /** The nickname as it was given. */
  readonly nickname: string;
  /** For `world-word`, each word of it the world reads, in the order written; otherwise empty. */
  readonly collides: readonly string[];
  readonly words: string;
}

/** A nickname as the world keeps it: its words, separated by single spaces. */
export function keptNickname(nickname: string): string {
  return nickname.trim().split(/\s+/).join(' ');
}

/** How a nickname is typed, and so what two alike nicknames share. */
function typed(nickname: string): string {
  return typedWords(nickname).join(' ');
}

const NOT_WORDS = /[\p{Cc}\p{Cf}]/u;

/**
 * Why `nickname` cannot be admitted for `visit` to the world `state` is,
 * under `catalogue`'s word set and the host's `rules`, or null where it
 * may be; moderation is the host's and is not asked here.
 */
export function nicknameRefusal(
  state: WorldState,
  catalogue: Catalogue,
  rules: NicknameRules,
  visit: VisitKey,
  nickname: string,
): NicknameRefused | null {
  const kept = keptNickname(nickname);
  if (kept === '') return refused('empty', nickname, [], 'Choose a nickname to be known by here.');
  if (NOT_WORDS.test(kept)) {
    return refused(
      'not-words',
      nickname,
      [],
      'A nickname is words and nothing else: choose one without hidden or control characters.',
    );
  }
  const length = [...kept].length;
  if (rules.characters !== null && length > rules.characters) {
    return refused(
      'too-long',
      nickname,
      [],
      `"${kept}" is ${length} characters, and a nickname here may have at most ${rules.characters}: choose a shorter one.`,
    );
  }
  const collides = [
    ...new Set(
      typedWords(kept).filter((word) => catalogue.words.has(word) || CONNECTORS.includes(word)),
    ),
  ];
  if (collides.length > 0) {
    // A returning visitor's own nickname can only collide after a republish added the word.
    const record = state.visitors.get(visit);
    const since =
      record !== undefined && typed(record.nickname) === typed(kept)
        ? 'Since you were last here, '
        : '';
    const are = collides.length === 1 ? 'is a word' : 'are words';
    return refused(
      'world-word',
      nickname,
      collides,
      `${since}${quoted(collides)} ${are} this world already reads, so "${kept}" would not always mean you: choose another nickname.`,
    );
  }
  if (heldByOther(state, visit, kept)) {
    return refused(
      'held',
      nickname,
      [],
      `Someone here is already called "${kept}": choose another nickname.`,
    );
  }
  return null;
}

/** Whether someone other than `visit`, standing in the world now, is called `nickname`. */
function heldByOther(state: WorldState, visit: VisitKey, nickname: string): boolean {
  const wanted = typed(nickname);
  for (const other of state.visitors.values()) {
    if (other.visit === visit || typed(other.nickname) !== wanted) continue;
    if ((state.instances.get(other.instance)?.container ?? null) !== null) return true;
  }
  return false;
}

/** What the host tells a person whose nickname its moderation declined, in these words or its own. */
export function moderated(nickname: string): NicknameRefused {
  return refused('moderated', nickname, [], 'That nickname cannot be used here: choose another.');
}

function refused(
  reason: NicknameRefusalReason,
  nickname: string,
  collides: readonly string[],
  words: string,
): NicknameRefused {
  return { reason, nickname, collides, words };
}

/** Words written out as a person reads a list of them: `"a"`, `"a" and "b"`, `"a", "b" and "c"`. */
function quoted(words: readonly string[]): string {
  const all = words.map((word) => `"${word}"`);
  return all.length === 1 ? all[0]! : `${all.slice(0, -1).join(', ')} and ${all.at(-1)}`;
}
