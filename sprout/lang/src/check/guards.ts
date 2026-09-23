// A consent guard's body, checked (the spec's Movement and consent › The
// three roles, Guards are read-only; The compiler › What it refuses).
//
// In a guard `self` is the kind that wrote it, and `mover` and the
// parameters are objects, read only through `is()`. A guard reads and
// decides: a write, a `spawn` or a `destroy` in one is refused, since the
// engine asks it inline, in the middle of a move, and it must not change
// the world underneath the decision it is part of. A `refuse` names a
// passage of the kind that wrote it, or says its words in quotes.
// Statements after an `allow` or a `refuse` are accepted and never run.

import type {
  Block,
  CallExpr,
  GuardDeclaration,
  IfStatement,
  RefuseStatement,
  Statement,
} from '../syntax/ast.js';
import type { Diagnostics } from '../source/diagnostics.js';
import type { Span } from '../source/source.js';
import type { KindLookup, KindRef } from '../declare/kinds.js';
import { nearestOption } from '../declare/enums.js';
import { guardParameterBinding, moverBinding, Scope, selfBinding } from './bindings.js';
import { checkCondition, isEffect, narrowingOf, type CheckContext } from './check.js';
import { checkEffect, checkLet } from './statements.js';

/** Where a guard is read: the kinds in scope and somewhere to say what is wrong. */
export interface GuardSetting {
  readonly kinds: KindLookup;
  readonly diagnostics: Diagnostics;
}

/** What a remedy tells an author to do with what a guard may not do. */
const READ_ONLY = 'Move it to a handler or a `do`; a guard ends in `allow` or `refuse`.';

/**
 * Check one guard `self` wrote: its scope is `self`, `mover` and its
 * parameters. Returns whether nothing in it was refused.
 */
export function checkGuard(guard: GuardDeclaration, self: KindRef, setting: GuardSetting): boolean {
  const { diagnostics } = setting;
  const before = diagnostics.refusals.length;
  const scope = Scope.root();
  scope.introduce(selfBinding(self, guard.at), diagnostics);
  scope.introduce(moverBinding(guard.at), diagnostics);
  for (const parameter of guard.parameters) {
    scope.introduce(guardParameterBinding(parameter.text, parameter.at), diagnostics);
  }
  const context: CheckContext = {
    scope,
    kinds: setting.kinds,
    from: self.library,
    self,
    diagnostics,
  };
  checkBlock(guard.body, context);
  return diagnostics.refusals.length === before;
}

/** A block, in a scope of its own. */
function checkBlock(block: Block, outer: CheckContext): void {
  const context: CheckContext = { ...outer, scope: outer.scope.inner() };
  for (const statement of block.statements) checkStatement(statement, context);
}

function checkStatement(statement: Statement, context: CheckContext): void {
  switch (statement.kind) {
    case 'let':
      if (statement.value.kind === 'spawn') refuseSpawn(statement.value.at, context);
      else checkLet(statement, context);
      return;
    case 'if':
      checkIf(statement, context);
      return;
    case 'refuse':
      checkRefuse(statement, context);
      return;
    case 'allow':
      return;
    case 'spawn':
      refuseSpawn(statement.at, context);
      return;
    case 'destroy':
      context.diagnostics.refuse(
        statement.at,
        '`destroy self` removes something, and a guard only reads and decides.',
        READ_ONLY,
      );
      return;
    case 'expression-statement':
      if (isEffect(statement.expression)) refuseWrite(statement.expression, context);
      else checkEffect(statement.expression, context);
      return;
  }
}

/**
 * `if`, and each `else if` after it, walked as the chain it is. A
 * condition `x.is(K)` narrows `x` to `K` in the branch it guards.
 */
function checkIf(statement: IfStatement, context: CheckContext): void {
  for (let link: IfStatement = statement; ;) {
    const narrowing = checkCondition(link.condition, context)
      ? narrowingOf(link.condition, context)
      : null;
    const scope =
      narrowing === null
        ? context.scope
        : context.scope.narrowing(narrowing.binding, narrowing.kind);
    checkBlock(link.then, { ...context, scope });
    const otherwise = link.otherwise;
    if (otherwise === null) return;
    if (otherwise.kind === 'block') {
      checkBlock(otherwise, context);
      return;
    }
    link = otherwise;
  }
}

/** `refuse full` names a passage of the kind that wrote the guard; words in quotes need nothing. */
function checkRefuse(statement: RefuseStatement, context: CheckContext): void {
  const said = statement.said;
  const self = context.self;
  if (said.kind === 'string' || self === null || self.passages.has(said.text)) return;
  const meant = nearestOption(said.text, [...self.passages.keys()]);
  context.diagnostics.refuse(
    said.at,
    `\`${self.name}\` has no passage \`${said.text}\`.${meant === null ? '' : ` Did you mean \`${meant}\`?`}`,
    meant === null
      ? `Write \`passage ${said.text} { … }\` in \`${self.name}\`, or give the words in quotes, as in \`refuse "No room here."\`.`
      : `Write \`refuse ${meant}\`, or write \`passage ${said.text} { … }\` in \`${self.name}\`.`,
  );
}

function refuseSpawn(at: Span, context: CheckContext): void {
  context.diagnostics.refuse(
    at,
    '`spawn` makes a new thing, and a guard only reads and decides.',
    READ_ONLY,
  );
}

/** `self.set(…)` and the rest: a write, which a guard may not make. */
function refuseWrite(call: CallExpr, context: CheckContext): void {
  const receiver = call.receiver.kind === 'binding' ? `${call.receiver.name.text}.` : '';
  context.diagnostics.refuse(
    call.at,
    `\`${receiver}${call.method.text}\` writes, and a guard only reads and decides.`,
    READ_ONLY,
  );
}
