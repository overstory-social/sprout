import { describe, expect, it } from 'vitest';

import type { Ident } from '../syntax/ast.js';
import {
  actorBinding,
  describeOrigin,
  elapsedBinding,
  ENGINE_MESSAGES,
  engineMessage,
  engineParameters,
  forElementBinding,
  handlerParameters,
  hereBinding,
  isObjectBinding,
  letBinding,
  loopBinding,
  moverBinding,
  objectOf,
  OPEN_OBJECT,
  roleBinding,
  Scope,
  selfBinding,
  setMemberBinding,
  setOf,
  setRoleBinding,
  showBindingType,
  valueOf,
  wasBinding,
  type Binding,
  type BindingOrigin,
  type BindingType,
  type ObjectBinding,
  type RoleDeclaredAs,
  type RoleNarrowing,
} from './bindings.js';
import { composesKind, kindName, type KindRef } from '../declare/kinds.js';
import { Diagnostics } from '../source/diagnostics.js';
import { EnumTable } from '../declare/enums.js';
import type { DeclaredMessage } from '../declare/messages.js';
import { MessageTable } from '../declare/messages.js';
import { parseDeclarations, parseProperty } from '../syntax/parse.js';
import { resolveProperty, type ResolvedProperty } from '../declare/properties.js';
import { locationOf, SourceFile, type Span } from '../source/source.js';
import { BOOLEAN, integer, STRING } from '../declare/types.js';

// --- the world these specs are written about ------------------------------
//
// The printer's shop, the same one the other suites use. Kinds have no
// syntax yet (B19), so a `KindRef` is built here by hand — which is the
// seam this file is about: everything below needs of a kind only its
// identity, what it composes and what it declares.

const FILE = new SourceFile(
  'shop.sprout',
  'self actor here mover target tools topic pot thing n from value was elapsed item\n',
);

/** The span of a word in the file above, so every binding points at real text. */
function at(word: string): Span {
  const start = FILE.text.indexOf(word);
  if (start < 0) throw new Error(`the fixture has no \`${word}\` to point at`);
  return FILE.span(start, start + word.length);
}

function enums(): EnumTable {
  const table = new EnumTable();
  const diagnostics = new Diagnostics();
  const declared = parseDeclarations(
    new SourceFile('enums.sprout', 'enum Topic { bridge, toll, weather }\n'),
    diagnostics,
  ).filter((d) => d.kind === 'enum');
  table.add('printers_shop', declared, diagnostics);
  expect(diagnostics.refusals).toHaveLength(0);
  return table;
}
const ENUMS = enums();

/** A property, declared the way a kind would and resolved the way a kind's is. */
function property(text: string): ResolvedProperty {
  const diagnostics = new Diagnostics();
  const declared = parseProperty(new SourceFile('guard.sprout', text), diagnostics);
  const resolved =
    declared === null ? null : resolveProperty(declared, ENUMS, 'printers_shop', diagnostics);
  expect(diagnostics.refusals, `\`${text}\` did not resolve`).toHaveLength(0);
  return resolved!;
}

const KNOWS = property(':knows [Topic] default [bridge, toll]');
const WEAR = property(':wear 0 min 0 max 99');
const SEALED = property(':sealed false');
const NOTE = property(':note string default ""');
const SIZES = property(':sizes [integer] default [1]');

/** A kind, reduced to what typing asks of it, composing everything named. */
function kind(library: string, name: string, ...composes: string[]): KindRef {
  return {
    library,
    name,
    composes: new Set([`${library}.${name}`, ...composes]),
    properties: new Map(),
    contains: false,
    containsActors: false,
  };
}

const CONTAINER = kind('sprout', 'Container');
const VESSEL = kind('printers_shop', 'Vessel', 'sprout.Container');
const LOCKABLE = kind('sprout', 'Lockable');
const VISITOR = kind('printers_shop', 'Printer', 'sprout.Actor');

function messages(): MessageTable {
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
  expect(diagnostics.refusals).toHaveLength(0);
  return table;
}
const MESSAGES = messages();

