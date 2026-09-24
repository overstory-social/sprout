// Prose, checked: a passage's body or a line in quotes, against the scope
// it renders in (the spec's Prose › Slots, Conditionals and loops;
// Properties › Where types come from).
//
// A slot renders an object, an option, a number, a string, or another
// object's passage named through a binding typed by a kind that declares
// it; a boolean is refused, since an `{if}` says what it means, and so is
// a bare list or set, since the separator and the empty case are the
// author's. A condition is a boolean that compares, narrows with `is()`
// or tests identity, and neither a slot nor a condition does arithmetic.
// `{for x in c}` walks a container, `{for x: K in c}` the contents
// composing `K`, typed so, and `{for x of l}` a list or a set role; each
// binds `$first`, `$last`, `$index` and `$count` inside, and nowhere else.
// Each choice of a `{one of}` is checked as a block of its own, and the
// choice is refused where the prose draws nothing (`chance.ts`).

import type { Expr } from '../syntax/ast.js';
import {
  isLoopVariable,
  LOOP_VARIABLES,
  type Prose,
  type ProseFor,
  type ProseIf,
  type ProseOneOf,
  type ProseSlot,
} from '../syntax/ast-prose.js';
import { nearestOption, shownName } from '../declare/enums.js';
import { BOOLEAN, integer } from '../declare/types.js';
import { readable } from '../source/words.js';
import {
  forElementBinding,
  loopBinding,
  setMemberBinding,
  showBindingType,
  valueOf,
  type Binding,
  type BindingType,
  type Scope,
} from './bindings.js';
import { branchScope, checkCondition, resolveKind, typeOf, type CheckContext } from './check.js';
import { kindName } from '../declare/kinds.js';
import { EFFECTS } from './check/writes.js';
import type { ProseRecord } from './speech.js';
import { refuseDraw } from './chance.js';

/** Check `prose` in `context`'s scope, recording each passage a slot renders and each option it renders. */
export function checkProse(prose: Prose, context: CheckContext, rendered: ProseRecord): void {
  const scope = context.scope.inner();
  for (const name of Object.keys(LOOP_VARIABLES)) {
    if (context.scope.lookup(name) !== null) continue;
    scope.withhold(
      {
        name,
        at: prose.at,
        unread: {
          message: `\`${name}\` is a loop's own, and only a \`{for}\` binds it.`,
          remedy: 'Use it between `{for …}` and the `{/for}` that closes it.',
        },
        bound: {
          bindable: false,
          words: {
            message: `\`${name}\` is a loop's own, and \`bound\` asks about a verb's tool.`,
            remedy: 'Take the `bound` out.',
          },
        },
      },
      context.diagnostics,
    );
  }
  pieces(prose, { ...context, scope }, rendered);
}

function pieces(prose: Prose, context: CheckContext, rendered: ProseRecord): void {
  for (const piece of prose.pieces) {
    switch (piece.kind) {
      case 'prose-slot':
        checkSlot(piece, context, rendered);
        break;
      case 'prose-if':
        checkIf(piece, context, rendered);
        break;
      case 'prose-for':
        checkFor(piece, context, rendered);
        break;
      case 'prose-one-of':
        checkOneOf(piece, context, rendered);
        break;
      default:
        break;
    }
  }
}

/** One slot: what it renders, which is anything but a boolean, a list or a set. */
function checkSlot(slot: ProseSlot, context: CheckContext, rendered: ProseRecord): void {
  const { expr } = slot;
  if (!noArithmetic(expr, context)) return;
  if (expr.kind === 'member' && expr.member.text !== 'count') {
    renderedPassage(expr.receiver, expr.member, context, rendered);
    return;
  }
  const type = typeOf(expr, context);
  if (type === null) return;
  if (type.binds === 'set') {
    context.diagnostics.refuse(
      expr.at,
      `A slot does not render ${showBindingType(type)} whole: how its things are joined, and what is said when there are none, is yours.`,
      'Walk it: `{for x of <set>}{x}{if $last}.{else}, {/if}{/for}`.',
    );
    return;
  }
  if (type.binds !== 'value') return;
  if (type.type.type === 'symbol') rendered.option(slot);
  if (type.type.type === 'boolean') {
    context.diagnostics.refuse(
      expr.at,
      'This slot is true or false, and a passage says what that means in words.',
      'Write an `{if}`: `{if <condition>}…{else}…{/if}`.',
    );
  } else if (type.type.type === 'list') {
    context.diagnostics.refuse(
      expr.at,
      `A slot does not render ${showBindingType(type)} whole: how its elements are joined, and what is said when there are none, is yours.`,
      'Walk it: `{for x of <list>}{x}{if $last}.{else}, {/if}{/for}`.',
    );
  }
}

