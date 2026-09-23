// The world `check/bindings.spec.ts` and `check/bindings/*.spec.ts` are
// written about: the printer's shop, the same one the other checker
// suites use. A `KindRef` is built here by hand rather than composed,
// which is the seam these specs are about: everything below needs of a
// kind only its identity, what it composes and what it declares. A
// fixture that could not be built throws with what was said, since a
// fixture that does not resolve proves nothing. Spec support: the
// package build leaves it out.

import type { Ident } from '../syntax/ast.js';
import { isObjectBinding, type Binding, type ObjectBinding } from '../check/bindings.js';
import type { KindRef } from '../declare/kinds.js';
import { NO_GUARDS } from '../declare/guards.js';
import { NO_PLAYS, type RoleNarrowing } from '../declare/roles.js';
import { Diagnostics } from '../source/diagnostics.js';
import { EnumTable } from '../declare/enums.js';
import type { DeclaredMessage } from '../declare/messages.js';
import { MessageTable } from '../declare/messages.js';
import { parseDeclarations, parseProperty } from '../syntax/parse.js';
import { resolveProperty, type ResolvedProperty } from '../declare/properties.js';
import { SourceFile, type Span } from '../source/source.js';

/** A fixture that could not be built is the fixture's fault, not the case's. */
function settled(diagnostics: Diagnostics, what: string): void {
  if (diagnostics.refusals.length > 0) {
    throw new Error(`${what}: ${diagnostics.refusals.map((d) => d.message).join(' ')}`);
  }
}

export const FILE = new SourceFile(
  'shop.sprout',
  'self actor here mover target tools topic pot thing n from value was elapsed item\n',
);

/** The span of a word in `FILE`, so every binding points at real text. */
export function at(word: string): Span {
  const start = FILE.text.indexOf(word);
  if (start < 0) throw new Error(`the fixture has no \`${word}\` to point at`);
  return FILE.span(start, start + word.length);
}

export const ENUMS = (() => {
  const table = new EnumTable();
  const diagnostics = new Diagnostics();
  const declared = parseDeclarations(
    new SourceFile('enums.sprout', 'enum Topic { bridge, toll, weather }\n'),
    diagnostics,
  ).filter((d) => d.kind === 'enum');
  table.add('printers_shop', declared, diagnostics);
  settled(diagnostics, 'the enums');
  return table;
})();

/** A property, declared the way a kind would and resolved the way a kind's is. */
export function property(text: string): ResolvedProperty {
  const diagnostics = new Diagnostics();
  const declared = parseProperty(new SourceFile('guard.sprout', text), diagnostics);
  const resolved =
    declared === null
      ? null
      : resolveProperty(declared, ENUMS, 'printers_shop', 'printers_shop.Declared', diagnostics);
  settled(diagnostics, `\`${text}\` did not resolve`);
  return resolved!;
}

export const KNOWS = property(':knows [Topic] default [bridge, toll]');
export const WEAR = property(':wear 0 min 0 max 99');
export const SEALED = property(':sealed false');
export const NOTE = property(':note string default ""');
export const SIZES = property(':sizes [integer] default [1]');

/** A kind, reduced to what typing asks of it, composing everything named. */
export function kind(library: string, name: string, ...composes: string[]): KindRef {
  const order = [...composes, `${library}.${name}`];
  return {
    library,
    name,
    order,
    composes: new Set(order),
    properties: new Map(),
    passages: new Map(),
    guards: NO_GUARDS,
    plays: NO_PLAYS,
    contains: false,
    containsActors: false,
    suppressed: [],
  };
}

export const CONTAINER = kind('sprout', 'Container');
export const VESSEL = kind('printers_shop', 'Vessel', 'sprout.Container');
export const LOCKABLE = kind('sprout', 'Lockable');
export const VISITOR = kind('printers_shop', 'Printer', 'sprout.Actor');

export const MESSAGES = (() => {
  const table = new MessageTable();
  const diagnostics = new Diagnostics();
  const declared = parseDeclarations(
    new SourceFile(
      'messages.sprout',
      'message :illuminating with boolean\nmessage :gust\nmessage :pong with integer\n',
    ),
    diagnostics,
  ).filter((d) => d.kind === 'message');
  table.add('printers_shop', declared, ENUMS, diagnostics);
  settled(diagnostics, 'the messages');
  return table;
})();

export function message(name: string): DeclaredMessage {
  const found = MESSAGES.unqualified(name, 'printers_shop');
  if (found === null) throw new Error(`no message :${name}`);
  return found;
}

/** A parameter list as a handler writes it; `null` is `_`. */
export function parameters(...written: (string | null)[]): (Ident | null)[] {
  return written.map((name) =>
    name === null ? null : { kind: 'ident', at: at(name), text: name },
  );
}

/** A binding that names a thing, which is the only kind `is()` can narrow. */
export function thingNamed(binding: Binding): ObjectBinding {
  if (!isObjectBinding(binding)) throw new Error(`\`${binding.name}\` does not name a thing`);
  return binding;
}

/** Run something that may refuse, and hand back both what it made and what it said. */
export function trying<T>(run: (diagnostics: Diagnostics) => T) {
  const diagnostics = new Diagnostics();
  const made = run(diagnostics);
  // Message AND remedy: a diagnostic that names the problem but not what
  // to write instead is half a diagnostic, so the specs read both.
  const said = diagnostics.all.map((d) => `${d.message} ${d.remedy ?? ''}`.trim());
  return { made, said, diagnostics };
}

/** A role narrowed by the property named, as `from` writes it. */
export function fromProperty(of: ResolvedProperty): RoleNarrowing {
  return { narrows: 'property', property: of, at: at('topic') };
}
/** A role narrowed by a literal range, as `from … to …` writes it. */
export function fromRange(min: number, max: number): RoleNarrowing {
  return { narrows: 'range', min, max, at: at('topic') };
}
