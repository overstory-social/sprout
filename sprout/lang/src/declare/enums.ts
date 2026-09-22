// Enums, and the symbols that belong to them (the spec's Properties ›
// Enums).
//
// A symbol is not a string. It belongs to a named enum, and a symbol
// literal is checked against the option set of whatever it is compared
// or assigned to — so `== :slver` is a compile error naming the options
// rather than a comparison that is false for ever. That check is the
// whole point of the type.
//
// Enums are also how two kinds from different libraries agree about a
// value: a property merging under composition merges only when both
// declarations name the same enum. So an enum's identity is its library
// AND its name, the same rule a kind's identity follows.
//
// What is here is the table and the checks that can be made without
// expressions. Checking a symbol where it is USED is `check/check.ts`'s,
// which calls `checkOption` below; the warning for a world declaration
// shadowing a library one is B21's.

import type { EnumDeclaration } from '../syntax/ast.js';
import type { Diagnostics } from '../source/diagnostics.js';
import type { Span } from '../source/source.js';

/** The standard library's namespace, in scope in every microworld. */
export const SPROUT = 'sprout';

/** An enum as the whole bundle sees it: whose it is, what it is called, what it holds. */
export interface DeclaredEnum {
  /** The world or library that declared it. */
  readonly library: string;
  readonly name: string;
  readonly options: readonly string[];
  readonly declaration: EnumDeclaration;
}

/** `sprout.Ward` — an enum's full identity, which is its library and its name. */
export function qualifiedName(library: string, name: string): string {
  return `${library}.${name}`;
}

/**
 * On input an option is typed as its humanised form, and on output a
 * slot renders it the same way: `the_press` is what a visitor means by
 * "the press".
 */
export function humanisedOption(option: string): string {
  return option.replaceAll('_', ' ');
}

/** The option a visitor's words name: "the press" is `the_press`. */
export function optionFromWords(words: string): string {
  return words.trim().replace(/\s+/g, '_');
}

/**
 * How many single-character edits turn one word into another, counting
 * a swap of two neighbours as ONE. That last part is not a refinement:
 * the spec's own example is `dyr` for `dry`, which is a swap, and plain
 * Levenshtein scores it two and would offer nothing.
 */
function distance(a: string, b: string): number {
  const rows: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const same = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + same);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, rows[i - 2]![j - 2]! + 1);
      }
      rows[i]![j] = best;
    }
  }
  return rows[a.length]![b.length]!;
}

/**
 * The option a misspelling most likely meant, or nothing. Only a word
 * close enough to be a slip is offered: "did you mean" on a wild guess
 * is worse than not asking, because an author will try it.
 */
export function nearestOption(word: string, options: readonly string[]): string | null {
  const allowed = Math.max(1, Math.floor(word.length / 3));
  let best: string | null = null;
  let bestAt = allowed + 1;
  for (const option of options) {
    const away = distance(word, option);
    if (away < bestAt) {
      best = option;
      bestAt = away;
    } else if (away === bestAt) {
      best = null; // two equally close: naming either would be a guess
    }
  }
  return bestAt <= allowed ? best : null;
}

/**
 * One enum, checked against itself: the first tier, where a declaration
 * has to agree with itself and nothing else is in scope yet.
 *
 * `optionsPerEnum` is the host's figure for the spec's Limits › Static
 * caps. It is passed in because the number is never this layer's.
 */
export function checkEnumDeclaration(
  declared: EnumDeclaration,
  optionsPerEnum: number,
  diagnostics: Diagnostics,
): void {
  // Said once, at the first option past the cap: how many an enum holds
  // is one fact about one enum, and repeating it at every option past
  // the line buries whatever else is wrong inside it.
  const over = declared.options[optionsPerEnum];
  if (over !== undefined) {
    diagnostics.refuse(
      over.at,
      `\`${declared.name.text}\` has ${declared.options.length} options, and ${optionsPerEnum} is as many as it may have.`,
      `Take some out, or split \`${declared.name.text}\` into two enums.`,
    );
  }

  const seen = new Map<string, Span>();
  for (const option of declared.options) {
    const before = seen.get(option.name.text);
    if (before !== undefined) {
      diagnostics.refuse(
        option.at,
        `\`${declared.name.text}\` lists \`${option.name.text}\` twice.`,
        'An option means one thing, so it is written once. Remove the second.',
      );
      continue;
    }
    seen.set(option.name.text, option.at);
  }
}

/** Every enum the bundle declares, by library and name. */
export class EnumTable {
  private readonly byQualified = new Map<string, DeclaredEnum>();

  /**
   * Add a library's declarations. Two enums of one name in one library
   * are a refusal naming the second; two in DIFFERENT libraries are not,
   * because an enum's identity is its library and its name.
   */
  add(library: string, declarations: readonly EnumDeclaration[], diagnostics: Diagnostics): void {
    for (const declared of declarations) {
      const key = qualifiedName(library, declared.name.text);
      const before = this.byQualified.get(key);
      if (before !== undefined) {
        diagnostics.refuse(
          declared.name.at,
          `${library} declares two enums called \`${declared.name.text}\`.`,
          'Give one of them another name, or remove it.',
        );
        continue;
      }
      this.byQualified.set(key, {
        library,
        name: declared.name.text,
        options: declared.options.map((option) => option.name.text),
        declaration: declared,
      });
    }
  }

  /** An enum by its full identity: `sprout.Ward` is not `ericworld.Ward`. */
  qualified(library: string, name: string): DeclaredEnum | null {
    return this.byQualified.get(qualifiedName(library, name)) ?? null;
  }

  /**
   * An enum written without a library, as read from inside `from`: the
   * asking world's own first, then the standard library's, because
   * `sprout` is in scope in every microworld and a world's own
   * declarations are unqualified. The WARNING for a world declaration
   * shadowing a library one is B21's; this is only the order.
   */
  unqualified(name: string, from: string): DeclaredEnum | null {
    return this.qualified(from, name) ?? this.qualified(SPROUT, name);
  }

  /** Every enum in the bundle, in the order it was added. */
  all(): DeclaredEnum[] {
    return [...this.byQualified.values()];
  }
}

/**
 * Check a symbol literal against the enum it is being compared or
 * assigned to. The one check an enum exists for, called wherever a
 * symbol meets a typed operand.
 */
export function checkOption(
  target: DeclaredEnum,
  option: string,
  at: Span,
  diagnostics: Diagnostics,
): boolean {
  if (target.options.includes(option)) return true;
  const meant = nearestOption(option, target.options);
  diagnostics.refuse(
    at,
    `\`${target.name}\` has no option \`${option}\`.${meant === null ? '' : ` Did you mean \`${meant}\`?`}`,
    `Options: ${target.options.join(', ')}.`,
  );
  return false;
}
