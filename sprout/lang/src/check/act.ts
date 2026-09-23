// What the compiler checks of an `act` (the spec's Verbs › Acting,
// Optional tools, Set roles, Value roles; The compiler › What it refuses).
//
// `act` stands only in a body whose own kind composes `sprout.Actor`,
// since `self` becomes the reading's actor and every actor may act. The
// verb is reached as a play reaches one, the body's own library first and
// then the standard library's. Each role named must be one the verb
// declares, named once, and filled by a binding its filler takes; every
// role that is neither optional nor a set must be named. Where a body
// may stand is `blocks.ts`'s, which refuses `act` in a guard or a `permit`.

import type { ActRole, ActStatement } from '../syntax/ast.js';
import { writtenPath } from '../syntax/ast.js';
import { readable } from '../source/words.js';
import { ACTOR, isActor } from '../declare/actors.js';
import { nearestOption, shownName, SPROUT } from '../declare/enums.js';
import { composesKind, kindName, type KindRef } from '../declare/kinds.js';
import type { ResolvedRole, ResolvedVerb } from '../declare/verbs.js';
import { showType } from '../declare/types.js';
import type { BindingType } from './bindings.js';
import type { CheckContext } from './check.js';
import { nameOf, pathType } from './statements.js';

/**
 * `act nuzzle (target: p)` — refused where `self` may not act, where the
 * verb is unknown, and for each role named wrong, filled wrong or left
 * out. Everything is checked, so an author owed several problems is told
 * them all. True where nothing was refused.
 */
export function checkAct(statement: ActStatement, context: CheckContext): boolean {
  const acting = context.acting;
  if (acting === undefined) {
    throw new Error('an `act` was checked with no verbs to reach; a `do` is checked with them.');
  }
  let passed = mayAct(statement, context);
  const verb = acting.verbs.unqualified(statement.verb.text, context.from);
  if (verb === null) {
    unknownVerb(statement, context);
    for (const role of statement.roles) pathType(role.filler, context);
    return false;
  }
  const named = new Set<string>();
  for (const role of statement.roles) {
    const declared = verb.roles.find((one) => one.name === role.role.text);
    if (declared === undefined) {
      unknownRole(role, verb, context);
      pathType(role.filler, context);
      passed = false;
      continue;
    }
    if (named.has(declared.name)) {
      context.diagnostics.refuse(
        role.role.at,
        `\`${declared.name}\` is named twice in \`act ${verb.name} (…)\`.`,
        'Name each role once.',
      );
      passed = false;
      continue;
    }
    named.add(declared.name);
    if (!fills(role, declared, verb, context)) passed = false;
  }
  for (const role of verb.roles) {
    if (named.has(role.name) || role.optional || role.many) continue;
    leftOut(statement, role, verb, context);
    passed = false;
  }
  return passed;
}

/** Whether `self` may be the actor: its kind composes `sprout.Actor`. */
function mayAct(statement: ActStatement, context: CheckContext): boolean {
  const { self } = context;
  if (self === null || isActor(self)) return true;
  const at = statement.at.source.span(statement.at.start, statement.at.start + 'act'.length);
  context.diagnostics.refuse(
    at,
    `Only an actor acts, and \`${self.name}\` does not compose \`${ACTOR}\`.`,
    `Compose \`${ACTOR}\` into \`${self.name}\`, or write the \`act\` in a kind that composes it, as an NPC's kind does.`,
  );
  return false;
}

/** A verb nothing in reach declares, said with the one most likely meant. */
function unknownVerb(statement: ActStatement, context: CheckContext): void {
  const written = statement.verb.text;
  const reachable = context
    .acting!.verbs.all()
    .filter((verb) => verb.library === context.from || verb.library === SPROUT)
    .map((verb) => verb.name);
  const meant = nearestOption(written, reachable);
  context.diagnostics.refuse(
    statement.verb.at,
    `Nothing declares a verb \`${written}\`.${meant === null ? '' : ` Did you mean \`${meant}\`?`}`,
    meant === null
      ? `Declare it with \`verb ${written} { … }\`, or check the spelling of a verb this world or the standard library declares.`
      : `Write \`act ${meant} (…)\`, or declare \`verb ${written} { … }\`.`,
  );
}

/** A role the verb does not declare. */
function unknownRole(role: ActRole, verb: ResolvedVerb, context: CheckContext): void {
  const names = verb.roles.map((one) => one.name);
  if (names.length === 0) {
    context.diagnostics.refuse(
      role.role.at,
      `\`${verb.name}\` has no roles, so only the actor takes part.`,
      `Write \`act ${verb.name} ()\`.`,
    );
    return;
  }
  const meant = nearestOption(role.role.text, names);
  context.diagnostics.refuse(
    role.role.at,
    `\`${verb.name}\` has no role \`${role.role.text}\`. Its ${names.length === 1 ? 'role is' : 'roles are'} ${readable(names)}.`,
    `Name one of them, as in \`act ${verb.name} (${meant ?? names[0]}: ${writtenPath(role.filler)})\`.`,
  );
}

