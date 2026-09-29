// A line some phrase read in part (the spec's Parsing › When nothing
// matches): its verb or intent understood, and a slot's words naming
// something in range the role cannot take. Each way the slots fill so is a
// partial reading, written as the words a visitor would type for it, a
// thing by its name after `the`, an exit by its direction or label, a
// value as it was typed; the one that
// matched most of the line's words, then filled most roles, is the one
// `cannot` says, a tie drawn from the turn's stream, never the one
// written first.

import type { Budget } from '../budget.js';
import type { Draw } from '../draws.js';
import type { InstanceId } from '../ids.js';
import type { Bound } from '../reading.js';
import type { Address } from './address.js';
import type { Filled } from './fill.js';
import type { SlotSpan } from './match.js';
import type { TypedPart } from './phrases.js';

/** One partial reading: its words, and what it is ranked by. */
export interface Partial {
  /** The line as far as it was understood, as a visitor would type it. */
  readonly words: string;
  /** How many of the line's words it matched literally, the things it cannot take included. */
  readonly literal: number;
  /** How many roles its slots fill, with what they can take or not. */
  readonly bound: number;
}

/** One slot's part in a partial reading: its words, and how many it matched. */
interface Written {
  readonly words: string;
  readonly literal: number;
}

/**
 * Every partial reading one placement of a phrase's slots makes, each
 * one a step: none where no slot names a thing it cannot take, or a slot
 * names nothing, or no thing, as an exit's or a set's words that fit
 * nothing do.
 */
export function partialsOf(
  parts: readonly TypedPart[],
  spans: readonly SlotSpan[],
  fills: readonly Filled[],
  addressOf: (id: InstanceId) => Address,
  budget: Budget,
): Partial[] {
  if (!fills.some((one) => one.fills === 'unfit')) return [];
  const each: Written[][] = [];
  for (const filled of fills) {
    if (filled.fills === 'nothing') return [];
    if (filled.fills === 'words') {
      each.push([{ words: filled.words.join(' '), literal: filled.words.length }]);
      continue;
    }
    const options = filled.fills === 'options' ? filled.options : filled.things;
    if (options.length === 0) return [];
    each.push(
      options.map(({ bound, literal }) => ({ words: boundWords(bound, addressOf), literal })),
    );
  }
  let combined: Written[][] = [[]];
  for (const options of each) {
    combined = combined.flatMap((partial) => options.map((one) => [...partial, one]));
  }
  const literal = parts.reduce((sum, part) => sum + ('words' in part ? part.words.length : 0), 0);
  return combined.map((written) => {
    budget.spend();
    const words = parts
      .map((part) => {
        if ('words' in part) return part.words.join(' ');
        return written[spans.findIndex((span) => span.role === part.slot)]!.words;
      })
      .join(' ');
    const matched = written.reduce((sum, one) => sum + one.literal, literal);
    return { words, literal: matched, bound: spans.length };
  });
}

/** The words of the partial reading `cannot` says: the best, a tie drawn, a step. `partials` is never empty. */
export function choosePartial(partials: readonly Partial[], draws: Draw, budget: Budget): string {
  const ordered = [...partials].sort(comparePartial);
  const tied = ordered.filter((one) => comparePartial(one, ordered[0]!) === 0);
  if (tied.length === 1) return tied[0]!.words;
  budget.spend();
  return tied[draws.below(tied.length)]!.words;
}

/** Negative where `a` ranks before `b`: more words matched, then more roles filled. */
export function comparePartial(a: Partial, b: Partial): number {
  if (a.literal !== b.literal) return b.literal - a.literal;
  return b.bound - a.bound;
}

/** What fills a slot, as a visitor types it: a thing, a set's things joined by `and`, or an exit. */
function boundWords(bound: Bound, addressOf: (id: InstanceId) => Address): string {
  if ('object' in bound) return definite(addressOf(bound.object));
  if ('set' in bound) return bound.set.map((id) => definite(addressOf(id))).join(' and ');
  if ('exit' in bound) return bound.exit.direction ?? bound.exit.label;
  throw new Error('A slot binds a value only once its reading is known, never as an option.');
}

/** A thing as a visitor names it in a line: `the` and its name, or its name alone where it takes no article. */
function definite(address: Address): string {
  return address.article === 'none' ? address.name : `the ${address.name.toLowerCase()}`;
}