function message(name: string): DeclaredMessage {
  const found = MESSAGES.unqualified(name, 'printers_shop');
  expect(found, `no message :${name}`).not.toBeNull();
  return found!;
}

/** A parameter list as a handler writes it; `null` is `_`. */
function parameters(...written: (string | null)[]): (Ident | null)[] {
  return written.map((name) =>
    name === null ? null : { kind: 'ident', at: at(name), text: name },
  );
}

/** A binding that names a thing, which is the only kind `is()` can narrow. */
function thingNamed(binding: Binding): ObjectBinding {
  if (!isObjectBinding(binding)) throw new Error(`\`${binding.name}\` does not name a thing`);
  return binding;
}

/** Run something that may refuse, and hand back both what it made and what it said. */
function trying<T>(run: (diagnostics: Diagnostics) => T) {
  const diagnostics = new Diagnostics();
  const made = run(diagnostics);
  // Message AND remedy: a diagnostic that names the problem but not what
  // to write instead is half a diagnostic, so the specs read both.
  const said = diagnostics.all.map((d) => `${d.message} ${d.remedy ?? ''}`.trim());
  return { made, said, diagnostics };
}

// --- a kind, as typing needs it -------------------------------------------

describe('a kind is matched nominally, and by composition', () => {
  it('names itself by its library and its name', () => {
    expect(kindName(CONTAINER)).toBe('sprout.Container');
    expect(kindName(VESSEL)).toBe('printers_shop.Vessel');
  });

  it('composes itself, so a kind fills a role declaring it', () => {
    expect(composesKind(VESSEL, VESSEL)).toBe(true);
    expect(composesKind(CONTAINER, CONTAINER)).toBe(true);
  });

  it('admits anything that composes the kind, whatever else it composes', () => {
    expect(composesKind(VESSEL, CONTAINER)).toBe(true);
    expect(composesKind(CONTAINER, VESSEL)).toBe(false);
  });

  it('does not match structurally: two kinds are not one for looking alike', () => {
    const elsewhere = kind('other_world', 'Vessel', 'sprout.Container');
    expect(kindName(elsewhere)).not.toBe(kindName(VESSEL));
    expect(composesKind(elsewhere, VESSEL)).toBe(false);
    expect(composesKind(VESSEL, elsewhere)).toBe(false);
  });
});

// --- what a binding can be ------------------------------------------------

describe('a binding type is not a property type', () => {
  it('says what it is, for every arm there is', () => {
    const every: [BindingType, string][] = [
      [valueOf(BOOLEAN), 'boolean'],
      [valueOf(integer(0, 99)), 'integer 0 to 99'],
      [valueOf(STRING), 'string'],
      [valueOf(KNOWS.type), '[Topic]'],
      [objectOf(VESSEL), 'printers_shop.Vessel'],
      [OPEN_OBJECT, 'an object'],
      [setOf(LOCKABLE), 'a set of sprout.Lockable'],
      [setOf(null), 'a set of objects'],
    ];
    for (const [type, said] of every) expect(showBindingType(type)).toBe(said);
  });

  it('knows an object binding from a value one, which is what `is()` narrows', () => {
    expect(isObjectBinding(hereBinding(at('here')))).toBe(true);
    expect(isObjectBinding(selfBinding(VESSEL, at('self')))).toBe(true);
    expect(isObjectBinding(elapsedBinding('elapsed', at('elapsed')))).toBe(false);
    expect(isObjectBinding(setRoleBinding('tools', null, at('tools')))).toBe(false);
  });

  it('describes every origin there is, so a refusal can name the first one', () => {
    const every: BindingOrigin[] = [
      'self',
      'actor',
      'here',
      'mover',
      'role',
      'each',
      'for',
      'let',
      'parameter',
    ];
    for (const origin of every) {
      expect(describeOrigin(origin), origin).not.toBe('');
      expect(describeOrigin(origin), origin).not.toContain('undefined');
    }
  });
});

// --- the table ------------------------------------------------------------

