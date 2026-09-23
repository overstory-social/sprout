// Typed bindings, exactly as the table (the spec's Properties › Where
// types come from).
//
// Every binding is typed where it enters scope. There is no unknown
// receiver anywhere in the language, and this file is where that claim
// is kept: one constructor per row of the spec's table, so a reader can
// hold the two side by side, and a `Scope` that says what is in reach
// and refuses a second thing answering to one name.
//
// A binding's type is not a property's type. A property holds a value,
// and there is no object-valued property; a binding may be an OBJECT, or
// a SET of them, neither of which can be written down. So `BindingType`
// is three arms rather than a `ValueType`, and the object arm carries
// the kind when the compiler knows it and null when it does not — which
// is the whole of what the object type means.
//
// What a kind is, and composing one, are `declare/kinds.ts` and
// `declare/compose.ts`'s. Typing reads the `KindRef` they build: its
// identity, everything it composes, and what it declares. Matching is
// NOMINAL and by composition, never structural — two kinds declaring
// `:open` are already a collision when they compose, and a slot that
// accepted anything shaped like a container would readmit exactly that
// confusion at the argument boundary.
//
// Checking an expression against these bindings is `check.ts`'s, and
// its `let` calls `letBinding` below, and a guard's body
// `moverBinding` and `guardParameterBinding`; a body playing a role calls
// `roleBinding` with the filler `declare/verbs.ts` resolved, and
// withholds the tools that may be missing (`Withheld`); handlers and
// hooks are B32's, and call `handlerParameters`.

import type { Ident } from '../syntax/ast.js';
import type { Diagnostics } from '../source/diagnostics.js';
import type { KindRef } from '../declare/kinds.js';
import { kindName } from '../declare/kinds.js';
import type { DeclaredMessage } from '../declare/messages.js';
import type { EngineMessage } from '../declare/engine-messages.js';
import type { RoleFiller } from '../declare/verbs.js';
import type { RoleNarrowing } from '../declare/roles.js';
import type { ResolvedProperty } from '../declare/properties.js';
import type { Span } from '../source/source.js';
import { integer, showType, type ValueType } from '../declare/types.js';

// --- what a binding can be ------------------------------------------------

/**
 * What a binding names. A value, a thing in the world, or a set of
 * things — and for the latter two, the kind where the compiler knows it.
 */
export type BindingType =
  | { readonly binds: 'value'; readonly type: ValueType }
  /** A thing in the world. `kind` is null where the compiler cannot know it. */
  | { readonly binds: 'object'; readonly kind: KindRef | null }
  /** A set role: every object the visitor named, at the role's kind. */
  | { readonly binds: 'set'; readonly kind: KindRef | null };

export function valueOf(type: ValueType): BindingType {
  return { binds: 'value', type };
}

export function objectOf(kind: KindRef): BindingType {
  return { binds: 'object', kind };
}

/** A thing in the world whose kind the compiler cannot know: the object type. */
export const OPEN_OBJECT: BindingType = { binds: 'object', kind: null };

export function setOf(kind: KindRef | null): BindingType {
  return { binds: 'set', kind };
}

/** A binding type as a message names it. */
export function showBindingType(type: BindingType): string {
  switch (type.binds) {
    case 'value':
      return showType(type.type);
    case 'object':
      return type.kind === null ? 'an object' : kindName(type.kind);
    case 'set':
      return type.kind === null ? 'a set of objects' : `a set of ${kindName(type.kind)}`;
  }
}

// --- a binding ------------------------------------------------------------

/**
 * Which row of the table a binding came from. It decides nothing about
 * the type — the type is already decided — and exists so that refusing a
 * second thing of one name can say what the first one was.
 */
export type BindingOrigin =
  | 'self'
  | 'actor'
  | 'here'
  | 'mover'
  | 'role'
  | 'each'
  | 'for'
  | 'let'
  /** A handler's or a hook's: a sender, a carried value, `was`, `elapsed`. */
  | 'parameter';

