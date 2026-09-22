// What the parser's specs read source through: each helper runs one
// entry point of `syntax/parse.ts` over a string and hands back what it
// built and what it said. Spec support: the package build leaves it out.

import type { EnumDeclaration, Expr } from '../syntax/ast.js';
import { Diagnostics, type Diagnostic } from '../source/diagnostics.js';
import { parseDeclarations, parseExpression, parseLet, parseProperty } from '../syntax/parse.js';
import { SourceFile } from '../source/source.js';
import { DEFAULT_LIMITS } from '../bundle/limits.js';

export function read(text: string, name = 'ward.sprout') {
  const diagnostics = new Diagnostics();
  const declarations = parseDeclarations(new SourceFile(name, text), diagnostics);
  return { declarations, diagnostics, refusals: diagnostics.refusals as readonly Diagnostic[] };
}

/** An enum's options as plain words, for a suite that is not about nodes. */
export const optionsOf = (declared: EnumDeclaration): string[] =>
  declared.options.map((option) => option.name.text);

/** An expression as a shape, brackets showing what bound to what. */
export function shape(expr: Expr | null): string {
  if (expr === null) return 'null';
  switch (expr.kind) {
    case 'binary':
      return `(${shape(expr.left)} ${expr.operator} ${shape(expr.right)})`;
    case 'unary':
      return `(${expr.operator}${shape(expr.operand)})`;
    case 'member':
      return `${shape(expr.receiver)}.${expr.member.text}`;
    case 'call':
      return `${shape(expr.receiver)}.${expr.method.text}(${expr.arguments.map(shape).join(', ')})`;
    case 'free-call':
      return `${expr.name.text}(${expr.arguments.map(shape).join(', ')})`;
    case 'binding':
      return expr.name.text;
    case 'symbol-expr':
      return `:${expr.name.text}`;
    case 'kind-expr':
      return expr.library === null ? expr.name.text : `${expr.library.text}.${expr.name.text}`;
    case 'string':
      return JSON.stringify(expr.value);
    default:
      return String(expr.value);
  }
}

/** One property declaration, with whatever caps the host set. */
export function readProperty(text: string, caps = DEFAULT_LIMITS.caps) {
  const diagnostics = new Diagnostics();
  const declared = parseProperty(new SourceFile('k.sprout', text), diagnostics, caps);
  return { declared, diagnostics, refusals: diagnostics.refusals };
}

export function readExpression(text: string, caps = DEFAULT_LIMITS.caps) {
  const diagnostics = new Diagnostics();
  const expr = parseExpression(new SourceFile('body.sprout', text), diagnostics, caps);
  return { expr, shape: shape(expr), diagnostics, refusals: diagnostics.refusals };
}

export function readWorld(text: string) {
  const diagnostics = new Diagnostics();
  const declarations = parseDeclarations(new SourceFile('w.sprout', text), diagnostics);
  return {
    world: declarations.find((d) => d.kind === 'world'),
    declarations,
    refusals: diagnostics.refusals,
  };
}

export function readLet(text: string) {
  const diagnostics = new Diagnostics();
  const statement = parseLet(new SourceFile('body.sprout', text), diagnostics);
  return { statement, diagnostics, refusals: diagnostics.refusals };
}
