// Who a statement's words are for, and where each may stand (the spec's
// Prose; Other people › Who hears it; The compiler › What it refuses).
// `say` speaks to the actor, so it stands only in a role's `do`; `tell`
// speaks to the teller's place or to one actor it names, so it stands in
// a `do`, a handler and a hook, a tick's and a wake's among them; `text`
// gives a `describe` its words and stands nowhere else. A guard and a
// `permit` only decide, so none of the three stands in either.
//
// `tell <x>` names a binding: `self`, a role, a handler's parameter, a
// `let`. An object of the world is never a person, so telling one by its
// identifier would never be read, and is refused. What the statement says
// is checked as `refuse`'s words are: words in quotes in place, a passage
// by name recorded with what is in scope for `passages.ts`.

import type { ObjectPath, RefuseStatement } from '../syntax/ast.js';
import type { SayStatement, TellStatement, TextStatement } from '../syntax/ast-speech.js';
import { writtenPath } from '../syntax/ast.js';
import type { Span } from '../source/source.js';
import { nearestOption } from '../declare/enums.js';
import { showBindingType } from './bindings.js';
import type { CheckContext } from './check.js';
import { checkProse } from './prose.js';
import { pathType } from './statements.js';
import type { BodyKind } from './blocks.js';

/** A statement that puts words in front of a reader. */
export type Spoken = SayStatement | TellStatement | TextStatement;

/** What a remedy offers in quotes for each statement that says something. */
const QUOTED = {
  refuse: '"No room here."',
  say: '"The bolt slides back."',
  tell: '"{actor} pulls the lever."',
  text: '"A lever, waist high."',
} as const;

/** `say`, `tell` or `text`, as the body it stands in allows. */
export function checkSpoken(statement: Spoken, context: CheckContext, kind: BodyKind): void {
  switch (statement.kind) {
    case 'say':
      if (kind.body === 'do') checkPassage(statement, context);
      else refuseSay(statement, context, kind);
      return;
    case 'tell':
      if (kind.body === 'do' || kind.body === 'handler') {
        if (statement.to !== null) checkTold(statement.to, context);
        checkPassage(statement, context);
      } else refuseTell(statement, context, kind);
      return;
    case 'text':
      refuseText(statement, context, kind);
      return;
  }
}

/**
 * `refuse full`, `say taken` or `tell pulled` names a passage of the kind
 * that wrote the body, which is recorded with what is in scope here, for
 * the passage to be checked against; words in quotes are a one-line
 * passage, checked here and now.
 */
export function checkPassage(
  statement: RefuseStatement | SayStatement | TellStatement,
  context: CheckContext,
): void {
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
        undrawn: context.undrawn ?? null,
      });
    }
    return;
  }
  if (speech?.absent?.(self, said.text, said.at) === true) return;
  const lead =
    statement.kind === 'tell' && statement.to !== null
      ? `tell ${writtenPath(statement.to)}`
      : statement.kind;
  const meant = nearestOption(said.text, [...self.passages.keys()]);
  context.diagnostics.refuse(
    said.at,
    `\`${self.name}\` has no passage \`${said.text}\`.${meant === null ? '' : ` Did you mean \`${meant}\`?`}`,
    meant === null
      ? `Write \`passage ${said.text} { … }\` in \`${self.name}\`, or give the words in quotes, as in \`${lead} ${QUOTED[statement.kind]}\`.`
      : `Write \`${lead} ${meant}\`, or write \`passage ${said.text} { … }\` in \`${self.name}\`.`,
  );
}

/**
 * Who `tell <x>` names: one binding that is an object. A set, a value, or
 * an object of the world named by its identifier is refused.
 */
function checkTold(to: ObjectPath, context: CheckContext): void {
  const written = writtenPath(to);
  const [only, ...rest] = to.parts;
  const bound =
    only !== undefined &&
    rest.length === 0 &&
    (context.scope.lookup(only.text) !== null || context.scope.withheld(only.text) !== null);
  const type = pathType(to, context);
  if (type === null) return;
  if (!bound) {
    context.diagnostics.refuse(
      to.at,
      `\`${written}\` is an object of the world, which is never a person, so nobody would read what it is told.`,
      'Tell someone a body has bound, as `self` in a role a person plays or `item` in `on :entered (item, from)`, or tell the place, as in `tell "{actor} pulls the lever."`.',
    );
    return;
  }
  if (type.binds === 'object') return;
  context.diagnostics.refuse(
    to.at,
    type.binds === 'set'
      ? `\`${written}\` holds several things, and \`tell ${written}\` speaks to one person.`
      : `\`tell\` speaks to one person, and \`${written}\` is ${showBindingType(type)}.`,
    'Tell one person a body has bound, as in `tell actor "…"`, or tell the place, as in `tell "{actor} pulls the lever."`.',
  );
}

/** `say` where nobody is spoken to: a guard, a `permit`, which only decides, or a handler. */
function refuseSay(statement: SayStatement, context: CheckContext, kind: BodyKind): void {
  const at = wordOf(statement);
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

/** `tell` in a guard or a `permit`, which only decide. */
function refuseTell(statement: TellStatement, context: CheckContext, kind: BodyKind): void {
  const guard = kind.body === 'guard';
  context.diagnostics.refuse(
    wordOf(statement),
    guard
      ? `\`tell\` speaks, and \`${kind.guard}\` only reads and decides.`
      : '`tell` speaks, and a `permit` only decides.',
    guard
      ? 'Move it to a handler or a `do`; a guard ends in `allow` or `refuse`.'
      : 'Move it to `do`; a `permit` ends in `allow` or `refuse`.',
  );
}

/** `text` anywhere but a `describe`, whose words it gives. */
function refuseText(statement: TextStatement, context: CheckContext, kind: BodyKind): void {
  const where =
    kind.body === 'do'
      ? 'this is a `do`'
      : kind.body === 'handler'
        ? `this is \`${kind.written}\``
        : kind.body === 'guard'
          ? `this is \`${kind.guard}\``
          : 'this is a `permit`';
  context.diagnostics.refuse(
    wordOf(statement),
    `\`text\` gives a \`describe\` its words, and ${where}.`,
    kind.body === 'do'
      ? 'Use `say` to speak to the actor, or `tell` to speak to the room.'
      : kind.body === 'handler'
        ? 'Use `tell` to speak to the room, or `tell p` to one person.'
        : 'Take it out; the words a refusal gives go after `refuse`, as in `refuse "No room here."`.',
  );
}

/** The span of a statement's own first word, where a refusal of where it stands points. */
function wordOf(statement: Spoken): Span {
  const at = statement.at;
  return at.source.span(at.start, at.start + statement.kind.length);
}