/** A binding's origin, as a sentence about it reads. */
export function describeOrigin(origin: BindingOrigin): string {
  switch (origin) {
    case 'self':
      return 'the role-player';
    case 'actor':
      return 'whoever is acting';
    case 'here':
      return "the actor's place";
    case 'mover':
      return 'whatever proposed the move';
    case 'role':
      return "this verb's role";
    case 'each':
      return 'the loop variable';
    case 'for':
      return "the passage's loop variable";
    case 'let':
      return 'a name for a value';
    case 'parameter':
      return 'a parameter of this body';
  }
}

/** A name in scope, with the type it entered scope carrying. */
export interface Binding {
  readonly name: string;
  readonly type: BindingType;
  readonly origin: BindingOrigin;
  /** Where the name was written, or what brought it into scope where the engine supplies it. */
  readonly at: Span;
  /** Only `self` writes `self`, so only `self` is written through. */
  readonly writable: boolean;
}

/** A binding that names a thing in the world, which is what `is()` narrows. */
export type ObjectBinding = Binding & {
  readonly type: { readonly binds: 'object'; readonly kind: KindRef | null };
};

export function isObjectBinding(binding: Binding): binding is ObjectBinding {
  return binding.type.binds === 'object';
}

function bind(
  name: string,
  type: BindingType,
  origin: BindingOrigin,
  at: Span,
  writable = false,
): Binding {
  return { name, type, origin, at, writable };
}

// --- the table ------------------------------------------------------------
//
// One function per row of Properties › Where types come from. `at` is
// the name as written, or the member that brought the binding into scope
// where the engine supplies the name — a diagnostic about a binding has
// to point somewhere, and there is always something to point at.

/** `self` — the composed kind. The one binding that may be written through. */
export function selfBinding(kind: KindRef, at: Span): Binding {
  return bind('self', objectOf(kind), 'self', at, true);
}

/**
 * `actor` — `sprout.Actor`, since a person or an NPC may be the one
 * acting, so anything more is read through `is()`; an object where the
 * standard library's kind is absent, which has been said.
 */
export function actorBinding(actor: KindRef | null, at: Span): Binding {
  return bind('actor', actor === null ? OPEN_OBJECT : objectOf(actor), 'actor', at);
}

/** `here` — object; the actor's place. */
export function hereBinding(at: Span): Binding {
  return bind('here', OPEN_OBJECT, 'here', at);
}

/** `mover`, in a guard — object; whatever proposed the move. */
export function moverBinding(at: Span): Binding {
  return bind('mover', OPEN_OBJECT, 'mover', at);
}

/** A guard's `to`, `item` or `from`, under the name the guard gives it — object. */
export function guardParameterBinding(name: string, at: Span): Binding {
  return bind(name, OPEN_OBJECT, 'parameter', at);
}

/** An `each` or `{for}` variable — its kind filter, or object without one. */
export function loopBinding(
  name: string,
  filter: KindRef | null,
  at: Span,
  inProse = false,
): Binding {
  const type = filter === null ? OPEN_OBJECT : objectOf(filter);
  return bind(name, type, inProse ? 'for' : 'each', at);
}

/**
 * `{for x of <list>}` — the list's element type. There is no `each` over
 * a list: a list holds values, and `{for … of}` is what renders them.
 */
export function forElementBinding(name: string, element: ValueType, at: Span): Binding {
  return bind(name, valueOf(element), 'for', at);
}

/**
 * `each … of <set role>` — each member, at the role's kind. A set role
 * has the same two forms a container does, `each tool of tools` in a
 * body and `{for x of <set role>}` in a passage, so this takes the same
 * `inProse` flag `loopBinding` does and for the same reason: a refusal
 * about the name should call it what the author called it.
 */
