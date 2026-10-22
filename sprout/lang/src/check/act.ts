// What the compiler checks of an `act` (the spec's Verbs › Acting,
// Optional tools, Set roles, Value roles; The compiler › What it refuses).
//
// `act` stands only in a body whose own kind composes `sprout.Actor`,
// since `self` becomes the reading's actor and every actor may act. The
// verb is reached as a play reaches one, the body's own library first and
// then the standard library's. Each role named must be one the verb
// declares, named once, and filled by what its filler takes: a role a
// thing fills by a name, and a value role by a value of its type, whose
// bare option is checked against the enums the role-players' `from`s
// hear; every role that is neither optional nor a set must be named.
// Where a body may stand is `blocks.ts`'s, which refuses `act` in a guard
// or a `permit`.

import type { ActRole, ActStatement, ActValue } from '../syntax/ast.js';
import { writtenPath } from '../syntax/ast.js';
import { readable } from '../source/words.js';
import { textOf } from '../source/source.js';
import { ACTOR, isActor } from '../declare/actors.js';
import { checkOption, nearestOption, qualifiedName, shownName, SPROUT } from '../declare/enums.js';
import { composesKind, kindName, type KindRef } from '../declare/kinds.js';
import type { ResolvedRole, ResolvedVerb } from '../declare/verbs.js';
import { describeLiteral, showType } from '../declare/types.js';
import type { BindingType } from './bindings.js';
import { typeOf, type ActSetting, type CheckContext } from './check.js';
import { describeKind } from './check/values.js';
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
    for (const role of statement.roles) typeFiller(role, context);
    return false;
  }
  const named = new Set<string>();
  for (const role of statement.roles) {
    const declared = verb.roles.find((one) => one.name === role.role.text);
    if (declared === undefined) {
      unknownRole(role, verb, context);
      typeFiller(role, context);
      passed = false;
      continue;
    }
    if (named.has(declared.name)) {
      context.diagnostics.refuse(
        role.role.at,
        `\`${declared.name}\` is named twice in \`act ${verb.name} (…)\`.`,
        `Take this \`${declared.name}: …\` out, and give the role one thing to fill it.`,
      );
      passed = false;
      continue;
    }
    named.add(declared.name);
    const filled =
      role.kind === 'act-role'
        ? fills(role, declared, verb, context)
        : fillsWithValue(role, declared, verb, acting, context);
    if (!filled) passed = false;
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
function unknownRole(role: ActRole | ActValue, verb: ResolvedVerb, context: CheckContext): void {
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
    `Name one of them, as in \`act ${verb.name} (${meant ?? names[0]}: ${writtenFiller(role)})\`.`,
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
        return 'an option';
      case 'integer':
        return 'a whole number';
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
    case 'readings':
      throw new Error('`act` fills a role with `readings`, which a passage cannot name.');
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
    case 'integer':
      return valueRemedy(filler.fills, declared, verb, context);
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
    .map((one) => `${one.role.text}: ${writtenFiller(one)}`);
  const example = [...named, `${role.name}: <what fills it>`].join(', ');
  context.diagnostics.refuse(
    statement.verb.at,
    `\`act ${verb.name}\` leaves out \`${role.name}\`, ${why}.`,
    `Name it: \`act ${verb.name} (${example})\`.`,
  );
}

/** A filler as written, for a remedy that shows it again. */
function writtenFiller(role: ActRole | ActValue): string {
  return role.kind === 'act-role' ? writtenPath(role.filler) : textOf(role.value.at);
}

/** Type a filler whose role is not known, so what it names is still checked and recorded. */
function typeFiller(role: ActRole | ActValue, context: CheckContext): void {
  if (role.kind === 'act-role') pathType(role.filler, context);
  else if (role.value.kind !== 'symbol-expr') typeOf(role.value, context);
}

/**
 * Whether a value given to a named role is one it takes, said where it is
 * not: a value role takes a value of its type, and a bare option one of the
 * enums its role-players' `from`s hear, or any where none does, since the
 * role is then never bound and the compiler warns of that instead.
 */
function fillsWithValue(
  role: ActValue,
  declared: ResolvedRole,
  verb: ResolvedVerb,
  acting: ActSetting,
  context: CheckContext,
): boolean {
  const { value } = role;
  const filler = declared.filler ?? { fills: 'open' as const };
  if (value.kind === 'symbol-expr') {
    if (filler.fills === 'symbol') return heardOption(role, declared, verb, acting, context);
    refuseValue(role, declared, verb, `\`:${value.name.text}\` is an option`, context);
    return false;
  }
  const type = typeOf(value, context);
  if (type === null) return false;
  if (filler.fills === 'symbol' && type.binds === 'value' && type.type.type === 'symbol')
    return true;
  if (filler.fills === 'integer' && type.binds === 'value' && type.type.type === 'integer')
    return true;
  const given =
    value.kind === 'integer' || value.kind === 'string' || value.kind === 'boolean'
      ? describeLiteral(value)
      : `\`${textOf(value.at)}\` is ${describeKind(type)}`;
  refuseValue(role, declared, verb, given, context);
  return false;
}

/** Whether a bare option is one some role-player of the role hears, said where none does. */
function heardOption(
  role: ActValue,
  declared: ResolvedRole,
  verb: ResolvedVerb,
  acting: ActSetting,
  context: CheckContext,
): boolean {
  if (role.value.kind !== 'symbol-expr') return true;
  const option = role.value.name;
  const enums = acting.heard(verb, declared.name);
  if (enums.length === 0 || enums.some((one) => one.options.includes(option.text))) return true;
  if (enums.length === 1)
    return checkOption(enums[0]!, option.text, role.value.at, context.diagnostics);
  const options = [...new Set(enums.flatMap((one) => one.options))];
  const meant = nearestOption(option.text, options);
  const named = enums.map((one) => shownName(qualifiedName(one.library, one.name), context.from));
  context.diagnostics.refuse(
    role.value.at,
    `\`${declared.name}\` of \`${verb.name}\` is heard as an option of ${readable(named)}, and \`:${option.text}\` is not one of theirs.${meant === null ? '' : ` Did you mean \`:${meant}\`?`}`,
    `Options: ${options.join(', ')}.`,
  );
  return false;
}

/** A value given to a role that does not take it; `given` says what it is. */
function refuseValue(
  role: ActValue,
  declared: ResolvedRole,
  verb: ResolvedVerb,
  given: string,
  context: CheckContext,
): void {
  const filler = declared.filler ?? { fills: 'open' as const };
  const remedy = (() => {
    switch (filler.fills) {
      case 'exit':
        return 'An exit is named only by the direction a visitor types.';
      case 'symbol':
      case 'integer':
        return valueRemedy(filler.fills, declared, verb, context);
      case 'open':
        return `Name a thing in the world, as in \`act ${verb.name} (${declared.name}: self)\`.`;
      case 'kind': {
        const kind = shownName(kindName(filler.kind), context.from);
        return `Name a \`${kind}\`, by a binding or a role that holds one.`;
      }
    }
  })();
  context.diagnostics.refuse(
    role.value.at,
    `\`${declared.name}\` of \`${verb.name}\` is filled by ${wants(declared, context)}, and ${given}.`,
    remedy,
  );
}

/**
 * What to give a value role instead, written out: an option shown is one
 * a role-player's `from` hears for the role, where any does.
 */
function valueRemedy(
  fills: 'symbol' | 'integer',
  declared: ResolvedRole,
  verb: ResolvedVerb,
  context: CheckContext,
): string {
  if (fills === 'integer') {
    return `Give it a whole number, as in \`act ${verb.name} (${declared.name}: 3)\`, or a binding that holds one.`;
  }
  const heard = context.acting?.heard(verb, declared.name)[0]?.options[0];
  return heard === undefined
    ? 'Give it an option, or a binding that holds one; a role-player says which options it hears with `from`.'
    : `Give it an option, as in \`act ${verb.name} (${declared.name}: :${heard})\`, or a binding that holds one.`;
}