describe('where types come from — the table, row by row', () => {
  it('`self` — the composed kind', () => {
    const self = selfBinding(VESSEL, at('self'));
    expect(self.type).toEqual(objectOf(VESSEL));
    expect(self.origin).toBe('self');
  });

  it('`actor` — the world’s visitor kind', () => {
    expect(actorBinding(VISITOR, at('actor')).type).toEqual(objectOf(VISITOR));
  });

  it('`here` — object; the actor’s place', () => {
    expect(hereBinding(at('here')).type).toEqual(OPEN_OBJECT);
  });

  it('`mover`, in a guard — object; whatever proposed the move', () => {
    expect(moverBinding(at('mover')).type).toEqual(OPEN_OBJECT);
  });

  it('a role — the kind the verb declares', () => {
    const { made, said } = trying((d) =>
      roleBinding('target', { role: 'kind', kind: LOCKABLE }, null, at('target'), d),
    );
    expect(said).toEqual([]);
    expect(made!.type).toEqual(objectOf(LOCKABLE));
  });

  it('a role — object where the verb declares none', () => {
    const { made } = trying((d) => roleBinding('tools', { role: 'open' }, null, at('tools'), d));
    expect(made!.type).toEqual(OPEN_OBJECT);
  });

  it('a set role — as above, as a set', () => {
    expect(setRoleBinding('tools', LOCKABLE, at('tools')).type).toEqual(setOf(LOCKABLE));
    expect(setRoleBinding('tools', null, at('tools')).type).toEqual(setOf(null));
  });

  it('a role narrowed by `from` — the element type of the property named', () => {
    const { made, said } = trying((d) =>
      roleBinding('topic', { role: 'symbol' }, fromProperty(KNOWS), at('topic'), d),
    );
    expect(said).toEqual([]);
    expect(showBindingType(made!.type)).toBe('Topic');
  });

  it('an `each` variable — its kind filter, or object without one', () => {
    expect(loopBinding('pot', VESSEL, at('pot')).type).toEqual(objectOf(VESSEL));
    expect(loopBinding('thing', null, at('thing')).type).toEqual(OPEN_OBJECT);
    expect(loopBinding('pot', VESSEL, at('pot')).origin).toBe('each');
  });

  it('a `{for}` variable — the same, and the element type over a list', () => {
    expect(loopBinding('thing', VESSEL, at('thing'), true).origin).toBe('for');
    expect(loopBinding('thing', VESSEL, at('thing'), true).type).toEqual(objectOf(VESSEL));
    const element = forElementBinding('topic', integer(1, 12), at('topic'));
    expect(element.type).toEqual(valueOf(integer(1, 12)));
    expect(element.origin).toBe('for');
  });

  it('`each … of` a set role — each member, at the role’s kind', () => {
    expect(setMemberBinding('pot', VESSEL, at('pot')).type).toEqual(objectOf(VESSEL));
    expect(setMemberBinding('thing', null, at('thing')).type).toEqual(OPEN_OBJECT);
  });

  it('calls a set role’s member what the author called it, in a body or in a passage', () => {
    expect(setMemberBinding('pot', VESSEL, at('pot')).origin).toBe('each');
    expect(setMemberBinding('pot', VESSEL, at('pot'), true).origin).toBe('for');
    // The same two forms a container has, and the same flag, so the two
    // constructors cannot drift apart.
    expect(loopBinding('thing', null, at('thing')).origin).toBe('each');
    expect(loopBinding('thing', null, at('thing'), true).origin).toBe('for');
  });

  it('a `let` binding — the expression it names, exactly', () => {
    expect(letBinding('n', valueOf(integer(0, 99)), at('n')).type).toEqual(valueOf(integer(0, 99)));
    expect(letBinding('pot', objectOf(VESSEL), at('pot')).type).toEqual(objectOf(VESSEL));
  });

  it('a handler’s sender — object', () => {
    const made = handlerParameters(
      message('gust'),
      parameters('from'),
      at('from'),
      new Diagnostics(),
    );
    expect(made).toHaveLength(1);
    expect(made[0]!.type).toEqual(OPEN_OBJECT);
  });

  it('a handler’s value — the message’s declaration', () => {
    const made = handlerParameters(
      message('illuminating'),
      parameters('from', 'value'),
      at('value'),
      new Diagnostics(),
    );
    expect(made.map((b) => showBindingType(b.type))).toEqual(['an object', 'boolean']);
  });

  it('a hook’s previous value — the property that changed', () => {
    const { made, said } = trying((d) => wasBinding('was', SEALED, at('was'), d));
    expect(said).toEqual([]);
    expect(made!.type).toEqual(valueOf(BOOLEAN));
    expect(wasBinding('was', WEAR, at('was'), new Diagnostics())!.type).toEqual(
      valueOf(integer(0, 99)),
    );
    expect(wasBinding('was', NOTE, at('was'), new Diagnostics())!.type).toEqual(valueOf(STRING));
  });

  it('`elapsed` — integer', () => {
    expect(elapsedBinding('elapsed', at('elapsed')).type).toEqual(valueOf(integer()));
  });

  it('points every binding at something, so a diagnostic about one has a place', () => {
    const every: Binding[] = [
      selfBinding(VESSEL, at('self')),
      actorBinding(VISITOR, at('actor')),
      hereBinding(at('here')),
      moverBinding(at('mover')),
      setRoleBinding('tools', null, at('tools')),
      loopBinding('pot', VESSEL, at('pot')),
      forElementBinding('topic', integer(), at('topic')),
      setMemberBinding('thing', null, at('thing')),
      letBinding('n', valueOf(BOOLEAN), at('n')),
      elapsedBinding('elapsed', at('elapsed')),
    ];
    for (const binding of every) {
      expect(binding.at.source, binding.name).toBe(FILE);
      expect(binding.at.end, binding.name).toBeGreaterThan(binding.at.start);
    }
  });
});

