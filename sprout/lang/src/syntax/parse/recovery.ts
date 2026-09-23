// Stepping over what could not be read, so that a declaration the parser
// cannot read costs that declaration and not the file (the first tier of
// the spec's The compiler › Two tiers). Nothing here says anything to the
// author: each caller names what it abandoned, and these only move the
// cursor past it.

import { punct, type Parser } from './parser.js';

/** Which bracket opens which, for stepping over what was refused. */
const OPENER_OF: ReadonlyMap<string, string> = new Map([
  [']', '['],
  [')', '('],
  ['}', '{'],
]);

/** What the text after an item turns out to mean. */
type Separator =
  /** The list ends here, or the file does. */
  | 'end'
  /** A separator was written and has been consumed. */
  | 'comma'
  /** No separator, but the lexer stepped over something here and has said so. */
  | 'gap'
  /** No separator, and nothing explains its absence. */
  | 'missing';

/**
 * Step over a construct being abandoned, its opening bracket
 * already taken. Counting matched pairs leaves the reader exactly
 * past the construct, so its CLOSER is never left in the stream for
 * the enclosing loop to take as its own and end early on.
 */
export function skipBracketed(p: Parser, close: string): void {
  const open = OPENER_OF.get(close)!;
  // Find the closer BEFORE taking anything, so a bracket that was
  // never closed takes nothing rather than the rest of the file. And
  // nothing stops the skip early, not even a declaration keyword:
  // the lexer reads `message` as a plain name, so `[message foo]` is
  // a list of two things and the skip walks straight past it.
  let depth = 1;
  let ahead = 0;
  for (;;) {
    const token = p.peek(ahead);
    if (token.kind === 'end') return; // never closed: take nothing
    if (token.kind === 'punct') {
      if (token.text === open) depth += 1;
      else if (token.text === close && --depth === 0) break;
    }
    ahead += 1;
  }
  for (let i = 0; i <= ahead; i++) p.next();
}

/** What the text after an item means. A comma, where there is one, is consumed. */
export function separator(p: Parser, close: string): Separator {
  if (p.done) return 'end';
  if (p.at('punct', close)) return 'end';
  if (p.take('punct', ',') !== null) return 'comma';
  if (p.peek().afterRefusal) return 'gap';
  return 'missing';
}

/** Step over everything up to the next thing that could start a declaration. */
export function recover(p: Parser): void {
  while (!p.done) {
    if (p.atRecoveryStop()) return;
    p.next();
  }
}

/**
 * Step over an enum's remaining options. Says whether it found the
 * closing brace, so the caller can report an enum the file simply ran
 * out before closing.
 */
export function recoverInBraces(p: Parser): boolean {
  let depth = 1;
  while (!p.done) {
    if (p.at('punct', '{')) {
      depth += 1;
      p.next();
      continue;
    }
    if (p.at('punct', '}')) {
      depth -= 1;
      p.next();
      if (depth === 0) return true;
      continue;
    }
    // Only at the body's own depth. Below it an unmatched `{` means
    // the brace structure is already lost, and a keyword down there is
    // no more trustworthy than anything else — reading it as a
    // declaration promotes nested text to the top of the file.
    if (depth === 1 && p.atRecoveryStop()) return false;
    p.next();
  }
  return false;
}

/**
 * Advance past the token here: one token, or the whole `[`…`]` run
 * where it is a `[` that closes, so a bracket a refused item wrote
 * correctly is never taken for its container's own. This is the step
 * every recovery walk takes.
 */
export function stepPast(p: Parser): void {
  const run = punct(p.peek(), '[') ? closedBracketRun(p) : 0;
  for (let i = 1; i < run; i++) p.next();
  p.next();
}

/**
 * How many tokens the `[` here spans through its own `]`, or 0 where
 * no `]` closes it before a brace or the end of the file.
 */
export function closedBracketRun(p: Parser): number {
  if (p.unclosedBrackets.has(p.peek().at.start)) return 0;
  // The brackets still open at each point, innermost last: the `[`
  // here is closed exactly when its own entry is popped.
  const open: number[] = [];
  for (let ahead = 0; ; ahead++) {
    const token = p.peek(ahead);
    if (token.kind === 'end' || punct(token, '{') || punct(token, '}')) {
      for (const start of open) p.unclosedBrackets.add(start);
      return 0;
    }
    if (punct(token, '[')) open.push(token.at.start);
    else if (punct(token, ']') && open.pop() !== undefined && open.length === 0) {
      return ahead + 1;
    }
  }
}
