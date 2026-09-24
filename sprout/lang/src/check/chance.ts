// Where chance is forbidden (the spec's Chance › Where chance is
// forbidden; The compiler › What it refuses). A body that decides or is
// polled draws nothing: a consent guard and a `permit`, asked as part of
// a decision they must not change; an exit's `when`, asked to build what
// a visitor can see and go; a pass rule, asked whenever range is walked,
// a poll's among it; and a line the engine says in a poll. A passage said
// or rendered from one of them is held to the same rule, and the refusal
// falls where it is said, since the passage may vary freely wherever else
// it is said. B31 adds a `describe`.

import type { Expr, GuardName } from '../syntax/ast.js';
import type { Prose, ProseIf } from '../syntax/ast-prose.js';
import type { Diagnostics } from '../source/diagnostics.js';
import type { Span } from '../source/source.js';

/** Why a body draws nothing: what it is, as its refusal names it. */
export type Undrawn =
  | { readonly by: 'guard'; readonly guard: GuardName }
  | { readonly by: 'permit' }
  | { readonly by: 'when' }
  | { readonly by: 'pass'; readonly written: string }
  | { readonly by: 'poll'; readonly line: string };

/** The free calls that draw, which are the only free calls there are. */
export const DRAWS: ReadonlySet<string> = new Set(['chance', 'random']);

/** A draw as written: `chance`, `random` or `{one of}`, and where. */
export interface Drawn {
  readonly written: string;
  readonly at: Span;
}

/** What an undrawn body is called at the head of a sentence, and why it draws nothing. */
function words(undrawn: Undrawn): { readonly what: string; readonly why: string } {
  switch (undrawn.by) {
    case 'guard':
      return {
        what: `\`${undrawn.guard}\``,
        why: 'a guard is asked as part of a decision it must not change',
      };
    case 'permit':
      return {
        what: 'a `permit`',
        why: 'a `permit` is asked as part of a decision it must not change',
      };
    case 'when':
      return {
        what: "an exit's `when`",
        why: 'it is asked to show a visitor the ways out, so a roll would offer a way that vanishes when taken',
      };
    case 'pass':
      return {
        what: `\`${undrawn.written}\``,
        why: 'a pass rule is asked whenever range is walked, by a poll too, and a poll draws nothing',
      };
    case 'poll':
      return {
        what: `the world's \`${undrawn.line}\``,
        why: 'a poll says it, and a poll draws nothing',
      };
  }
}

/** `chance`, `random` or `{one of}` written where `undrawn` holds. */
export function refuseDraw(drawn: Drawn, undrawn: Undrawn, diagnostics: Diagnostics): void {
  const { what, why } = words(undrawn);
  diagnostics.refuse(
    drawn.at,
    `${capitalised(what)} may not use \`${drawn.written}\`: ${why}.`,
    undrawn.by === 'poll'
      ? 'Write words that are the same every time; to vary them, read what the world holds in an `{if}`.'
      : 'Roll in a `do`, a handler or a tick, keep what it gave on a property, and read that here.',
  );
}

/** A passage that draws, said (or rendered, by a slot) at `at` from where `undrawn` holds. */
export function refuseDrawingPassage(
  name: string,
  drawn: Drawn,
  how: 'said' | 'rendered',
  at: Span,
  undrawn: Undrawn,
  diagnostics: Diagnostics,
): void {
  const { what, why } = words(undrawn);
  diagnostics.refuse(
    at,
    `The passage \`${name}\` uses \`${drawn.written}\`, and it is ${how} from ${what}, which may not: ${why}.`,
    'Say words here that do not vary, or keep the variation on a property a `do` or a tick sets, and read that in an `{if}`.',
  );
}

function capitalised(text: string): string {
  return text.startsWith('`') ? text : text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The first draw a passage's own words make, in the order they are
 * written: a `{one of}`, or `chance` or `random` in a slot or a
 * condition. A passage a slot renders is its own, and not looked into.
 */
export function firstDraw(prose: Prose): Drawn | null {
  for (const piece of prose.pieces) {
    switch (piece.kind) {
      case 'prose-one-of':
        return { written: '{one of}', at: piece.opened };
      case 'prose-slot': {
        const found = drawIn(piece.expr);
        if (found !== null) return found;
        break;
      }
      case 'prose-for': {
        const found = drawIn(piece.over) ?? firstDraw(piece.body);
        if (found !== null) return found;
        break;
      }
      case 'prose-if': {
        for (let link: ProseIf | Prose | null = piece; link !== null;) {
          if (link.kind === 'prose') {
            const found = firstDraw(link);
            if (found !== null) return found;
            break;
          }
          const found = drawIn(link.condition) ?? firstDraw(link.then);
          if (found !== null) return found;
          link = link.otherwise;
        }
        break;
      }
      default:
        break;
    }
  }
  return null;
}

/** The first `chance` or `random` an expression calls, walked with a stack as a long chain has no bracket to bound it. */
export function drawIn(expr: Expr): Drawn | null {
  const stack: Expr[] = [expr];
  while (stack.length > 0) {
    const node = stack.pop()!;
    switch (node.kind) {
      case 'free-call':
        if (DRAWS.has(node.name.text)) return { written: node.name.text, at: node.name.at };
        stack.push(...[...node.arguments].reverse());
        break;
      case 'binary':
        stack.push(node.right, node.left);
        break;
      case 'unary':
        stack.push(node.operand);
        break;
      case 'member':
        stack.push(node.receiver);
        break;
      case 'call':
        stack.push(...[...node.arguments].reverse(), node.receiver);
        break;
      default:
        break;
    }
  }
  return null;
}