describe('only `self` writes `self`', () => {
  it('is the one binding written through', () => {
    expect(selfBinding(VESSEL, at('self')).writable).toBe(true);
  });

  it('and nothing else is', () => {
    const every: Binding[] = [
      actorBinding(VISITOR, at('actor')),
      hereBinding(at('here')),
      moverBinding(at('mover')),
      setRoleBinding('tools', VESSEL, at('tools')),
      loopBinding('pot', VESSEL, at('pot')),
      setMemberBinding('thing', null, at('thing')),
      letBinding('n', valueOf(BOOLEAN), at('n')),
      elapsedBinding('elapsed', at('elapsed')),
      wasBinding('was', SEALED, at('was'), new Diagnostics())!,
    ];
    for (const binding of every) expect(binding.writable, binding.name).toBe(false);
  });
});

// --- value roles ----------------------------------------------------------

function fromProperty(of: ResolvedProperty): RoleNarrowing {
  return { narrows: 'property', property: of, at: at('topic') };
}
function fromRange(min: number, max: number): RoleNarrowing {
  return { narrows: 'range', min, max, at: at('topic') };
}

describe('a role-player narrows its own options', () => {
  it('types a symbol role by the list’s element type, so `== :toll` checks against `Topic`', () => {
    const { made } = trying((d) =>
      roleBinding('topic', { role: 'symbol' }, fromProperty(KNOWS), at('topic'), d),
    );
    expect(made!.type).toEqual(
      valueOf({ type: 'symbol', of: ENUMS.unqualified('Topic', 'printers_shop')! }),
    );
  });

  it('bounds an integer role by the range of the property named', () => {
    const { made, said } = trying((d) =>
      roleBinding('n', { role: 'integer' }, fromProperty(WEAR), at('n'), d),
    );
    expect(said).toEqual([]);
    expect(made!.type).toEqual(valueOf(integer(0, 99)));
  });

  it('takes a literal range — `from 1 to 12`', () => {
    const { made } = trying((d) =>
      roleBinding('n', { role: 'integer' }, fromRange(1, 12), at('n'), d),
    );
    expect(made!.type).toEqual(valueOf(integer(1, 12)));
  });

  it('refuses a symbol role that has not said what it hears, naming what to write', () => {
    const { made, said } = trying((d) =>
      roleBinding('topic', { role: 'symbol' }, null, at('topic'), d),
    );
    expect(made).toBeNull();
    expect(said.join(' ')).toContain('has not said which options it hears');
  });

  it('refuses a symbol role narrowed by a range, and an integer one by a list', () => {
    const symbol = trying((d) =>
      roleBinding('topic', { role: 'symbol' }, fromRange(1, 12), at('topic'), d),
    );
    expect(symbol.made).toBeNull();
    expect(symbol.said.join(' ')).toContain('not a set of options');

    const number = trying((d) =>
      roleBinding('n', { role: 'integer' }, fromProperty(KNOWS), at('n'), d),
    );
    expect(number.made).toBeNull();
    expect(number.said.join(' ')).toContain('[Topic]');
  });

  it('refuses a symbol role narrowed by a list of something else', () => {
    const { made, said } = trying((d) =>
      roleBinding('topic', { role: 'symbol' }, fromProperty(SIZES), at('topic'), d),
    );
    expect(made).toBeNull();
    expect(said.join(' ')).toContain('[integer]');
  });

  it('refuses a range that counts downward', () => {
    const { made, said } = trying((d) =>
      roleBinding('n', { role: 'integer' }, fromRange(12, 1), at('n'), d),
    );
    expect(made).toBeNull();
    expect(said.join(' ')).toContain('A range counts upward');
  });

  it('refuses a `from` on a role filled by a thing, where there is nothing to narrow', () => {
    for (const declared of [
      { role: 'kind', kind: LOCKABLE },
      { role: 'open' },
    ] as RoleDeclaredAs[]) {
      const { made, said } = trying((d) =>
        roleBinding('target', declared, fromProperty(KNOWS), at('target'), d),
      );
      expect(made).toBeNull();
      expect(said.join(' ')).toContain('nothing for `from` to narrow');
    }
  });

  it('takes an integer role with no `from` as the whole integer range', () => {
    const { made, said } = trying((d) => roleBinding('n', { role: 'integer' }, null, at('n'), d));
    expect(said).toEqual([]);
    expect(made!.type).toEqual(valueOf(integer()));
  });
});

