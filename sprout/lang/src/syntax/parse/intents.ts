// `intent open_with { "open [y] with [x]"  do unlock (target: y, tool: x)
// when (y.get(:locked)) then open (target: y) }` (the spec's Parsing ›
// Intents). The body holds phrases in quotes and one `do`, its steps
// joined by `then`; each step is a verb, the slot filling each of its
// roles in brackets, which may be left out for a verb of no roles, and
// optionally `when` and a condition in brackets. What the phrases and
// steps may say, and whether they agree, is `declare/intents.ts`'s.

import type { Expr, Ident } from '../ast.js';
import type {
  IntentDeclaration,
  IntentFiller,
  IntentStep,
  PhraseDeclaration,
} from '../ast-verbs.js';
import { isReserved } from '../reserved.js';
import { spanning, type Span } from '../../source/source.js';
import { expression } from './expressions.js';
import { punct, type Parser } from './parser.js';
import { lowerCase, phrase } from './phrases.js';
import { recover, skipBracketed, stepPast } from './recovery.js';

/** An intent as written, for a remedy to show. */
const EXAMPLE =
  '`intent open_with { "open [y] with [x]"  do unlock (target: y, tool: x) then open (target: y) }`';

/** `intent <name> { … }`. Null where its name or its braces could not be read, having said why. */
export function intentDeclaration(p: Parser): IntentDeclaration | null {
  const keyword = p.next();
  const token = p.peek();
  if (token.kind !== 'name' || isReserved(token.text)) {
    if (token.kind === 'name') {
      p.diagnostics.refuse(
        token.at,
        `\`${token.text}\` is a word of the language, so it cannot name an intent.`,
        'Choose another word.',
      );
    } else if (token.kind === 'kind') {
      p.diagnostics.refuse(
        token.at,
        `An intent's name is a lower-case word, and \`${token.text}\` starts with a capital.`,
        `Write \`intent ${lowerCase(token.text)} { … }\`.`,
      );
    } else {
      p.diagnostics.refuse(
        token.at,
        '`intent` needs a name.',
        `An intent's name is a lower-case word: ${EXAMPLE}.`,
      );
    }
    recover(p);
    return null;
  }
  p.next();
  const name = p.ident(token);
  const open = p.take('punct', '{');
  if (open === null) {
    p.diagnostics.refuse(
      p.here(),
      `The phrases and steps of \`${name.text}\` go in braces.`,
      `Write ${EXAMPLE}.`,
    );
    recover(p);
    return null;
  }
  const phrases: PhraseDeclaration[] = [];
  let steps: IntentStep[] | null = null;
  let whole = true;
  let last: Span = open.at;
  for (;;) {
    const close = p.take('punct', '}');
    if (close !== null) {
      return {
        kind: 'intent',
        at: spanning(keyword.at, close.at),
        name,
        phrases,
        steps: steps ?? [],
        whole,
      };
    }
    if (p.done || p.atDeclarationStart()) {
      p.diagnostics.refuse(
        p.done ? p.source.endSpan : p.peek().at,
        `\`${name.text}\` is never closed.`,
        'Add a } after its phrases and steps.',
      );
      return {
        kind: 'intent',
        at: spanning(keyword.at, last),
        name,
        phrases,
        steps: steps ?? [],
        whole,
      };
    }
    const next = p.peek();
    if (next.kind === 'string') {
      const read = phrase(p);
      last = next.at;
      if (read !== null) phrases.push(read);
      else whole = false;
      continue;
    }
    if (next.kind === 'name' && next.text === 'do') {
      const word = p.next();
      if (steps !== null) {
        p.diagnostics.refuse(
          word.at,
          `\`${name.text}\` writes its steps twice.`,
          'Write one `do`, its steps joined by `then`.',
        );
      }
      const read = stepsAfter(p);
      last = read.steps.at(-1)?.at ?? word.at;
      if (steps === null) {
        steps = read.steps;
        whole &&= read.whole;
      }
      continue;
    }
    p.diagnostics.refuse(
      next.at,
      `An intent is not made of ${p.describe(next)}.`,
      `It holds its phrases in quotes and one \`do\` with its steps: ${EXAMPLE}.`,
    );
    stepPast(p);
    pastStep(p);
  }
}

/** The steps after `do`, the first one next and each after a `then`, and whether every one was read. */
function stepsAfter(p: Parser): { readonly steps: IntentStep[]; readonly whole: boolean } {
  const steps: IntentStep[] = [];
  let whole = true;
  for (;;) {
    const step = intentStep(p);
    if (step === null) {
      whole = false;
      pastStep(p);
    } else steps.push(step);
    if (p.take('name', 'then') === null) return { steps, whole };
  }
}

/**
 * Step over what a refusal named, to where the next step, phrase or `do`
 * may start, or the intent's `}`: brackets are stepped over whole, and a
 * declaration starting first stops it.
 */
