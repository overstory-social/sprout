// A body's blocks, checked statement by statement, for the kinds of body
// that hold them: a consent guard, a role's `permit`, a role's `do`, and a
// handler or a hook (the spec's Movement and consent › Guards are
// read-only; Verbs › The two passes; Events › Handlers do not refuse;
// Prose; The compiler › What it refuses).
//
// A guard and a `permit` decide: they read, and end in `allow` or
// `refuse`, and a write, a `spawn`, a `destroy`, a `move`, a `connect`,
// an `act` or a `say` in one is refused, since the engine asks it before anything
// happens and it must not change the world underneath the decision it is
// part of. A `do` acts: it writes, spawns, destroys, moves, connects,
// acts and speaks, and `refuse` and `allow` are refused there, since the deciding
// was done. A handler or a hook acts as a `do` does, but nobody is acting,
// so it neither speaks with `say` nor refuses. `if (x.is(K))` narrows
// `x`, and `if (bound tool)` binds `tool`, for the branch each guards.
// Statements after an `allow` or a `refuse` are accepted and never run.

import type {
  Block,
  CallExpr,
  IfStatement,
  RefuseStatement,
  SayStatement,
  Statement,
} from '../syntax/ast.js';
import type { GuardName } from '../syntax/ast.js';
import type { Span } from '../source/source.js';
import { nearestOption } from '../declare/enums.js';
import { branchScope, checkCondition, isEffect, type CheckContext } from './check.js';
import { checkDestroy, checkEffect, checkLet, checkMove, checkSpawn } from './statements.js';
import { checkAct } from './act.js';
import { checkConnect } from './exits.js';
import { checkBroadcast, checkSend } from './sends.js';
import { checkProse } from './prose.js';

/** Which body a block belongs to, which is what decides what it may do. */
export type BodyKind =
  | { readonly body: 'guard'; readonly guard: GuardName }
  | { readonly body: 'permit' }
  | { readonly body: 'do' }
  /** A handler or a hook, by its head as written: `on :stir`, `changed :lit`. */
  | { readonly body: 'handler'; readonly written: string };

/** A block, in a scope of its own, as the body it belongs to allows. */
export function checkBlock(block: Block, outer: CheckContext, kind: BodyKind): void {
  const context: CheckContext = { ...outer, scope: outer.scope.inner() };
  for (const statement of block.statements) checkStatement(statement, context, kind);
}

function checkStatement(statement: Statement, context: CheckContext, kind: BodyKind): void {
  const decides = kind.body === 'guard' || kind.body === 'permit';
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
      else if (kind.body === 'handler') undecided(statement.at, 'refuse', kind.written, context);
      else acts(statement.at, 'refuse', context);
      return;
    case 'allow':
      if (kind.body === 'handler') undecided(statement.at, 'allow', kind.written, context);
      else if (!decides) acts(statement.at, 'allow', context);
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
    case 'move':
      if (decides) readOnly('move', statement.at, context, kind);
      else checkMove(statement, context);
      return;
    case 'connect':
      if (decides) readOnly('connect', statement.at, context, kind);
      else checkConnect(statement, context);
      return;
    case 'act':
      if (decides) readOnly('act', statement.at, context, kind);
      else checkAct(statement, context);
      return;
    case 'send':
      if (decides) readOnly('send', statement.at, context, kind);
      else checkSend(statement, context);
      return;
    case 'broadcast':
      if (decides) readOnly('broadcast', statement.at, context, kind);
      else checkBroadcast(statement, context);
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

/**
 * `refuse full` or `say taken` names a passage of the kind that wrote the
 * body, which is recorded with what is in scope here, for the passage to
 * be checked against; words in quotes are a one-line passage, checked
 * here and now.
 */
function checkPassage(statement: RefuseStatement | SayStatement, context: CheckContext): void {
  const said = statement.said;
  const speech = context.speech;
  if (said.kind === 'prose-literal') {
    if (speech !== undefined) checkProse(said.prose, context, speech.sites);
    else checkProse(said.prose, context, { render: () => {}, option: () => {} });
    return;
  }
  const self = context.self;
  if (self === null) return;
  if (self.passages.has(said.text)) {
    if (speech !== undefined && speech.body !== null) {
      speech.sites.said(speech.body, {
        name: said.text,
        at: said.at,
        scope: context.scope.carried(),
      });
    }
    return;
  }
  if (speech?.absent?.(self, said.text, said.at) === true) return;
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

/** What each statement that changes the world does, as a refusal in a deciding body says it. */
const CHANGES = {
  spawn: '`spawn` makes a new thing',
  destroy: '`destroy self` removes something',
  move: '`move` moves something',
  connect: '`connect` writes where a link leads',
  act: '`act` performs a verb',
  send: '`send` sends a message',
  broadcast: '`broadcast` sends a message',
} as const;

/** `spawn`, `destroy self`, `move`, `connect`, `act`, `send` or `broadcast` where a guard or a `permit` decides. */
function readOnly(
  what: keyof typeof CHANGES,
  at: Span,
  context: CheckContext,
  kind: BodyKind,
): void {
  context.diagnostics.refuse(
    at,
    `${CHANGES[what]}, and ${decider(kind)} only reads and decides.`,
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

/** `say` where nobody is spoken to: a guard, a `permit`, which only decides, or a handler. */
function refuseSay(statement: SayStatement, context: CheckContext, kind: BodyKind): void {
  const at = spanOfWord(statement);
  if (kind.body === 'handler') {
    context.diagnostics.refuse(
      at,
      `\`say\` has nobody to speak to inside \`${kind.written}\`.`,
      'Use `tell` to speak to the room, or `tell p` to one person.',
    );
    return;
  }
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

/** The span of a `say`'s own word, where a refusal of the statement points. */
function spanOfWord(statement: SayStatement): Span {
  const at = statement.at;
  return at.source.span(at.start, at.start + 'say'.length);
}