// --- handlers and hooks ---------------------------------------------------

describe('a handler binds the sender and the value it carries', () => {
  it('reads the spec’s own four handlers', () => {
    const shapes: [DeclaredMessage, (Ident | null)[], string[]][] = [
      [message('illuminating'), parameters('from', 'value'), ['from', 'value']],
      [message('gust'), parameters('from'), ['from']],
      [message('gust'), parameters(), []],
      [message('pong'), parameters(null, 'value'), ['value']],
    ];
    for (const [declared, written, names] of shapes) {
      const { made, said } = trying((d) => handlerParameters(declared, written, at('from'), d));
      expect(said, `:${declared.name}`).toEqual([]);
      expect(
        made.map((b) => b.name),
        `:${declared.name}`,
      ).toEqual(names);
    }
  });

  it('types `_` out of scope rather than binding it under another name', () => {
    const made = handlerParameters(
      message('pong'),
      parameters(null, 'value'),
      at('value'),
      new Diagnostics(),
    );
    expect(made).toHaveLength(1);
    expect(made[0]!.name).toBe('value');
    expect(made[0]!.type).toEqual(valueOf(integer()));
  });

  it('refuses a value on a message that carries none, naming both ways out', () => {
    const { made, said } = trying((d) =>
      handlerParameters(message('gust'), parameters('from', 'value'), at('value'), d),
    );
    expect(made.map((b) => b.name)).toEqual(['from']);
    expect(said.join(' ')).toContain('carries no value');
    expect(said.join(' ')).toContain('message :gust with');
  });

  it('refuses a third parameter, because there is no third thing to bind', () => {
    const { made, said } = trying((d) =>
      handlerParameters(
        message('illuminating'),
        parameters('from', 'value', 'item'),
        at('item'),
        d,
      ),
    );
    expect(made).toEqual([]);
    expect(said.join(' ')).toContain('and nothing else');
  });

  it('binds a hook’s previous value at the property that changed', () => {
    expect(wasBinding('was', KNOWS, at('was'), new Diagnostics())!.type).toEqual(
      valueOf(KNOWS.type),
    );
  });
});

