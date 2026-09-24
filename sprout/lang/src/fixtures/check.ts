// The printer's shop, far enough built to ask real questions: the kinds,
// enums and bodies the checker's specs type against, and the helpers that
// read an expression in one of them. Spec support: the package build
// leaves it out.

import {
  actorBinding,
  hereBinding,
  roleBinding,
  Scope,
  selfBinding,
  setRoleBinding,
  showBindingType,
  type Binding,
} from '../check/bindings.js';
import { checkEffectCall, isEffect, typeOf, type CheckContext } from '../check/check.js';
import { checkerOf, type Checker } from '../check/check/checker.js';
import type { CallExpr, Expr, Ident } from '../syntax/ast.js';
import type { KindLookup, KindRef } from '../declare/kinds.js';
import { NO_GRAMMAR } from '../declare/grammar.js';
import { NO_PASS_RULES } from '../declare/passes.js';
import { NO_GUARDS } from '../declare/guards.js';
import { NO_PLAYS } from '../declare/roles.js';
import { ACTOR, VISITOR } from '../declare/actors.js';
import { Diagnostics } from '../source/diagnostics.js';
import { EnumTable } from '../declare/enums.js';
import { parseDeclarations, parseExpression, parseProperty } from '../syntax/parse.js';
import { resolveProperty, type ResolvedProperty } from '../declare/properties.js';
import { SourceFile } from '../source/source.js';

/** A fixture that could not be built is the fixture's fault, not the case's. */
function settled(diagnostics: Diagnostics, what: string): void {
  if (diagnostics.refusals.length > 0) {
    throw new Error(`${what}: ${diagnostics.refusals.map((d) => d.message).join(' ')}`);
  }
}

export const NAMES = new SourceFile(
  'shop.sprout',
  'self actor here target tool tools item thing topic n note\n',
);
export const at = (word: string) => {
  const start = NAMES.text.indexOf(word);
  if (start < 0) throw new Error(`the fixture has no \`${word}\``);
  return NAMES.span(start, start + word.length);
};

export const ENUMS = (() => {
  const table = new EnumTable();
  const diagnostics = new Diagnostics();
  table.add(
    'shop',
    parseDeclarations(
      new SourceFile(
        'enums.sprout',
        'enum Ward { oak, silver }\nenum Drying { wet, cured }\nenum Topic { bridge, toll }\n',
      ),
      diagnostics,
    ).filter((d) => d.kind === 'enum'),
    diagnostics,
  );
  settled(diagnostics, 'the enums');
  return table;
})();

export function property(text: string, remembered = false): ResolvedProperty {
  const diagnostics = new Diagnostics();
  const declared = parseProperty(new SourceFile('p.sprout', text), diagnostics);
  const resolved =
    declared === null
      ? null
      : resolveProperty(declared, ENUMS, 'shop', 'shop.Declared', diagnostics, remembered);
  settled(diagnostics, text);
  return resolved!;
}

export function kind(
  name: string,
  properties: ResolvedProperty[],
  composes: string[] = [],
  contains = false,
  library = 'shop',
  containsActors = false,
): KindRef {
  const order = [...composes, `${library}.${name}`];
  return {
    library,
    name,
    order,
    composes: new Set(order),
    properties: new Map(properties.map((p) => [p.name, p])),
    passages: new Map(),
    guards: NO_GUARDS,
    plays: NO_PLAYS,
    handlers: new Map(),
    hooks: new Map(),
    passes: NO_PASS_RULES,
    grammar: NO_GRAMMAR,
    exits: [],
    // `contains actors` implies holding, and a fixture that says
    // otherwise would be typing against a kind that cannot exist.
    contains: contains || containsActors,
    containsActors,
    suppressed: [],
  };
}

export const KEY = kind('Key', [
  property(':wear 0 min 0 max 99'),
  property(':opens [Ward] default [oak]'),
]);
export const WARDED = kind('Warded', [
  property(':sealed false'),
  property(':ward Ward default oak'),
  property(':state Drying default wet'),
  property(':note string default ""'),
  property(':row [Ward] default [oak]'),
  property(':grid [[Ward]] default [[oak]]'),
]);
export const RIB = kind('Rib', [property(':cracked false')]);
export const VESSEL = kind(
  'Vessel',
  [property(':capacity 4 min 0 max 9'), property(':inked false')],
  ['sprout.Container'],
  true,
);
export const PRINTER = kind(
  'Printer',
  [
    property(':visits 0 min 0 max 99', true),
    property(':handled false', true),
    property(':seen [Ward] default [oak]', true),
  ],
  [ACTOR, VISITOR],
  true,
);
export const CONTAINER = kind('Container', [], [], true, 'sprout');
/** `sprout.Place`, what `here` is where every place composes it. */
export const PLACE = kind('Place', [], [], true, 'sprout', true);