/** `{pot.greeting}`: a passage of the kind `pot` is typed by, rendered with `pot` as its own `self`. */
function renderedPassage(
  receiver: Expr,
  member: { readonly text: string; readonly at: ProseSlot['at'] },
  context: CheckContext,
  rendered: ProseRecord,
): void {
  const type = typeOf(receiver, context);
  if (type === null) return;
  if (type.binds !== 'object') {
    context.diagnostics.refuse(
      member.at,
      `Only a thing in the world has passages, and this is ${showBindingType(type)}.`,
      'Name a binding that holds a thing in the world, as in `{pot.greeting}`.',
    );
    return;
  }
  if (type.kind === null) {
    context.diagnostics.refuse(
      member.at,
      'Sprout does not know what this is, so it cannot render one of its passages.',
      type.remedy ?? 'Narrow it first, as in `{if thing.is(Pot)}{thing.greeting}{/if}`.',
    );
    return;
  }
  const kind = type.kind;
  if (!kind.passages.has(member.text)) {
    const known = [...kind.passages.keys()];
    const meant = nearestOption(member.text, known);
    context.diagnostics.refuse(
      member.at,
      `\`${kind.name}\` has no passage \`${member.text}\`.${meant === null ? '' : ` Did you mean \`${meant}\`?`}`,
      known.length === 0
        ? `Write \`passage ${member.text} { … }\` in \`${kind.name}\`.`
        : `Write \`passage ${member.text} { … }\` in \`${kind.name}\`, or render one it has: ${readable(known)}.`,
    );
    return;
  }
  rendered.render({
    name: member.text,
    at: member.at,
    kind,
    scope: personOf(context.scope),
    undrawn: context.undrawn ?? null,
  });
}

/** What a passage rendered from here is run with: `actor` and `here`, where they are bound. */
function personOf(scope: Scope): Scope {
  const kept = new Set(['actor', 'here']);
  const others = [...scope.names(), ...scope.withheldNames()].filter((name) => !kept.has(name));
  return scope.carried(new Set(others));
}

/** `{if c}…{else if d}…{else}…{/if}`, walked as the chain it is. */
function checkIf(block: ProseIf, context: CheckContext, rendered: ProseRecord): void {
  for (let link: ProseIf = block; ;) {
    const checked =
      noArithmetic(link.condition, context) && checkCondition(link.condition, context);
    const scope = checked ? branchScope(link.condition, context) : context.scope;
    pieces(link.then, { ...context, scope: scope.inner() }, rendered);
    const otherwise = link.otherwise;
    if (otherwise === null) return;
    if (otherwise.kind === 'prose') {
      pieces(otherwise, { ...context, scope: context.scope.inner() }, rendered);
      return;
    }
    link = otherwise;
  }
}

/** `{one of}…{or}…{/one of}`: refused where nothing may draw, and each choice checked in a scope of its own. */
function checkOneOf(block: ProseOneOf, context: CheckContext, rendered: ProseRecord): void {
  if (context.undrawn !== undefined) {
    refuseDraw({ written: '{one of}', at: block.opened }, context.undrawn, context.diagnostics);
  }
  for (const choice of block.choices) {
    pieces(choice, { ...context, scope: context.scope.inner() }, rendered);
  }
}

/** `{for x in c}`, `{for x: K in c}`, `{for x of l}`: the walk, and its body with `x` and the loop's own names bound. */
function checkFor(block: ProseFor, context: CheckContext, rendered: ProseRecord): void {
  const variable = forVariable(block, context);
  if (variable === null) return;
  const inner = context.scope.inner();
  if (!inner.introduce(variable, context.diagnostics)) return;
  let scope = inner;
  for (const [name, type] of Object.entries(LOOP_VARIABLES)) {
    if (!isLoopVariable(name)) continue;
    const value = valueOf(type === 'boolean' ? BOOLEAN : integer());
    const binding: Binding = { name, type: value, origin: 'for', at: block.at, writable: false };
    scope = scope.bounding(binding);
  }
  pieces(block.body, { ...context, scope }, rendered);
}

