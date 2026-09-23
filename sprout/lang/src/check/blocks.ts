// A body's blocks, checked statement by statement, for the three kinds of
// body that hold them today: a consent guard, a role's `permit`, and a
// role's `do` (the spec's Movement and consent › Guards are read-only;
// Verbs › The two passes; Prose; The compiler › What it refuses).
//
// A guard and a `permit` decide: they read, and end in `allow` or
// `refuse`, and a write, a `spawn`, a `destroy` or a `say` in one is
// refused, since the engine asks it before anything happens and it must
// not change the world underneath the decision it is part of. A `do`
// acts: it writes, spawns, destroys and speaks, and `refuse` and `allow`
// are refused there, since the deciding was done. `if (x.is(K))` narrows
// `x`, and `if (bound tool)` binds `tool`, for the branch each guards.
// Statements after an `allow` or a `refuse` are accepted and never run.

import type {
  Block,
  CallExpr,
  Expr,
  IfStatement,
  RefuseStatement,
  SayStatement,
  Statement,
} from '../syntax/ast.js';
import type { GuardName } from '../syntax/ast.js';
import type { Span } from '../source/source.js';
import { nearestOption } from '../declare/enums.js';
import type { Binding, Scope } from './bindings.js';
import { checkCondition, isEffect, narrowingOf, type CheckContext } from './check.js';
import { checkDestroy, checkEffect, checkLet, checkSpawn } from './statements.js';

/** Which body a block belongs to, which is what decides what it may do. */
export type BodyKind =
  | { readonly body: 'guard'; readonly guard: GuardName }
  | { readonly body: 'permit' }
  | { readonly body: 'do' };

/** A block, in a scope of its own, as the body it belongs to allows. */
export function checkBlock(block: Block, outer: CheckContext, kind: BodyKind): void {
  const context: CheckContext = { ...outer, scope: outer.scope.inner() };
  for (const statement of block.statements) checkStatement(statement, context, kind);
}

function checkStatement(statement: Statement, context: CheckContext, kind: BodyKind): void {
  const decides = kind.body !== 'do';
  switch (statement.kind) {
    case 'let':
      if (statement.value.kind === 'spawn' && decides)
        readOnly('spawn', statement.value.at, context, kind);
      else checkLet(statement, context);
      return;
    case 'if':
      checkIf(statement, context, kind);
      return;
    case 'refuse':
      if (decides) checkPassage(statement, context);
      else acts(statement.at, 'refuse', context);
      return;
    case 'allow':
      if (!decides) acts(statement.at, 'allow', context);
      return;
    case 'say':
      if (kind.body === 'do') checkPassage(statement, context);
      else refuseSay(statement, context, kind);
      return;
    case 'spawn':
      if (decides) readOnly('spawn', statement.at, context, kind);
      else checkSpawn(statement, context);
      return;
    case 'destroy':
      if (decides) readOnly('destroy', statement.at, context, kind);
      else checkDestroy(statement, context);
      return;
    case 'expression-statement':
      if (decides && isEffect(statement.expression)) {
        refuseWrite(statement.expression, context, kind);
      } else checkEffect(statement.expression, context);
      return;
  }
}

/**
 * `if`, and each `else if` after it, walked as the chain it is. A
 * condition `x.is(K)` narrows `x` to `K`, and `bound tool` binds `tool`,
 * in the branch it guards.
 */
function checkIf(statement: IfStatement, context: CheckContext, kind: BodyKind): void {
  for (let link: IfStatement = statement; ;) {
    const scope = checkCondition(link.condition, context)
      ? branchScope(link.condition, context)
      : context.scope;
    checkBlock(link.then, { ...context, scope }, kind);
    const otherwise = link.otherwise;
    if (otherwise === null) return;
    if (otherwise.kind === 'block') {
      checkBlock(otherwise, context, kind);
      return;
    }
    link = otherwise;
  }
}

/** The scope a condition, checked already, opens for the branch it guards. */
function branchScope(condition: Expr, context: CheckContext): Scope {
  const narrowing = narrowingOf(condition, context);
  if (narrowing !== null) return context.scope.narrowing(narrowing.binding, narrowing.kind);
  const bound = boundOf(condition, context);
  return bound === null ? context.scope : context.scope.bounding(bound);
}