export function setMemberBinding(
  name: string,
  kind: KindRef | null,
  at: Span,
  inProse = false,
): Binding {
  const type = kind === null ? OPEN_OBJECT : objectOf(kind);
  return bind(name, type, inProse ? 'for' : 'each', at);
}

/** A `let` binding — the expression it names, exactly, so nothing is annotated. */
export function letBinding(name: string, type: BindingType, at: Span): Binding {
  return bind(name, type, 'let', at);
}

// --- roles ----------------------------------------------------------------

/**
 * A role's binding inside a body that plays it, or null having said why.
 *
 * A kind role binds at that kind; an open role binds as an object; a
 * value role is typed by the `from` the role-player wrote, because a
 * value role's options are the role-player's to say and not the verb's.
 * An exit role is not here: only the engine's `go` has one, and nothing
 * plays it.
 */
export function roleBinding(
  name: string,
  declared: Exclude<RoleFiller, { readonly fills: 'exit' }>,
  narrowing: RoleNarrowing | null,
  at: Span,
  diagnostics: Diagnostics,
): Binding | null {
  if (declared.fills === 'kind' || declared.fills === 'open') {
    if (narrowing !== null) {
      diagnostics.refuse(
        narrowing.at,
        `\`${name}\` is filled by a thing, so there is nothing for \`from\` to narrow.`,
        '`from` narrows a `symbol` or an `integer` role to the options this object hears.',
      );
      return null;
    }
    const type = declared.fills === 'kind' ? objectOf(declared.kind) : OPEN_OBJECT;
    return bind(name, type, 'role', at);
  }

  const element = narrowedValueType(name, declared.fills, narrowing, at, diagnostics);
  if (element === null) return null;
  return bind(name, valueOf(element), 'role', at);
}

/** A role marked `many` — every object the visitor named, at the role's kind. */
export function setRoleBinding(name: string, kind: KindRef | null, at: Span): Binding {
  return bind(name, setOf(kind), 'role', at);
}

/** The type a `from` gives a value role, or null having said why it gives none. */
function narrowedValueType(
  name: string,
  declared: 'symbol' | 'integer',
  narrowing: RoleNarrowing | null,
  at: Span,
  diagnostics: Diagnostics,
): ValueType | null {
  if (narrowing === null) {
    if (declared === 'integer') return integer();
    diagnostics.refuse(
      at,
      `\`${name}\` is a symbol role, and this object has not said which options it hears.`,
      `Write \`${name} from :<a list property>\`, naming a list of the options it answers to.`,
    );
    return null;
  }

  if (narrowing.narrows === 'range') {
    if (declared !== 'integer') {
      diagnostics.refuse(
        narrowing.at,
        `\`${name}\` is a symbol role, and a range of numbers is not a set of options.`,
        `Write \`${name} from :<a list property>\`, naming a list of the options it answers to.`,
      );
      return null;
    }
    if (narrowing.min > narrowing.max) {
      diagnostics.refuse(
        narrowing.at,
        `\`${name}\` is narrowed from ${narrowing.min} to ${narrowing.max}.`,
        'A range counts upward. Write the lower number first.',
      );
      return null;
    }
    return integer(narrowing.min, narrowing.max);
  }

  const held = narrowing.property.type;
  if (declared === 'symbol') {
    // `topic from :knows` names a list property, and only the options in
    // it match or are offered; inside the body `topic` is typed by the
    // list's element type, so `topic == :toll` checks against `Topic`.
    if (held.type === 'list' && held.element.type === 'symbol') return held.element;
    diagnostics.refuse(
      narrowing.at,
      `\`${name}\` is a symbol role, and \`:${narrowing.property.name}\` holds ${showType(held)}.`,
      'A symbol role narrows by a list of options, as in `topic from :knows`.',
    );
    return null;
  }

  // An integer role narrows by an integer property, whose range bounds it.
  if (held.type === 'integer') return integer(held.min, held.max);
  diagnostics.refuse(
    narrowing.at,
    `\`${name}\` is an integer role, and \`:${narrowing.property.name}\` holds ${showType(held)}.`,
    'An integer role narrows by an integer property, whose range bounds it, or by a range of its own, as in `from 1 to 12`.',
  );
  return null;
}

