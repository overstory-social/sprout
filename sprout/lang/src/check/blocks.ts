// A body's blocks, checked statement by statement, for the kinds of body
// that hold them: a consent guard, a role's `permit`, a role's `do`, a
// handler or a hook, and a `describe` (the spec's Movement and consent ›
// Guards are read-only; Verbs › The two passes; Events › Handlers do not
// refuse; Prose; The compiler › What it refuses).
//
// A guard and a `permit` decide: they read, and end in `allow` or
// `refuse`, and a write, a `spawn`, a `destroy`, a `move`, a `connect`,
// an `act`, a `wake` or words for a reader in one is refused, since the
// engine asks it before anything happens and it must not change the world
// underneath the decision it is part of. A `describe` only reads too, and
// gives its words with `text`; it decides nothing, so `refuse` and
// `allow` are refused there. A `do` acts: it writes, spawns, destroys,
// moves, connects, acts, asks to be woken and speaks, and `refuse` and
// `allow` are refused there, since the deciding was done. A handler or a
// hook acts as a `do` does, but nobody is acting, so it tells rather than
// says, and never refuses. Who each of `say`, `tell` and `text` speaks to
// is `audiences.ts`'s. `if (x.is(K))` narrows `x`, and `if (bound tool)`
// binds `tool`, for the branch each guards. Statements after an `allow`
// or a `refuse` are accepted and never run. Where an extension's statement
// may stand is `extensions.ts`'s.

import type { Block, CallExpr, Expr, IfStatement, Statement } from '../syntax/ast.js';
import type { GuardName } from '../syntax/ast.js';
import type { Span } from '../source/source.js';
import { branchScope, checkCondition, isEffect, type CheckContext } from './check.js';
import { checkDestroy, checkEffect, checkLet, checkMove, checkSpawn } from './statements.js';
import { checkAct } from './act.js';
import { checkConnect } from './exits.js';
import { checkBroadcast, checkSend } from './sends.js';
import type { Undrawn } from './chance.js';
import { checkWake } from './wake.js';
import { checkPassage, checkSpoken } from './audiences.js';
import { checkExtensionStatement } from './extensions.js';

/** Which body a block belongs to, which is what decides what it may do. */
export type BodyKind =
  | { readonly body: 'guard'; readonly guard: GuardName }
  | { readonly body: 'permit' }
  | { readonly body: 'do' }
  | { readonly body: 'describe' }
  /** A handler or a hook, by its head as written: `on :stir`, `changed :lit`. */
  | { readonly body: 'handler'; readonly written: string };

/** A block, in a scope of its own, as the body it belongs to allows. */
export function checkBlock(block: Block, outer: CheckContext, kind: BodyKind): void {
  const undrawn = undrawnBy(kind);
  const context: CheckContext = {
    ...outer,
    scope: outer.scope.inner(),
    ...(undrawn === null ? {} : { undrawn }),
  };
  for (const statement of block.statements) checkStatement(statement, context, kind);
}

/**
 * Why a body that decides or only reads draws nothing (the spec's Chance ›
 * Where chance is forbidden); null for one that acts.
 */
function undrawnBy(kind: BodyKind): Undrawn | null {
  if (kind.body === 'guard') return { by: 'guard', guard: kind.guard };
  if (kind.body === 'describe') return { by: 'describe' };
  return kind.body === 'permit' ? { by: 'permit' } : null;
}

/** A body that only reads, and so changes nothing: one that decides, or a `describe`. */
type Reads = Extract<BodyKind, { body: 'guard' | 'permit' | 'describe' }>;

function checkStatement(statement: Statement, context: CheckContext, kind: BodyKind): void {
  const decides = kind.body === 'guard' || kind.body === 'permit';
  const reads: Reads | null =
    kind.body === 'guard' || kind.body === 'permit' || kind.body === 'describe' ? kind : null;
  switch (statement.kind) {
    case 'let':
      if (statement.value.kind === 'spawn' && reads !== null)
        readOnly('spawn', statement.value.at, context, reads);
      else checkLet(statement, context);
      return;
    case 'if':
      checkIf(statement, context, kind);
      return;
    case 'refuse':
      if (decides) checkPassage(statement, context);
      else if (kind.body === 'handler') undecided(statement.at, 'refuse', kind.written, context);
      else if (kind.body === 'describe') undescribed(statement.at, 'refuse', context);
      else acts(statement.at, 'refuse', context);
      return;
    case 'allow':
      if (kind.body === 'handler') undecided(statement.at, 'allow', kind.written, context);
      else if (kind.body === 'describe') undescribed(statement.at, 'allow', context);
      else if (!decides) acts(statement.at, 'allow', context);
      return;
    case 'say':
    case 'tell':
    case 'text':
      checkSpoken(statement, context, kind);
      return;
    case 'spawn':
      if (reads !== null) readOnly('spawn', statement.at, context, reads);
      else checkSpawn(statement, context);
      return;
    case 'destroy':
      if (reads !== null) readOnly('destroy', statement.at, context, reads);
      else checkDestroy(statement, context);
      return;
    case 'move':
      if (reads !== null) readOnly('move', statement.at, context, reads);
      else checkMove(statement, context);
      return;
    case 'connect':
      if (reads !== null) readOnly('connect', statement.at, context, reads);
      else checkConnect(statement, context);
      return;
    case 'act':
      if (reads !== null) readOnly('act', statement.at, context, reads);
      else checkAct(statement, context);
      return;
    case 'send':
      if (reads !== null) readOnly('send', statement.at, context, reads);
      else checkSend(statement, context);
      return;
    case 'broadcast':
      if (reads !== null) readOnly('broadcast', statement.at, context, reads);
      else checkBroadcast(statement, context);
      return;
    case 'wake':
      if (reads !== null) readOnly('wake', statement.at, context, reads);
      else checkWake(statement, context);
      return;
    case 'expression-statement':
      if (unnamedExtension(statement.expression, context)) return;
      if (reads !== null && isEffect(statement.expression)) {
        refuseWrite(statement.expression, context, reads);
      } else checkEffect(statement.expression, context);
      return;
    case 'extension-statement':
      checkExtensionStatement(statement, context, kind);
      return;
  }
}