/** What a `{for}` binds its variable to, or null having said why it walks nothing. */
function forVariable(block: ProseFor, context: CheckContext): Binding | null {
  const { variable, over } = block;
  if (!noArithmetic(over, context)) return null;
  const type = typeOf(over, context);
  if (type === null) return null;
  if (block.walks === 'in') {
    if (!walkable(type, over, context)) return null;
    const filter = block.filter === null ? null : resolveKind(block.filter, context);
    if (block.filter !== null && filter === null) return null;
    return loopBinding(variable.text, filter, variable.at, true);
  }
  if (type.binds === 'set') return setMemberBinding(variable.text, type.kind, variable.at, true);
  if (type.binds === 'value' && type.type.type === 'list') {
    return forElementBinding(variable.text, type.type.element, variable.at);
  }
  const shown =
    type.binds === 'object' && type.kind !== null
      ? `\`${shownName(kindName(type.kind), context.from)}\``
      : showBindingType(type);
  context.diagnostics.refuse(
    over.at,
    `\`{for … of}\` walks a list or a set role, and this is ${shown}.`,
    type.binds === 'object'
      ? `To walk what it holds, write \`{for ${variable.text} in …}\`.`
      : 'Name a list, as in `self.get(:keys)`, or a role marked `many`.',
  );
  return null;
}

/** Whether `{for … in}` can walk what `over` is: a thing whose kind holds things. */
function walkable(type: BindingType, over: Expr, context: CheckContext): boolean {
  if (type.binds === 'object' && type.kind !== null && type.kind.contains) return true;
  const [message, remedy] =
    type.binds !== 'object'
      ? [
          `\`{for … in}\` walks what a thing holds, and this is ${showBindingType(type)}.`,
          'Walk a list or a role marked `many` with `{for x of …}`.',
        ]
      : type.kind === null
        ? [
            'Sprout does not know whether this holds anything.',
            type.remedy ?? 'Narrow it first, as in `{if thing.is(sprout.Container)}…{/if}`.',
          ]
        : [
            `\`${shownName(kindName(type.kind), context.from)}\` holds nothing, so there is nothing to walk.`,
            'Containment is a declaration: a kind that holds things writes `contains`.',
          ];
  context.diagnostics.refuse(over.at, message, remedy);
  return false;
}

/**
 * Whether an expression only reads, having refused the first `+` or `-`
 * it holds, or the first write: a passage does neither. A minus written
 * on a number is the number, not a sum. Walked with a stack, as a long
 * chain has no bracket to bound it.
 */
function noArithmetic(expr: Expr, context: CheckContext): boolean {
  const stack: Expr[] = [expr];
  while (stack.length > 0) {
    const node = stack.pop()!;
    switch (node.kind) {
      case 'binary':
        if (node.operator === '+' || node.operator === '-') return refuseArithmetic(node, context);
        stack.push(node.right, node.left);
        break;
      case 'unary':
        if (node.operator === '-' && node.operand.kind !== 'integer') {
          return refuseArithmetic(node, context);
        }
        stack.push(node.operand);
        break;
      case 'member':
        stack.push(node.receiver);
        break;
      case 'call':
        if (EFFECTS.has(node.method.text)) {
          context.diagnostics.refuse(
            node.method.at,
            `A passage only reads, and \`${node.method.text}\` writes.`,
            'Write it in the body that says the passage, before the passage is said.',
          );
          return false;
        }
        stack.push(...node.arguments, node.receiver);
        break;
      case 'free-call':
        stack.push(...node.arguments);
        break;
      default:
        break;
    }
  }
  return true;
}

function refuseArithmetic(node: Expr, context: CheckContext): false {
  context.diagnostics.refuse(
    node.at,
    'A passage reads what is there and does no arithmetic.',
    'Render a number as it is held, as in `{self.count}`, and let an `{if}` choose the words around it.',
  );
  return false;
}