// --- handlers and hooks ---------------------------------------------------

/**
 * A handler's parameters, in the order written: the sender as an object,
 * then the carried value typed by the declaration. `_` leaves one
 * unnamed and either may be omitted, so what is passed here is what was
 * written and the positions are what give it meaning.
 */
export function handlerParameters(
  message: DeclaredMessage,
  written: readonly (Ident | null)[],
  at: Span,
  diagnostics: Diagnostics,
): Binding[] {
  const bindings: Binding[] = [];
  if (written.length > 2) {
    const extra = written[2];
    diagnostics.refuse(
      extra?.at ?? at,
      `\`:${message.name}\` binds the sender and the value it carries, and nothing else.`,
      'Write `(from)`, `(from, value)`, or leave the parentheses off.',
    );
    return bindings;
  }

  const [sender, value] = written;
  if (sender != null) bindings.push(bind(sender.text, OPEN_OBJECT, 'parameter', sender.at));

  if (value == null) return bindings;
  const carries = message.carries;
  if (carries === null) {
    diagnostics.refuse(
      value.at,
      `\`:${message.name}\` carries no value.`,
      `Write \`on :${message.name} (from)\`, or declare the value with \`message :${message.name} with <type>\`.`,
    );
    return bindings;
  }
  bindings.push(bind(value.text, valueOf(carries), 'parameter', value.at));
  return bindings;
}

/**
 * `changed :lit (was)` — a hook's previous value, typed by the property
 * that changed, captured at the moment the value changed.
 */
export function wasBinding(name: string, property: ResolvedProperty, at: Span): Binding {
  return bind(name, valueOf(property.type), 'parameter', at);
}

/** `elapsed` — integer; the seconds a tick or a wake reports. */
export function elapsedBinding(name: string, at: Span): Binding {
  return bind(name, valueOf(integer()), 'parameter', at);
}

/**
 * What an engine message binds, under the names it passes them by: what
 * it names rather than a sender and a value.
 */
export function engineParameters(message: EngineMessage, at: Span): Binding[] {
  return message.parameters.map((parameter) =>
    parameter.binds === 'integer'
      ? elapsedBinding(parameter.name, at)
      : bind(parameter.name, OPEN_OBJECT, 'parameter', at),
  );
}

// --- what a body may not read where it stands ------------------------------

/** What is said about a name, as a refusal says it. */
export interface Words {
  readonly message: string;
  readonly remedy: string;
}

/**
 * A name a body has in scope and may not read where it stands (the
 * spec's Optional tools; A role-player narrows its own options): a tool
 * some reading leaves unbound, a value tool this role-player hears
 * nothing for, or the role the body plays, which is `self`.
 */
export interface Withheld {
  readonly name: string;
  readonly at: Span;
  /** What a read of it here is told. */
  readonly unread: Words;
  /**
   * What `bound` asking about it finds: the binding it has inside
   * `if (bound …)`, or, where it can never be bound, what asking is told.
   */
  readonly bound:
    | { readonly bindable: true; readonly binding: Binding }
    | { readonly bindable: false; readonly words: Words };
}

// --- scope ----------------------------------------------------------------

/**
 * What is in reach, and what each name means there. Scopes nest — a
 * block, a branch, a loop body — and a name is looked up outward.
 *
 * Shadowing is a compile error, so `introduce` refuses a name anything
 * already answers to rather than covering it over. Two things answering
 * to one name is the opposite of what naming is for, and a reader who
 * has to track where a name changed has lost what naming bought them.
 */
export class Scope {
  private readonly bindings = new Map<string, Binding>();
  private readonly withholding = new Map<string, Withheld>();

  private constructor(private readonly parent: Scope | null) {}