/**
 * `media.show(…)` in a file that does not name `media` at its top, which
 * reads as a call on a name nothing binds: refused as what it is meant
 * for, where the world pins `media`. Says whether it refused.
 */
function unnamedExtension(expr: Expr, context: CheckContext): boolean {
  if (expr.kind !== 'call' || expr.receiver.kind !== 'binding') return false;
  const name = expr.receiver.name;
  const pinned = context.extensions?.pinned.get(name.text);
  if (pinned === undefined || context.scope.lookup(name.text) !== null) return false;
  context.diagnostics.refuse(
    name.at,
    `\`${name.text}.${expr.method.text}\` is a statement of the extension \`${name.text}\`, which this file does not name.`,
    `Write \`extension ${name.text} ${pinned.major}\` at the top of the file.`,
  );
  return true;
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

/** What a remedy tells an author to do with what a body that only reads may not do. */
function readOnlyRemedy(kind: Reads): string {
  switch (kind.body) {
    case 'guard':
      return 'Move it to a handler or a `do`; a guard ends in `allow` or `refuse`.';
    case 'permit':
      return 'Move it to `do`; a `permit` ends in `allow` or `refuse`.';
    case 'describe':
      return 'Move it to a `do` or a handler; a `describe` reads what is there and gives its words with `text`.';
  }
}

/** A body that only reads, as a refusal names it. */
function decider(kind: Reads): string {
  return kind.body === 'guard' ? 'a guard' : kind.body === 'permit' ? 'a `permit`' : 'a `describe`';
}

/** What each statement that changes the world does, as a refusal in a deciding body says it. */
const CHANGES = {
  spawn: '`spawn` makes a new thing',
  destroy: '`destroy self` removes something',
  move: '`move` moves something',
  connect: '`connect` writes where a link leads',
  act: '`act` performs a verb',
  send: '`send` sends a message',
  broadcast: '`broadcast` sends a message',
  wake: '`wake` asks for a wake',
} as const;

/** `spawn`, `destroy self`, `move`, `connect`, `act`, `send`, `broadcast` or `wake` where a body only reads. */
function readOnly(what: keyof typeof CHANGES, at: Span, context: CheckContext, kind: Reads): void {
  context.diagnostics.refuse(
    at,
    `${CHANGES[what]}, and ${decider(kind)} only reads${kind.body === 'describe' ? '' : ' and decides'}.`,
    readOnlyRemedy(kind),
  );
}

/** `self.set(…)` and the rest: a write, which a guard, a `permit` or a `describe` may not make. */
function refuseWrite(call: CallExpr, context: CheckContext, kind: Reads): void {
  const receiver = call.receiver.kind === 'binding' ? `${call.receiver.name.text}.` : '';
  context.diagnostics.refuse(
    call.at,
    `\`${receiver}${call.method.text}\` writes, and ${decider(kind)} only reads${kind.body === 'describe' ? '' : ' and decides'}.`,
    readOnlyRemedy(kind),
  );
}

/**
 * `refuse` or `allow` in a handler or a hook, which decides by writing or
 * not writing: a queued message has no one to answer (the spec's Handlers
 * do not refuse).
 */
function undecided(
  at: Span,
  word: 'refuse' | 'allow',
  written: string,
  context: CheckContext,
): void {
  context.diagnostics.refuse(
    at,
    `\`${word}\` answers someone, and nobody waits on \`${written}\` for an answer.`,
    word === 'refuse'
      ? 'Decide with `if` by writing or not writing. Where the sender should know, send it a message, as in `send from :unlock_failed`.'
      : 'Take it out: a handler decides by what it writes.',
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

/** `refuse` or `allow` in a `describe`, which decides nothing: it says what is there. */
function undescribed(at: Span, word: 'refuse' | 'allow', context: CheckContext): void {
  context.diagnostics.refuse(
    at,
    `\`${word}\` decides, and a \`describe\` only says what is there.`,
    word === 'refuse'
      ? 'Move it to a `permit` or a guard, which decide; here, give the words with `text`.'
      : 'Take it out: a `describe` gives its words with `text`.',
  );
}
