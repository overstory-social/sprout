// Where a phrase's slots fall in a typed line (the spec's Verbs › Slots):
// the phrase's words must be the line's words where they stand, and each
// slot takes the run of words between them. Where the words do not pin a
// slot, position does, and a slot takes the longest run first, so a
// longer noun is tried before a shorter one (Names › Nicknames: matched
// longest-first, as multi-word nouns are).

import type { TypedPart } from './phrases.js';

/** The words one slot takes: its role, by index, and where in the line they run. */
export interface SlotSpan {
  readonly role: number;
  readonly start: number;
  /** One past the last word. */
  readonly end: number;
}

/**
 * Every way `parts` can cover `words` exactly, each slot at least one
 * word, in the order they are tried: an earlier slot's longer run first.
 */
export function* slotSpans(
  parts: readonly TypedPart[],
  words: readonly string[],
): Generator<readonly SlotSpan[]> {
  yield* from(parts, words, 0, 0, []);
}

function* from(
  parts: readonly TypedPart[],
  words: readonly string[],
  part: number,
  at: number,
  spans: readonly SlotSpan[],
): Generator<readonly SlotSpan[]> {
  if (part === parts.length) {
    if (at === words.length) yield spans;
    return;
  }
  const here = parts[part]!;
  if ('words' in here) {
    if (!startsWith(words, at, here.words)) return;
    yield* from(parts, words, part + 1, at + here.words.length, spans);
    return;
  }
  // What the parts after this one need at least: a word each for a slot,
  // and their own words for a run of them.
  const after = parts
    .slice(part + 1)
    .reduce((least, next) => least + ('words' in next ? next.words.length : 1), 0);
  for (let end = words.length - after; end > at; end--) {
    yield* from(parts, words, part + 1, end, [...spans, { role: here.slot, start: at, end }]);
  }
}

function startsWith(words: readonly string[], at: number, run: readonly string[]): boolean {
  if (at + run.length > words.length) return false;
  return run.every((word, i) => words[at + i] === word);
}