describe('the engine’s own messages bind what they name', () => {
  it('is the six the spec lists, and only those', () => {
    expect(ENGINE_MESSAGES.map((m) => m.name)).toEqual([
      'entered',
      'left',
      'moved',
      'spawned',
      'tick',
      'woke',
    ]);
  });

  it('binds them under the names the spec writes', () => {
    const written: Record<string, string[]> = {
      entered: ['item', 'from'],
      left: ['item', 'to'],
      moved: ['from', 'to'],
      spawned: ['from'],
      tick: ['elapsed'],
      woke: ['elapsed'],
    };
    for (const message of ENGINE_MESSAGES) {
      const made = engineParameters(message, at('item'));
      expect(
        made.map((b) => b.name),
        message.name,
      ).toEqual(written[message.name]);
    }
  });

  it('types `elapsed` as an integer and everything else as an object', () => {
    for (const message of ENGINE_MESSAGES) {
      for (const binding of engineParameters(message, at('item'))) {
        const wanted = binding.name === 'elapsed' ? valueOf(integer()) : OPEN_OBJECT;
        expect(binding.type, `:${message.name} (${binding.name})`).toEqual(wanted);
      }
    }
  });

  it('knows one of its own from an authored one', () => {
    expect(engineMessage('tick')!.name).toBe('tick');
    expect(engineMessage('entered')!.parameters.map((p) => p.name)).toEqual(['item', 'from']);
    expect(engineMessage('illuminating')).toBeNull();
    expect(engineMessage('stir')).toBeNull();
  });
});

// --- scope ----------------------------------------------------------------

describe('a scope says what is in reach', () => {
  it('finds a name introduced into it', () => {
    const scope = Scope.root();
    expect(scope.introduce(selfBinding(VESSEL, at('self')), new Diagnostics())).toBe(true);
    expect(scope.lookup('self')!.type).toEqual(objectOf(VESSEL));
    expect(scope.lookup('actor')).toBeNull();
  });

  it('looks outward, so a block sees what surrounds it', () => {
    const outer = Scope.root();
    outer.introduce(selfBinding(VESSEL, at('self')), new Diagnostics());
    const inner = outer.inner();
    inner.introduce(letBinding('n', valueOf(integer()), at('n')), new Diagnostics());

    expect(inner.lookup('self')!.origin).toBe('self');
    expect(inner.lookup('n')!.origin).toBe('let');
    expect(inner.own('self')).toBeNull();
    expect(inner.own('n')!.origin).toBe('let');
    expect(outer.lookup('n')).toBeNull();
  });

  it('lists every name in reach, nearest first and each once', () => {
    const outer = Scope.root();
    outer.introduce(selfBinding(VESSEL, at('self')), new Diagnostics());
    outer.introduce(hereBinding(at('here')), new Diagnostics());
    const inner = outer.inner();
    inner.introduce(letBinding('n', valueOf(integer()), at('n')), new Diagnostics());

    expect(inner.names()).toEqual(['n', 'self', 'here']);
    expect(new Set(inner.names()).size).toBe(inner.names().length);
  });
});

describe('a scope goes as deep as blocks nest, and says so rather than dying', () => {
  // `lookup` and `names` walk the chain iteratively: by recursion, both
  // would throw `RangeError` out of a file whose whole job is producing
  // diagnostics. The depth here is far past anything a body will nest
  // and costs the suite a few milliseconds.
  const DEEP = 40_000;

  function nested(depth: number): Scope {
    const root = Scope.root();
    root.introduce(selfBinding(VESSEL, at('self')), new Diagnostics());
    root.introduce(hereBinding(at('here')), new Diagnostics());
    let scope = root;
    for (let i = 0; i < depth; i++) scope = scope.inner();
    return scope;
  }

  it('finds a name through a chain far deeper than a body could nest', () => {
    const deep = nested(DEEP);
    expect(deep.lookup('self')!.type).toEqual(objectOf(VESSEL));
    expect(deep.lookup('nothing')).toBeNull();
  });

  it('lists what is in reach through one, without throwing', () => {
    expect(nested(DEEP).names()).toEqual(['self', 'here']);
  });

  it('still refuses a shadow from the bottom of one', () => {
    const deep = nested(DEEP);
    const { made, said } = trying((d) =>
      deep.introduce(letBinding('self', valueOf(BOOLEAN), at('self')), d),
    );
    expect(made).toBe(false);
    expect(said.join(' ')).toContain('`self` already names');
  });
});