  /** A scope with nothing in it: the outside of a body. */
  static root(): Scope {
    return new Scope(null);
  }

  /** A scope inside this one, seeing everything it sees. */
  inner(): Scope {
    return new Scope(this);
  }

  /**
   * Bring a name into scope, or refuse it as shadowing and leave the
   * scope as it was. Returns whether it was taken, so a caller that
   * carries on knows which name means what.
   */
  introduce(binding: Binding, diagnostics: Diagnostics): boolean {
    if (this.taken(binding.name, binding.at, diagnostics)) return false;
    this.bindings.set(binding.name, binding);
    return true;
  }

  /**
   * Bring a name into scope that may not be read where it stands, or
   * refuse it as shadowing, as `introduce` does.
   */
  withhold(withheld: Withheld, diagnostics: Diagnostics): boolean {
    if (this.taken(withheld.name, withheld.at, diagnostics)) return false;
    this.withholding.set(withheld.name, withheld);
    return true;
  }

  /** Whether something here already answers to `name`, said at `at` where it does. */
  private taken(name: string, at: Span, diagnostics: Diagnostics): boolean {
    const before = this.lookup(name);
    const origin = before?.origin ?? (this.withheld(name) === null ? null : 'role');
    if (origin === null) return false;
    diagnostics.refuse(
      at,
      `\`${name}\` already names ${describeOrigin(origin)} here.`,
      'Two things answering to one name is the opposite of what naming is for. Give this one another name.',
    );
    return true;
  }

  /**
   * What a name that may not be read here is, looking outward, or null
   * where it is not one. A branch `bounding` opened reads it through
   * `lookup` instead.
   */
  withheld(name: string): Withheld | null {
    const own = this.withholding.get(name);
    if (own !== undefined) return own;
    for (let scope = this.parent; scope !== null; scope = scope.parent) {
      const found = scope.withholding.get(name);
      if (found !== undefined) return found;
    }
    return null;
  }

  /**
   * What a name means here, looking outward, or null where nothing
   * answers to it.
   *
   * Iterative, and so is `names()`. Both read outward from `this.parent`
   * rather than recursing, because a scope chain is as deep as the
   * blocks a body nests and a `RangeError` is not a diagnostic. The
   * parser bounds its own recursion; a scope has nothing to count and
   * simply does not recurse.
   */
  lookup(name: string): Binding | null {
    const own = this.bindings.get(name);
    if (own !== undefined) return own;
    for (let scope = this.parent; scope !== null; scope = scope.parent) {
      const found = scope.bindings.get(name);
      if (found !== undefined) return found;
    }
    return null;
  }

  /** What a name means in THIS scope, ignoring the ones around it. */
  own(name: string): Binding | null {
    return this.bindings.get(name) ?? null;
  }

  /** Every name in reach, nearest first, each appearing once. */
  names(): string[] {
    const seen = new Set<string>(this.bindings.keys());
    for (let scope = this.parent; scope !== null; scope = scope.parent) {
      for (const name of scope.bindings.keys()) seen.add(name);
    }
    return [...seen];
  }

  /**
   * `if (x.is(K)) { … }` — the branch, where `x` is known to be a `K` and
   * a kind's own properties are readable through it. This is the one
   * re-binding of a name that is not shadowing: it does not introduce a
   * second thing answering to the name, it says more about the one
   * already there.
   */
  narrowing(binding: ObjectBinding, kind: KindRef): Scope {
    const branch = this.inner();
    branch.bindings.set(binding.name, { ...binding, type: objectOf(kind) });
    return branch;
  }

  /**
   * `if (bound tool) { … }` — the branch, where a tool some reading
   * leaves unbound is known to be bound and is read as its role declares.
   * Like `narrowing`, it says more about a name already here.
   */
  bounding(binding: Binding): Scope {
    const branch = this.inner();
    branch.bindings.set(binding.name, binding);
    return branch;
  }
}