function pastStep(p: Parser): void {
  let depth = 0;
  while (!p.done) {
    const token = p.peek();
    if (depth === 0) {
      if (punct(token, '}') || token.kind === 'string' || p.atRecoveryStop()) return;
      if (token.kind === 'name' && (token.text === 'then' || token.text === 'do')) return;
    }
    if (punct(token, '(') || punct(token, '{')) depth += 1;
    else if ((punct(token, ')') || punct(token, '}')) && depth > 0) depth -= 1;
    stepPast(p);
  }
}

/** One step: the verb, its fillers in brackets, and `when` with a condition. Null having said why. */
function intentStep(p: Parser): IntentStep | null {
  const verb = p.peek();
  if (verb.kind !== 'name' || verb.text === 'then' || verb.text === 'when') {
    p.diagnostics.refuse(
      verb.at,
      'A step names the verb it performs.',
      'Write the verb, and the slot filling each of its roles: `unlock (target: y, tool: x)`.',
    );
    return null;
  }
  p.next();
  const fillers: IntentFiller[] = [];
  let end = verb.at;
  const open = p.take('punct', '(');
  if (open !== null) {
    for (;;) {
      const close = p.take('punct', ')');
      if (close !== null) {
        end = close.at;
        break;
      }
      const filler = fillerNext(p);
      if (filler === null) {
        skipBracketed(p, ')');
        return null;
      }
      fillers.push(filler);
      if (p.take('punct', ',') === null && !p.at('punct', ')')) {
        p.diagnostics.refuse(
          p.peek().at,
          'The roles of a step are separated by commas, and its brackets closed.',
          'Write `unlock (target: y, tool: x)`.',
        );
        skipBracketed(p, ')');
        return null;
      }
    }
  }
  let when: Expr | null = null;
  const word = p.take('name', 'when');
  if (word !== null) {
    const condition = conditionAfter(p, word);
    if (condition === null) return null;
    when = condition.when;
    end = condition.close;
  }
  return { kind: 'intent-step', at: spanning(verb.at, end), verb: p.ident(verb), fillers, when };
}

/** `target: y`, the role next. Null having said why. */
function fillerNext(p: Parser): IntentFiller | null {
  const role = p.peek();
  const colon = p.peek(1);
  const slot = p.peek(2);
  if (role.kind !== 'name' || !punct(colon, ':') || slot.kind !== 'name') {
    p.diagnostics.refuse(
      role.at,
      "A step's role is its name, a colon, and the slot that fills it.",
      'Write `target: y`, the slot as the intent’s phrases name it in brackets.',
    );
    return null;
  }
  p.next();
  p.next();
  p.next();
  const roleIdent: Ident = p.ident(role);
  const slotIdent: Ident = p.ident(slot);
  return {
    kind: 'intent-filler',
    at: spanning(role.at, slot.at),
    role: roleIdent,
    slot: slotIdent,
  };
}

/** `(…)` after `when`, the word taken: the condition and where its bracket closes; null having said why. */
function conditionAfter(
  p: Parser,
  word: { readonly at: Span },
): { readonly when: Expr; readonly close: Span } | null {
  const example = 'unlock (target: y, tool: x) when (y.get(:locked))';
  const open = p.take('punct', '(');
  if (open === null) {
    p.diagnostics.refuse(
      p.source.span(word.at.end),
      "A step's `when` is followed by its condition in brackets.",
      `Write \`${example}\`.`,
    );
    return null;
  }
  if (!closesInStep(p)) {
    p.diagnostics.refuse(
      open.at,
      "The condition of this step's `when` is never closed.",
      'Add a ) after the condition.',
    );
    return null;
  }
  if (!p.deeper(open.at)) {
    skipBracketed(p, ')');
    return null;
  }
  try {
    const when = expression(p);
    if (when === null) {
      skipBracketed(p, ')');
      return null;
    }
    const close = p.take('punct', ')');
    if (close === null) {
      p.diagnostics.refuse(
        p.done ? p.source.endSpan : p.peek().at,
        "The condition of this step's `when` ends here, and its bracket is never closed.",
        'Add a ) after the condition.',
      );
      skipBracketed(p, ')');
      return null;
    }
    return { when, close: close.at };
  } finally {
    p.depth -= 1;
  }
}

/**
 * Whether the bracket just opened closes before this step ends, scanned
 * ahead without consuming: a `then`, `do`, phrase or `}` outside any
 * bracket, or a declaration starting, ends it first.
 */
function closesInStep(p: Parser): boolean {
  let depth = 1;
  for (let ahead = 0; ; ahead++) {
    const token = p.peek(ahead);
    if (token.kind === 'end') return false;
    if (punct(token, '(')) depth += 1;
    else if (punct(token, ')') && --depth === 0) return true;
    else if (depth === 1) {
      if (punct(token, '}') || token.kind === 'string' || p.atRecoveryStop(ahead)) return false;
      if (token.kind === 'name' && (token.text === 'then' || token.text === 'do')) return false;
    }
  }
}
