// What the compiler checks of an extension's statement (the spec's
// Extensions › What an extension may add; The compiler › What it
// refuses). It names a statement its extension declares, gives each
// argument the type the extension declares for it, and passes the
// extension's own check over the ones written as literals. None may stand
// in a guard or a `permit`, and only one its extension allows may stand
// in a `describe`. Where the extension is absent nothing of it can be
// asked, so only the arguments are typed.

import type { ExtensionStatement } from '../syntax/ast-extensions.js';
import type { Expr } from '../syntax/ast.js';
import {
  extensionStatement,
  readLiteral,
  type Plain,
  type ExtensionStatementDefinition as Declared,
} from '../declare/extensions.js';
import { parameterType, sameType, showType, type ValueType } from '../declare/types.js';
import { showBindingType } from './bindings.js';
import { readable } from '../source/words.js';
import type { BodyKind } from './blocks.js';
import { typeOf, type CheckContext } from './check.js';

/** Check `statement` where `kind` of body holds it. Returns whether nothing in it was refused. */
export function checkExtensionStatement(
  statement: ExtensionStatement,
  context: CheckContext,
  kind: BodyKind,
): boolean {
  const written = `${statement.extension.text}.${statement.name.text}`;
  if (kind.body === 'guard' || kind.body === 'permit') {
    context.diagnostics.refuse(
      statement.at,
      `\`${written}\` records an effect, and ${kind.body === 'guard' ? 'a guard' : 'a `permit`'} only reads and decides.`,
      kind.body === 'guard'
        ? 'Move it to a handler or a `do`; a guard ends in `allow` or `refuse`.'
        : 'Move it to `do`; a `permit` ends in `allow` or `refuse`.',
    );
    return false;
  }
  // A file names only what the manifest pins, and one it does not was refused at its top.
  const pinned = context.extensions?.pinned.get(statement.extension.text);
  if (pinned === undefined) return false;
  if (pinned.installed === null) {
    return statement.arguments.every((argument) => typeOf(argument, context) !== null);
  }
  const declared = extensionStatement(pinned, statement.name.text);
  if (declared === null) {
    const names = pinned.installed.statements.map((one) => `${pinned.name}.${one.name}`);
    context.diagnostics.refuse(
      statement.name.at,
      `The extension \`${pinned.name}\` has no statement \`${statement.name.text}\`.`,
      names.length === 0
        ? `\`${pinned.name}\` adds no statements.`
        : `Its statements: ${readable(names)}.`,
    );
    return false;
  }
  if (kind.body === 'describe' && !declared.describe) {
    context.diagnostics.refuse(
      statement.at,
      `\`${written}\` may not stand in a \`describe\`: the extension \`${pinned.name}\` says so.`,
      'Move it to a `do` or a handler, which record what happens.',
    );
    return false;
  }
  const literals = checkArguments(statement, declared, context);
  if (literals === null) return false;
  return passesCheck(statement, declared, literals, context);
}

/** Each argument against its parameter; the literal values, or null having said what is wrong. */
function checkArguments(
  statement: ExtensionStatement,
  declared: Declared,
  context: CheckContext,
): (Plain | undefined)[] | null {
  const extension = context.extensions!.pinned.get(statement.extension.text)!.installed!;
  const written = `${statement.extension.text}.${statement.name.text}`;
  const { parameters } = declared;
  if (statement.arguments.length !== parameters.length) {
    context.diagnostics.refuse(
      statement.at,
      parameters.length === 0
        ? `\`${written}\` takes nothing, and is given ${statement.arguments.length}.`
        : `\`${written}\` takes ${parameters.length}: ${readable(parameters.map((p) => p.name))}.`,
      `Write \`${written}(${parameters.map((p) => p.name).join(', ')})\`.`,
    );
    return null;
  }
  const literals: (Plain | undefined)[] = [];
  let ok = true;
  parameters.forEach((parameter, index) => {
    const argument = statement.arguments[index]!;
    const type = parameterType(extension, parameter);
    if (type === null) {
      context.diagnostics.refuse(
        argument.at,
        `The extension \`${extension.name}\` declares \`${parameter.name}\` of \`${written}\` with a type it does not add.`,
        `Tell whoever runs this host that \`${extension.name}\` is broken; the fault is theirs to fix, not yours.`,
      );
      ok = false;
      literals.push(undefined);
      return;
    }
    if (type.type === 'extension' && argument.kind === 'string') {
      const read = readLiteral(type.extension, type.definition!, argument.value);
      if ('value' in read) literals.push(read.value);
      else {
        context.diagnostics.refuse(argument.at, read.problem, read.remedy);
        ok = false;
        literals.push(undefined);
      }
      return;
    }
    const got = typeOf(argument, context);
    if (got === null) {
      ok = false;
      literals.push(undefined);
      return;
    }
    if (got.binds !== 'value' || !sameType(got.type, type)) {
      context.diagnostics.refuse(
        argument.at,
        `\`${parameter.name}\` of \`${written}\` is \`${showType(type)}\`, and this is ${showBindingType(got)}.`,
        givenRemedy(type),
      );
      ok = false;
      literals.push(undefined);
      return;
    }
    literals.push(literalOf(argument));
  });
  return ok ? literals : null;
}

/** What to give an argument of `type` instead. */
function givenRemedy(type: ValueType): string {
  switch (type.type) {
    case 'extension':
      return `Give it a property of \`${showType(type)}\`, or text in quotes, which \`${type.extension}\` reads.`;
    case 'boolean':
      return 'Give it `true`, `false`, or a condition.';
    case 'integer':
      return 'Give it a whole number, or something that counts.';
    default:
      return 'Give it text in quotes, as in `"a line"`.';
  }
}

/** The value an argument writes where it is a literal; undefined where the world supplies it. */
function literalOf(argument: Expr): Plain | undefined {
  return argument.kind === 'boolean' || argument.kind === 'integer' || argument.kind === 'string'
    ? argument.value
    : undefined;
}

/** The extension's own check over the literal arguments, its problem said at the statement. */
function passesCheck(
  statement: ExtensionStatement,
  declared: Declared,
  literals: readonly (Plain | undefined)[],
  context: CheckContext,
): boolean {
  if (declared.check === undefined) return true;
  const check = declared.check.bind(declared);
  let problem: ReturnType<typeof check>;
  try {
    problem = check(Object.freeze([...literals]));
  } catch (thrown) {
    problem = {
      problem: `The extension \`${statement.extension.text}\` failed checking this: ${thrown instanceof Error ? thrown.message : String(thrown)}.`,
      remedy: `Tell whoever runs this host that \`${statement.extension.text}\` failed; the fault is theirs to fix, not yours.`,
    };
  }
  if (problem === null) return true;
  context.diagnostics.refuse(statement.at, problem.problem, problem.remedy);
  return false;
}