describe('shadowing is a compile error', () => {
  it('refuses a `let` taking the name of a role already in scope', () => {
    const scope = Scope.root();
    scope.introduce(setRoleBinding('tools', null, at('tools')), new Diagnostics());
    const { made, said } = trying((d) =>
      scope.introduce(letBinding('tools', valueOf(integer()), at('tools')), d),
    );
    expect(made).toBe(false);
    expect(said.join(' ')).toContain('already names');
    expect(said.join(' ')).toContain("this verb's role");
  });

  it('refuses it from a block inside the one that bound it', () => {
    const outer = Scope.root();
    outer.introduce(loopBinding('pot', VESSEL, at('pot')), new Diagnostics());
    const inner = outer.inner().inner();
    const { made, said } = trying((d) =>
      inner.introduce(letBinding('pot', valueOf(integer()), at('pot')), d),
    );
    expect(made).toBe(false);
    expect(said.join(' ')).toContain('loop variable');
  });

  it('refuses a role taking the name of something the engine supplies', () => {
    const scope = Scope.root();
    scope.introduce(selfBinding(VESSEL, at('self')), new Diagnostics());
    scope.introduce(actorBinding(VISITOR, at('actor')), new Diagnostics());
    for (const name of ['self', 'actor']) {
      const { made, said } = trying((d) =>
        scope.introduce(setRoleBinding(name, null, at(name)), d),
      );
      expect(made, name).toBe(false);
      expect(said.join(' '), name).toContain(`\`${name}\` already names`);
    }
  });

  it('leaves the scope as it was when it refuses, so the first name still means what it did', () => {
    const scope = Scope.root();
    scope.introduce(loopBinding('pot', VESSEL, at('pot')), new Diagnostics());
    scope.introduce(letBinding('pot', valueOf(BOOLEAN), at('pot')), new Diagnostics());
    expect(scope.lookup('pot')!.type).toEqual(objectOf(VESSEL));
    expect(scope.lookup('pot')!.origin).toBe('each');
  });

  it('says where the second one was written, not where the first was', () => {
    const scope = Scope.root();
    scope.introduce(hereBinding(at('here')), new Diagnostics());
    const { diagnostics } = trying((d) =>
      scope.introduce(letBinding('here', valueOf(BOOLEAN), at('here')), d),
    );
    expect(diagnostics.all).toHaveLength(1);
    expect(diagnostics.all[0]!.at.source).toBe(FILE);
  });

  it('allows the same name in two scopes neither of which contains the other', () => {
    const outer = Scope.root();
    const first = outer.inner();
    const second = outer.inner();
    expect(first.introduce(letBinding('n', valueOf(BOOLEAN), at('n')), new Diagnostics())).toBe(
      true,
    );
    expect(second.introduce(letBinding('n', valueOf(STRING), at('n')), new Diagnostics())).toBe(
      true,
    );
    expect(first.lookup('n')!.type).toEqual(valueOf(BOOLEAN));
    expect(second.lookup('n')!.type).toEqual(valueOf(STRING));
  });
});