/** `sprout.World`, what every world composes. */
export const SPROUT_WORLD = kind('World', [], [], true, 'sprout');
/** The shop's own world, as its composed kind: what `self` is in the world's body. */
export const SHOP = kind('Shop', [], ['sprout.World'], true);

export const ALL = [KEY, WARDED, RIB, VESSEL, PRINTER, CONTAINER, PLACE, SPROUT_WORLD, SHOP];
export const KINDS: KindLookup = {
  qualified: (library, name) => ALL.find((k) => k.library === library && k.name === name) ?? null,
  unqualified: (name, from) => KINDS.qualified(from, name) ?? KINDS.qualified('sprout', name),
  all: () => ALL,
};

/** A body of `selfKind`, with the bindings a role-player has. */
export function bodyOf(selfKind: KindRef, ...extra: Binding[]): CheckContext {
  const scope = Scope.root();
  const setting = new Diagnostics();
  for (const binding of [
    selfBinding(selfKind, at('self')),
    actorBinding(PRINTER, at('actor')),
    hereBinding({ place: PLACE, unlike: null }, at('here')),
    ...extra,
  ]) {
    scope.introduce(binding, setting);
  }
  settled(setting, 'the bindings of a body');
  return { scope, kinds: KINDS, from: 'shop', self: selfKind, diagnostics: new Diagnostics() };
}

/** Everything a context has said so far, message and remedy together. */
export function saidBy(context: CheckContext): string[] {
  return context.diagnostics.all.map((d) => `${d.message} ${d.remedy ?? ''}`.trim());
}

export const warded = () =>
  bodyOf(
    WARDED,
    roleBinding('tool', { fills: 'kind', kind: KEY }, null, at('tool'), new Diagnostics())!,
  );
export const vessel = () =>
  bodyOf(
    VESSEL,
    setRoleBinding('tools', RIB, at('tools')),
    roleBinding('target', { fills: 'open' }, null, at('target'), new Diagnostics())!,
  );

/** A checker over `context`, wired to the real walk, for a spec that calls a module's functions directly. */
export function checking(context: CheckContext): Checker {
  return checkerOf(context, (expr, checker) => typeOf(expr, checker));
}

/** An expression as written. A parse that fails is the case's fault, and says so. */
export function expression(text: string): Expr {
  const parsing = new Diagnostics();
  const expr = parseExpression(new SourceFile('b.sprout', text), parsing);
  if (parsing.refusals.length > 0 || expr === null) {
    throw new Error(
      `\`${text}\` did not parse: ${parsing.refusals.map((d) => d.message).join(' ')}`,
    );
  }
  return expr;
}

/** A call as written, for a spec that hands its parts to a module directly. */
export function call(text: string): CallExpr {
  const expr = expression(text);
  if (expr.kind !== 'call') throw new Error(`\`${text}\` is not a call`);
  return expr;
}

/** The word a `:p` or a bare name is written with. */
export function word(text: string): Ident {
  const expr = expression(text);
  if (expr.kind === 'symbol-expr' || expr.kind === 'binding') return expr.name;
  throw new Error(`\`${text}\` is not a word`);
}

/** Read an expression and ask what it is. The parse must succeed first. */
export function read(text: string, context: CheckContext) {
  const expr = expression(text);
  const type = typeOf(expr, context);
  return {
    expr,
    type,
    shown: type === null ? null : showBindingType(type),
    said: saidBy(context),
    diagnostics: context.diagnostics,
  };
}

/** What an expression is, in a body that has everything it needs. */
export function shapeOf(text: string, context: CheckContext = bodyOf(VESSEL)): string | null {
  return read(text, context).shown;
}

/** Whether a call that writes is allowed, checked as a statement would check it. */
export function effect(text: string, context: CheckContext): boolean {
  return effectSaid(text, context).ok;
}

/** A call that writes, checked, with everything said about it. */
export function effectSaid(
  text: string,
  context: CheckContext,
): { ok: boolean; messages: string[] } {
  const expr = expression(text);
  if (!isEffect(expr)) throw new Error(`\`${text}\` is not a call that writes`);
  const ok = checkEffectCall(expr, context);
  return { ok, messages: saidBy(context) };
}
