// A nickname refused (the spec's Names › Nicknames; The host contract ›
// Admission and identity): why, and the words the host shows the person,
// asking for another. The engine decides what the world refuses; the
// host's moderation is the host's, asked of a nickname as the world would
// keep it.

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