/** Whether what fills a named role is a binding its filler takes, said where it is not. */
function fills(
  role: ActRole,
  declared: ResolvedRole,
  verb: ResolvedVerb,
  context: CheckContext,
): boolean {
  const name = nameOf(role.filler);
  const type = pathType(role.filler, context);
  if (type === null) return false;
  const wanted = wants(declared, context);
  const takes = (() => {
    const filler = declared.filler ?? { fills: 'open' as const };
    switch (filler.fills) {
      case 'exit':
        return false;
      case 'symbol':
        return type.binds === 'value' && type.type.type === 'symbol';
      case 'integer':
        return type.binds === 'value' && type.type.type === 'integer';
      case 'open':
        return type.binds === 'object' || (declared.many && type.binds === 'set');
      case 'kind':
        return (
          (type.binds === 'object' || (declared.many && type.binds === 'set')) &&
          type.kind !== null &&
          composesKind(type.kind, filler.kind)
        );
    }
  })();
  if (takes) return true;
  context.diagnostics.refuse(
    role.filler.at,
    `\`${declared.name}\` of \`${verb.name}\` is filled by ${wanted}, and \`${name.text}\` is ${shown(type, context)}.`,
    remedy(role, declared, verb, type, context),
  );
  return false;
}

/** What a role takes, as a refusal says it. */
function wants(role: ResolvedRole, context: CheckContext): string {
  const filler = role.filler ?? { fills: 'open' as const };
  const one = (() => {
    switch (filler.fills) {
      case 'exit':
        return 'an exit';
      case 'symbol':
        return 'an option the visitor names';
      case 'integer':
        return 'a number the visitor names';
      case 'open':
        return 'a thing in the world';
      case 'kind':
        return `a \`${shownName(kindName(filler.kind), context.from)}\``;
    }
  })();
  return role.many ? `${one}, or a set of them` : one;
}

/** A binding's type, as a refusal says it. */
function shown(type: BindingType, context: CheckContext): string {
  const kind = (of: KindRef | null): string =>
    of === null ? '' : ` \`${shownName(kindName(of), context.from)}\``;
  switch (type.binds) {
    case 'value':
      return showType(type.type);
    case 'object':
      return type.kind === null ? 'an object of no known kind' : `a${kind(type.kind)}`;
    case 'set':
      return type.kind === null ? 'a set of objects' : `a set of${kind(type.kind)}`;
  }
}

/** What to write instead of a filler the role does not take. */
function remedy(
  role: ActRole,
  declared: ResolvedRole,
  verb: ResolvedVerb,
  type: BindingType,
  context: CheckContext,
): string {
  const filler = declared.filler ?? { fills: 'open' as const };
  const written = writtenPath(role.filler);
  const example = `act ${verb.name} (${declared.name}: ${written})`;
  switch (filler.fills) {
    case 'exit':
      return 'An exit is named only by the direction a visitor types.';
    case 'symbol':
      return 'Name a binding that holds an option, as a value role bound inside `if (bound …)` does.';
    case 'integer':
      return 'Name a binding that holds a number, as a `let` or a value role bound inside `if (bound …)` does.';
    case 'open':
      return type.binds === 'set'
        ? `Name one thing: only a role marked \`many\` takes a set.`
        : `Name a thing in the world, as in \`act ${verb.name} (${declared.name}: self)\`.`;
    case 'kind': {
      const kind = shownName(kindName(filler.kind), context.from);
      if (type.binds === 'value') return `Name a \`${kind}\`, as in \`${example}\`.`;
      if (type.binds === 'set' && !declared.many) {
        return 'Name one thing: only a role marked `many` takes a set.';
      }
      return `Read it as one first: \`if (${written}.is(${kind})) { ${example} }\`.`;
    }
  }
}

/** A role left out that every reading of the verb fills. */
function leftOut(
  statement: ActStatement,
  role: ResolvedRole,
  verb: ResolvedVerb,
  context: CheckContext,
): void {
  const target = verb.roles[0] === role;
  const why = target
    ? 'the role it is done to, which every reading fills'
    : verb.phrases.length === 0
      ? `which is not optional: \`${verb.name}\` does not mark it \`optional\``
      : `which is not optional: every phrase of \`${verb.name}\` fills it`;
  // The example keeps the roles written right, and leaves out any the verb lacks.
  const named = statement.roles
    .filter((one) => verb.roles.some((declared) => declared.name === one.role.text))
    .map((one) => `${one.role.text}: ${writtenPath(one.filler)}`);
  const example = [...named, `${role.name}: <what fills it>`].join(', ');
  context.diagnostics.refuse(
    statement.verb.at,
    `\`act ${verb.name}\` leaves out \`${role.name}\`, ${why}.`,
    `Name it: \`act ${verb.name} (${example})\`.`,
  );
}
