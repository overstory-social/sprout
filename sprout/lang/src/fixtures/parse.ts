// What the parser's specs read source through: each helper runs one
// entry point of `syntax/parse.ts` over a string and hands back what it
// built and what it said. Spec support: the package build leaves it out.

import type { EnumDeclaration, Expr } from '../syntax/ast.js';
import { Diagnostics, type Diagnostic } from '../source/diagnostics.js';
import {
  parseDeclarations,
  parseExpression,
  parseProperty,
  parseStatement,
} from '../syntax/parse.js';
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
    case 'bound':
      return `bound ${expr.name.text}`;
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

export function readStatement(text: string) {
  const diagnostics = new Diagnostics();
  const statement = parseStatement(new SourceFile('body.sprout', text), diagnostics);
  return { statement, diagnostics, refusals: diagnostics.refusals };
}

/** mulberry32: a fixed stream of choices, so every failure reproduces from the source it prints. */
export function chooser(seed: number) {
  let state = seed >>> 0;
  const below = (n: number): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) % n;
  };
  const one = <T>(items: readonly T[]): T => items[below(items.length)]!;
  const shuffled = <T>(items: readonly T[]): T[] => {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = below(i + 1);
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  };
  return { below, one, shuffled };
}
export type Chooser = ReturnType<typeof chooser>;
