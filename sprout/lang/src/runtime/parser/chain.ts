// `and` or a comma before a verb, which joins two commands as `then`
// does (the spec's Parsing › Sequences, again and all): `take sack and
// take bottle`, `open trap door, turn on lantern, go down`. A verb here
// is a word some phrase a visitor may type begins with, or a direction
// where a phrase begins with a way out, so `take lamp and look` and `take
// lamp, north` chain, while `take x, y and z` stays a run. Where the `and`
// or comma falls is only a place the line may split; whether it does is
// the parser's, which prefers the reading that names things
// (`parser.ts`). A line has no addressee form, so `troll, hello` is the
// command `troll`, which no phrase reads, and the line is `unknown`.

import { CONNECTORS } from '../../declare/addressing.js';
import { directionOf } from '../../declare/directions.js';
import type { TypedIntentPhrase, TypedPhrase } from './phrases.js';

/** The phrases a line may begin a command with. */
export interface Starting {
  readonly phrases: readonly TypedPhrase[];
  readonly intentPhrases: readonly TypedIntentPhrase[];
}

/** Whether a word may begin a command, for each set of phrases, made once. */
const STARTERS = new WeakMap<readonly TypedPhrase[], (word: string) => boolean>();

/** Whether `word` begins a command some phrase of `grammar` reads. */
export function beginsCommand(word: string, grammar: Starting): boolean {
  let starts = STARTERS.get(grammar.phrases);
  if (starts === undefined) {
    const words = new Set<string>();
    let ways = false;
    for (const { verb, parts } of grammar.phrases) {
      const first = parts[0];
      if (first === undefined) continue;
      if ('words' in first) words.add(first.words[0]!);
      else if (verb.roles[first.slot]?.filler?.fills === 'exit') ways = true;
    }
    for (const { parts } of grammar.intentPhrases) {
      const first = parts[0];
      if (first !== undefined && 'words' in first) words.add(first.words[0]!);
    }
    starts = (one) => words.has(one) || (ways && directionOf(one) !== null);
    STARTERS.set(grammar.phrases, starts);
  }
  return starts(word);
}

/**
 * Where `words` may split as two commands: each `and` or comma, an `and`
 * with a comma before it or not, with a command's words before it and a
 * word beginning one after it, in the order written.
 */
export function chainPoints(words: readonly string[], grammar: Starting): number[] {
  const points: number[] = [];
  words.forEach((word, at) => {
    if (!CONNECTORS.includes(word) || at + 1 >= words.length) return;
    if (commandBefore(words, at).length === 0) return;
    if (beginsCommand(words[at + 1]!, grammar)) points.push(at);
  });
  return points;
}

/** The words before the `and` or comma at `at`, without the commas just before it. */
export function commandBefore(words: readonly string[], at: number): readonly string[] {
  let end = at;
  while (end > 0 && words[end - 1] === ',') end--;
  return words.slice(0, end);
}

/** The command after the `and` or comma at `at`, as a line the parser reads on its own turn. */
export function commandAfter(words: readonly string[], at: number): string {
  return words.slice(at + 1).join(' ');
}

/** The words after the `and` or comma at `at`, up to the next `and` or comma: what a name beginning there would be. */
export function stretchAfter(words: readonly string[], at: number): readonly string[] {
  const rest = words.slice(at + 1);
  const end = rest.findIndex((word) => CONNECTORS.includes(word));
  return end < 0 ? rest : rest.slice(0, end);
}