/** `bound tool` written as a whole condition: the binding `tool` has in the branch it guards. */
function boundOf(condition: Expr, context: CheckContext): Binding | null {
  if (condition.kind !== 'bound') return null;
  const withheld = context.scope.withheld(condition.name.text);
  return withheld !== null && withheld.bound.bindable ? withheld.bound.binding : null;
}

/**
 * `refuse full` or `say taken` names a passage of the kind that wrote the
 * body; words in quotes need nothing.
 */
function checkPassage(statement: RefuseStatement | SayStatement, context: CheckContext): void {
  const said = statement.said;
  const self = context.self;
  if (said.kind === 'string' || self === null || self.passages.has(said.text)) return;
  const word = statement.kind;
  const quoted = word === 'refuse' ? '"No room here."' : '"The bolt slides back."';
  const meant = nearestOption(said.text, [...self.passages.keys()]);
  context.diagnostics.refuse(
    said.at,
    `\`${self.name}\` has no passage \`${said.text}\`.${meant === null ? '' : ` Did you mean \`${meant}\`?`}`,
    meant === null
      ? `Write \`passage ${said.text} { … }\` in \`${self.name}\`, or give the words in quotes, as in \`${word} ${quoted}\`.`
      : `Write \`${word} ${meant}\`, or write \`passage ${said.text} { … }\` in \`${self.name}\`.`,
  );
}

/** What a remedy tells an author to do with what a deciding body may not do. */
function readOnlyRemedy(kind: BodyKind): string {
  return kind.body === 'guard'
    ? 'Move it to a handler or a `do`; a guard ends in `allow` or `refuse`.'
    : 'Move it to `do`; a `permit` ends in `allow` or `refuse`.';
}

/** A deciding body, as a refusal names it. */
function decider(kind: BodyKind): string {
  return kind.body === 'guard' ? 'a guard' : 'a `permit`';
}

/** `spawn` or `destroy self` where a guard or a `permit` decides. */
function readOnly(
  what: 'spawn' | 'destroy',
  at: Span,
  context: CheckContext,
  kind: BodyKind,
): void {
  context.diagnostics.refuse(
    at,
    what === 'spawn'
      ? `\`spawn\` makes a new thing, and ${decider(kind)} only reads and decides.`
      : `\`destroy self\` removes something, and ${decider(kind)} only reads and decides.`,
    readOnlyRemedy(kind),
  );
}

/** `self.set(…)` and the rest: a write, which a guard or a `permit` may not make. */
function refuseWrite(call: CallExpr, context: CheckContext, kind: BodyKind): void {
  const receiver = call.receiver.kind === 'binding' ? `${call.receiver.name.text}.` : '';
  context.diagnostics.refuse(
    call.at,
    `\`${receiver}${call.method.text}\` writes, and ${decider(kind)} only reads and decides.`,
    readOnlyRemedy(kind),
  );
}

/** `say` where nobody is spoken to: a guard, or a `permit`, which only decides. */
function refuseSay(statement: SayStatement, context: CheckContext, kind: BodyKind): void {
  const at = spanOfWord(statement);
  if (kind.body === 'guard') {
    context.diagnostics.refuse(
      at,
      `\`say\` has nobody to speak to inside \`${kind.guard}\`.`,
      "It belongs in a role's `do`.",
    );
    return;
  }
  context.diagnostics.refuse(
    at,
    '`say` speaks, and a `permit` only decides.',
    'Move it to `do`, or make it the words of a `refuse`.',
  );
}

/** `refuse` or `allow` in a `do`, which acts once the deciding is done. */
function acts(at: Span, word: 'refuse' | 'allow', context: CheckContext): void {
  context.diagnostics.refuse(
    at,
    `\`${word}\` decides, and a \`do\` acts.`,
    word === 'refuse'
      ? 'Move it to `permit`, where the deciding is done.'
      : 'Take it out: a `do` runs once every `permit` has allowed.',
  );
}

/** The span of a `say`'s own word, where a refusal of the statement points. */
function spanOfWord(statement: SayStatement): Span {
  const at = statement.at;
  return at.source.span(at.start, at.start + 'say'.length);
}