describe('`is()` narrows, which is not shadowing', () => {
  it('reads a kind’s own properties through a binding of object type', () => {
    const scope = Scope.root();
    const thing = hereBinding(at('here'));
    scope.introduce(thing, new Diagnostics());
    expect(isObjectBinding(thing)).toBe(true);

    const branch = scope.narrowing(thingNamed(thing), VESSEL);
    expect(branch.lookup('here')!.type).toEqual(objectOf(VESSEL));
    expect(scope.lookup('here')!.type).toEqual(OPEN_OBJECT);
  });

  it('keeps everything about the binding but its kind', () => {
    const scope = Scope.root();
    const target = roleBinding('target', { role: 'open' }, null, at('target'), new Diagnostics())!;
    scope.introduce(target, new Diagnostics());
    const branch = scope.narrowing(thingNamed(target), LOCKABLE);
    const narrowed = branch.lookup('target')!;

    expect(narrowed.origin).toBe(target.origin);
    expect(narrowed.at).toBe(target.at);
    expect(narrowed.writable).toBe(target.writable);
    expect(narrowed.type).toEqual(objectOf(LOCKABLE));
  });

  it('lasts for the branch and no longer', () => {
    const scope = Scope.root();
    const self = selfBinding(VESSEL, at('self'));
    scope.introduce(self, new Diagnostics());
    const branch = scope.narrowing(thingNamed(self), CONTAINER);
    const deeper = branch.inner();

    expect(deeper.lookup('self')!.type).toEqual(objectOf(CONTAINER));
    expect(scope.lookup('self')!.type).toEqual(objectOf(VESSEL));
    expect(scope.names()).toEqual(['self']);
  });

  it('narrows a name once, not twice: the branch holds one binding for it', () => {
    const scope = Scope.root();
    const self = selfBinding(VESSEL, at('self'));
    scope.introduce(self, new Diagnostics());
    const branch = scope.narrowing(thingNamed(self), CONTAINER);
    expect(branch.names()).toEqual(['self']);
  });
});

describe('nothing ends without saying something', () => {
  // Every path in this file that declines to make a binding, each paired
  // with what it must still hand back. A path that returned null in
  // silence would be a body compiled against a binding nobody typed.
  const declining: { what: string; run: (d: Diagnostics) => unknown; keeps: number }[] = [
    {
      what: 'a symbol role that has not said what it hears',
      run: (d) => roleBinding('topic', { role: 'symbol' }, null, at('topic'), d),
      keeps: 0,
    },
    {
      what: 'a symbol role narrowed by a range',
      run: (d) => roleBinding('topic', { role: 'symbol' }, fromRange(1, 2), at('topic'), d),
      keeps: 0,
    },
    {
      what: 'a symbol role narrowed by a list of something else',
      run: (d) => roleBinding('topic', { role: 'symbol' }, fromProperty(SIZES), at('topic'), d),
      keeps: 0,
    },
    {
      what: 'an integer role narrowed by a list',
      run: (d) => roleBinding('n', { role: 'integer' }, fromProperty(KNOWS), at('n'), d),
      keeps: 0,
    },
    {
      what: 'a range that counts downward',
      run: (d) => roleBinding('n', { role: 'integer' }, fromRange(9, 1), at('n'), d),
      keeps: 0,
    },
    {
      what: 'a `from` on an open role',
      run: (d) => roleBinding('target', { role: 'open' }, fromProperty(KNOWS), at('target'), d),
      keeps: 0,
    },
    {
      what: 'a `from` on a kind role',
      run: (d) =>
        roleBinding('target', { role: 'kind', kind: LOCKABLE }, fromRange(1, 2), at('target'), d),
      keeps: 0,
    },
    {
      what: 'a value bound on a message that carries none',
      run: (d) => handlerParameters(message('gust'), parameters('from', 'value'), at('value'), d),
      keeps: 1,
    },
    {
      what: 'a third handler parameter',
      run: (d) =>
        handlerParameters(
          message('illuminating'),
          parameters('from', 'value', 'item'),
          at('item'),
          d,
        ),
      keeps: 0,
    },
  ];

  it('keeps only what it could type, and says why for the rest', () => {
    for (const { what, run, keeps } of declining) {
      const diagnostics = new Diagnostics();
      const made = run(diagnostics);
      const kept = made === null ? 0 : Array.isArray(made) ? made.length : 1;
      expect(kept, what).toBe(keeps);
      expect(diagnostics.refusals.length, `${what}: said nothing`).toBe(1);
    }
  });

  it('names a place and tells a non-programmer what to write instead', () => {
    for (const { what, run } of declining) {
      const diagnostics = new Diagnostics();
      run(diagnostics);
      for (const refusal of diagnostics.refusals) {
        expect(refusal.message, what).not.toBe('');
        expect(refusal.remedy ?? '', `${what}: offered no remedy`).not.toBe('');
        expect(locationOf(refusal.at), what).toMatch(/^shop\.sprout:\d+:\d+$/);
      }
    }
  });
});
