// Whether a nickname may be admitted (the spec's Names › Nicknames; The
// host contract › Admission and identity). A nickname is kept as its
// words, single-spaced, and is admitted only if no word of it is shaped
// like source, a word of the bundle's word set or a connector, or a
// reserved word of the language, and no one present holds it; someone
// away holds nothing, since reservations are soft. Two nicknames are one
// where they are typed alike, which is lower case. Its length is bounded
// by the host's `nicknameCharacters` (Limits › Runtime budgets), counted
// as it is kept and checked once here. Moderation is the host's: this
// module reads the bundle and the state, and never the person.
//
// Every refusal carries words the host can show the person, asking for
// another nickname, and names what it collided on; a host may replace
// them with its own.

import type { RuntimeBudgets } from '../bundle/limits.js';
import { CONNECTORS, typedWords } from '../declare/addressing.js';
import { isReserved } from '../syntax/reserved.js';
import type { Catalogue } from './catalogue.js';
import type { VisitKey } from './ids.js';
import type { WorldState } from './state.js';

/** Why a nickname is not admitted. */
export type NicknameRefusalReason =
  /** It has no words. */
  | 'empty'
  /** It holds a control or format character, which is no part of a word. */
  | 'not-words'
  /** It is longer than the host's `nicknameCharacters`. */
  | 'too-long'
  /** A word of it is shaped like source: it begins with a colon, or has a period inside it. */
  | 'source-shaped'
  /** A word of it is one the world's parser reads. */
  | 'world-word'
  /** A word of it is a reserved word of the language. */
  | 'reserved'
  /** Someone present is called by it. */
  | 'held'
  /** The host's moderation declined it. */
  | 'moderated';

/** A nickname refused, with the words the host shows the person, asking them for another. */
export interface NicknameRefused {
  readonly reason: NicknameRefusalReason;
  /** The nickname as it was given. */
  readonly nickname: string;
  /**
   * For `world-word` and `reserved`, each word of it that collided, as
   * typed and in the order written; for `source-shaped`, each word of it
   * so shaped, as written; otherwise empty.
   */
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
const BEGINS_WITH_COLON = /^:/;
const PERIOD_INSIDE = /.\../su;

/**
 * Why `nickname` cannot be admitted for `visit` to the world `state` is,
 * under `catalogue`'s word set and the host's `budgets`, or null where it
 * may be; moderation is the host's and is not asked here.
 */
export function nicknameRefusal(
  state: WorldState,
  catalogue: Catalogue,
  budgets: RuntimeBudgets,
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
  if (length > budgets.nicknameCharacters) {
    return refused(
      'too-long',
      nickname,
      [],
      `"${kept}" is ${length} characters, and a nickname here may have at most ${budgets.nicknameCharacters}: choose a shorter one.`,
    );
  }
  const shaped = sourceShaped(nickname, kept);
  if (shaped !== null) return shaped;
  const words = typedWords(kept);
  const collides = distinct(
    words.filter((word) => catalogue.words.has(word) || CONNECTORS.includes(word)),
  );
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
  const reserved = distinct(words.filter(isReserved));
  if (reserved.length > 0) {
    const are = reserved.length === 1 ? 'is a word' : 'are words';
    return refused(
      'reserved',
      nickname,
      reserved,
      `${quoted(reserved)} ${are} every world here reads, so "${kept}" would not always mean you: choose another nickname.`,
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

/**
 * The refusal of `nickname`, kept as `kept`, for a word shaped like
 * source, or null where none is: a word beginning with a colon is how a
 * property is written, and a period inside a word is how a path is (the
 * spec's Names › Nicknames).
 */
function sourceShaped(nickname: string, kept: string): NicknameRefused | null {
  const words = kept.split(' ');
  const colons = words.filter((word) => BEGINS_WITH_COLON.test(word));
  const periods = words.filter((word) => PERIOD_INSIDE.test(word));
  if (colons.length === 0 && periods.length === 0) return null;
  const shape =
    colons.length === 0
      ? 'have a period inside it'
      : periods.length === 0
        ? 'begin with a colon'
        : 'begin with a colon or have a period inside it';
  const collides = distinct(
    words.filter((word) => colons.includes(word) || periods.includes(word)),
  );
  const does = collides.length === 1 ? 'does' : 'do';
  return refused(
    'source-shaped',
    nickname,
    collides,
    `A nickname's word may not ${shape}, and ${quoted(collides)} ${does}: choose another nickname.`,
  );
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

/** `words` each once, in the order first written. */
function distinct(words: readonly string[]): string[] {
  return [...new Set(words)];
}

/** Words written out as a person reads a list of them: `"a"`, `"a" and "b"`, `"a", "b" and "c"`. */
function quoted(words: readonly string[]): string {
  const all = words.map((word) => `"${word}"`);
  return all.length === 1 ? all[0]! : `${all.slice(0, -1).join(', ')} and ${all.at(-1)}`;
}
