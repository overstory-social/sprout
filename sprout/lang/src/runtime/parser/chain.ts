// `and` before a verb, which joins two commands as `then` does (the
// spec's Parsing › Sequences, again and all): `take sack and take
// bottle`. A verb here is a word some phrase a visitor may type begins
// with, or a direction where a phrase begins with a way out, so `take
// lamp and look` and `take lamp and north` chain. Where the `and` falls
// is only a place the line may split; whether it does is the parser's,
// which prefers the reading that names things (`parser.ts`).

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
 * Where `words` may split as two commands: each `and`, a comma before it
 * or not, with a command's words before it and a word beginning one
 * after it, in the order written.
 */
export function chainPoints(words: readonly string[], grammar: Starting): number[] {
  const points: number[] = [];
  words.forEach((word, at) => {
    if (word !== 'and' || at + 1 >= words.length) return;
    if (commandBefore(words, at).length === 0) return;
    if (beginsCommand(words[at + 1]!, grammar)) points.push(at);
  });
  return points;
}

/** The words before the `and` at `at`, without a comma before it. */
export function commandBefore(words: readonly string[], at: number): readonly string[] {
  return words[at - 1] === ',' ? words.slice(0, at - 1) : words.slice(0, at);
}

/** The command after the `and` at `at`, as a line the parser reads on its own turn. */
export function commandAfter(words: readonly string[], at: number): string {
  return words.slice(at + 1).join(' ');
}

/** The words after the `and` at `at`, up to the next `and` or comma: what a name beginning there would be. */
export function stretchAfter(words: readonly string[], at: number): readonly string[] {
  const rest = words.slice(at + 1);
  const end = rest.findIndex((word) => CONNECTORS.includes(word));
  return end < 0 ? rest : rest.slice(0, end);
}
