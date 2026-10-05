import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '../bundle/limits.js';
import {
  actorBinding,
  letBinding,
  objectOf,
  OPEN_OBJECT,
  Scope,
  selfBinding,
  setOf,
  type BindingType,
} from '../check/bindings.js';
import { typeOf } from '../check/check.js';
import type { KindLookup, KindRef } from '../declare/kinds.js';
import type { Named as PlacedName } from '../declare/names.js';
import type { Node } from '../source/nodes.js';
import type { Expr } from '../syntax/ast.js';
import { compiledWorld } from '../fixtures/bundle.js';
import { expression } from '../fixtures/check.js';
import { chooser } from '../fixtures/parse.js';
import { eventTurn, LAMP, LANTERN } from '../fixtures/events.js';
import { NameOutOfRange } from './named.js';
import { Diagnostics } from '../source/diagnostics.js';
import { SourceFile } from '../source/source.js';
import { Budget, BudgetExhausted } from './budget.js';
import { catalogueOf } from './catalogue.js';
import { Draft } from './draft.js';
import { Draws } from './draws.js';
import {
  boundObject,
  branchFrame,
  evaluate,
  evaluateCondition,
  IntegerOverflow,
  type Evaluated,
  type Frame,
} from './evaluate.js';
import { declaredId, type InstanceId } from './ids.js';
import * as D from '../fixtures/darkness.js';
import { SproutList } from './lists.js';
import { initialState } from './load.js';
import type { PassRule } from './range.js';
import { newInstance } from './state.js';

const CAPS = DEFAULT_LIMITS.caps;

/**
 * A shop with something of every shape to read: a shelf holding a jar
 * and a lidded cup, a list, a string, remembered properties, and a
 * world's own `Place` beside the standard library's.
 */
const bundle = compiledWorld('printers_shop', {
  'printers_shop.sprout': [
    'world printers_shop is sprout.World { contains visitors are Person visitors arrive at hall',
    '  object hall is Room {',
    '    object shelf is Shelf {',
    '      object jar is Jar',
    '      object cup is Lidded',
    '    }',
    '  }',
    '  object nook is Place',
    '}',
    'enum Glaze { none, shino, tenmoku }',
    'kind Place { contains actors }',
    'kind Room is sprout.Place { :lit true }',
    'kind Shelf { contains :capacity 3 min 0 max 9 }',
    'kind Jar {',
    '  :glaze Glaze default shino',
    '  :fill 3 min 0 max 9',
    '  :wards [Glaze] default [shino, tenmoku]',
    '  :label string default "salt"',
    '  remembers { :seen false :visits 2 min 0 max 9 }',
    '}',
    'kind Lidded is Jar { :lid true }',
    'kind Person is sprout.Visitor { :score 0 }',
    '',
  ].join('\n'),
});
const catalogue = catalogueOf(bundle, CAPS);

const KINDS: KindLookup = catalogue.lookup;
const kindNamed = (name: string, library = 'printers_shop'): KindRef => {
  const kind = KINDS.qualified(library, name);
  if (kind === null) throw new Error(`the fixture has no ${library}.${name}`);
  return kind;
};

const id = (...path: string[]): InstanceId => declaredId('printers_shop', path);
const HALL = id('hall');
const NOOK = id('nook');
const SHELF = id('hall', 'shelf');
const JAR = id('hall', 'shelf', 'jar');
const CUP = id('hall', 'shelf', 'cup');

/** A fresh turn over the new world, with a visitor standing in the hall. */
function turn(): { draft: Draft; visitor: InstanceId } {
  const draft = new Draft(initialState(catalogue));
  const visitor = draft.mint();
  draft.add(
    newInstance(
      visitor,
      { from: 'visitor' },
      catalogue.visitorKind!,
      HALL,
      draft.nextSerial(),
      CAPS,
    ),
  );
  return { draft, visitor };
}

const SPAN = new SourceFile('frame.sprout', 'x').span(0, 1);

interface Named {
  readonly bound: Evaluated;
  readonly type: BindingType;
}

interface Body {
  readonly self: InstanceId;
  readonly names?: Readonly<Record<string, Named>>;
  readonly library?: string;
  readonly budget?: Budget;
  readonly draft?: Draft;
  readonly draws?: Draws;
  /** What the turn's containers let through; every one passes where none is given. */
  readonly passes?: PassRule<InstanceId>;
}

/**
 * Evaluate `text` in a body of `self`, after the checker has accepted it
 * against the same names typed as the frame binds them: what `typeOf`
 * accepts is what `evaluate` must handle.
 */
function run(text: string, body: Body): Evaluated {
  const draft = body.draft ?? turn().draft;
  const library = body.library ?? 'printers_shop';
  const selfKind = draft.instance(body.self)!.kind;
  const scope = Scope.root();
  const diagnostics = new Diagnostics();
  scope.introduce(selfBinding(selfKind, SPAN), diagnostics);
  const names = body.names ?? {};
  for (const [name, { type }] of Object.entries(names)) {
    const binding =
      name === 'actor' && type.binds === 'object' && type.kind !== null
        ? actorBinding(type.kind, SPAN)
        : letBinding(name, type, SPAN);
    scope.introduce(binding, diagnostics);
  }
  const expr = expression(text);
  const type = typeOf(expr, { scope, kinds: KINDS, from: library, self: selfKind, diagnostics });
  if (type === null || diagnostics.refusals.length > 0) {
    throw new Error(
      `the checker refuses \`${text}\`: ${diagnostics.refusals.map((d) => d.message).join(' ')}`,
    );
  }
  const frame: Frame = {
    state: draft,
    kinds: KINDS,
    library,
    self: body.self,
    bindings: new Map(Object.entries(names).map(([name, { bound }]) => [name, bound])),
    budget: body.budget ?? new Budget(DEFAULT_LIMITS.budgets),
    caps: CAPS,
    names: new Map(),
    passes: body.passes ?? (() => true),
    ...(body.draws === undefined ? {} : { draws: body.draws }),
  };
  return evaluate(expr, frame);
}

/** The value `text` evaluates to; an object or a set is a failure of the case. */
function valueOf(text: string, body: Body): unknown {
  const evaluated = run(text, body);
  if (evaluated.binds !== 'value') throw new Error(`\`${text}\` is ${evaluated.binds}`);
  return evaluated.value instanceof SproutList ? evaluated.value.elements : evaluated.value;
}

/** A frame over `draft` for the jar, with nothing bound, for an expression the checker is not asked about. */
const frame = (budget: Budget, draft: Draft): Frame => ({
  state: draft,
  kinds: KINDS,
  library: 'printers_shop',
  self: JAR,
  bindings: new Map(),
  budget,
  caps: CAPS,
  names: new Map(),
  passes: () => true,
});

const thing = (at: InstanceId, kind: KindRef | null = null): Named => ({
  bound: boundObject(at),
  type: kind === null ? OPEN_OBJECT : objectOf(kind),
});

describe('literals and bindings', () => {
  it('reads a literal as the value it writes', () => {
    expect(valueOf('true', { self: JAR })).toBe(true);
    expect(valueOf('7', { self: JAR })).toBe(7);
    expect(valueOf('"salt"', { self: JAR })).toBe('salt');
  });

  it('reads `self` as the object whose body it is, and any other name as the frame binds it', () => {
    expect(run('self', { self: CUP })).toEqual({ binds: 'object', id: CUP });
    expect(run('pot', { self: CUP, names: { pot: thing(JAR) } })).toEqual({
      binds: 'object',
      id: JAR,
    });
  });

  it('asks with `bound` whether the frame binds the name, and charges it as one node', () => {
    const { draft } = turn();
    const budget = new Budget(DEFAULT_LIMITS.budgets);
    const given: Frame = {
      ...frame(budget, draft),
      bindings: new Map([['tool', boundObject(CUP)]]),
    };
    expect(evaluateCondition(expression('bound tool'), given)).toBe(true);
    expect(evaluateCondition(expression('bound topic'), given)).toBe(false);
    expect(evaluateCondition(expression('!bound tool'), given)).toBe(false);
    // `bound tool`, `bound topic`, and `!` over `bound tool`.
    expect(budget.spentSteps).toBe(4);
  });
});

describe('the operators, as the checker types them', () => {
  it('adds and subtracts whole numbers, and negates one', () => {
    expect(valueOf('self.get(:fill) + 4 - 2', { self: JAR })).toBe(5);
    expect(valueOf('-self.get(:fill)', { self: JAR })).toBe(-3);
    expect(valueOf('1 - 2 - 3', { self: JAR })).toBe(-4);
  });

  it('compares whole numbers at each edge', () => {
    const at = (text: string) => valueOf(text, { self: JAR });
    expect([at('3 < 3'), at('3 <= 3'), at('3 > 3'), at('3 >= 3')]).toEqual([
      false,
      true,
      false,
      true,
    ]);
    expect([at('2 < 3'), at('4 <= 3'), at('4 > 3'), at('2 >= 3')]).toEqual([
      true,
      false,
      true,
      false,
    ]);
  });

  it('binds in the conventional order: `!` over `<` over `==` over `&&` over `||`', () => {
    expect(valueOf('1 + 2 < 4 && !false', { self: JAR })).toBe(true);
    expect(valueOf('true || false && false', { self: JAR })).toBe(true);
    expect(valueOf('1 < 2 == 2 < 1', { self: JAR })).toBe(false);
  });

  it('compares an option on either side with what the property holds', () => {
    expect(valueOf('self.get(:glaze) == :shino', { self: JAR })).toBe(true);
    expect(valueOf(':shino == self.get(:glaze)', { self: JAR })).toBe(true);
    expect(valueOf('self.get(:glaze) != :tenmoku', { self: JAR })).toBe(true);
  });

  it('compares strings and booleans by value', () => {
    expect(valueOf('self.get(:label) == "salt"', { self: JAR })).toBe(true);
    expect(valueOf('self.get(:label) != "sugar"', { self: JAR })).toBe(true);
    expect(valueOf('self.get(:lid) == true', { self: CUP })).toBe(true);
  });

  it('compares two objects by identity, whatever their kinds', () => {
    const names = { pot: thing(JAR), lidded: thing(CUP, kindNamed('Lidded')) };
    expect(valueOf('pot == self', { self: JAR, names })).toBe(true);
    expect(valueOf('pot == lidded', { self: JAR, names })).toBe(false);
    expect(valueOf('lidded != self', { self: JAR, names })).toBe(true);
  });

  it('agrees with ordinary arithmetic and logic over generated expressions', () => {
    // Integers of 0 to 20, depth at most four, so nothing leaves the range.
    const choose = chooser(22);
    const integer = (depth: number): string => {
      if (depth === 0 || choose.below(3) === 0) return String(choose.below(21));
      const pick = choose.below(3);
      if (pick === 0) return `-(${integer(depth - 1)})`;
      return `${integer(depth - 1)} ${pick === 1 ? '+' : '-'} (${integer(depth - 1)})`;
    };
    const boolean = (depth: number): string => {
      if (depth === 0 || choose.below(4) === 0) {
        const op = choose.one(['<', '<=', '>', '>=', '==', '!=']);
        return `${integer(2)} ${op} ${integer(2)}`;
      }
      const pick = choose.below(3);
      if (pick === 0) return `!(${boolean(depth - 1)})`;
      return `(${boolean(depth - 1)}) ${pick === 1 ? '&&' : '||'} (${boolean(depth - 1)})`;
    };
    for (let round = 0; round < 200; round++) {
      const text = round % 2 === 0 ? integer(4) : boolean(4);
      const expected: unknown = new Function(`return ${text.replaceAll('==', '===')};`)();
      expect(valueOf(text, { self: JAR }), text).toBe(expected);
    }
  });
});

describe('the readings', () => {
  it('`get` reads the instance as it stands in the turn, not its default', () => {
    const { draft } = turn();
    const jar = draft.instance(JAR)!;
    draft.write({ ...jar, properties: new Map([...jar.properties, ['fill', 8]]) });
    expect(valueOf('self.get(:fill)', { self: JAR, draft })).toBe(8);
    expect(valueOf('self.get(:fill)', { self: CUP, draft })).toBe(3);
  });

  it('`get` reads through a binding narrowed to a kind', () => {
    const names = { lidded: thing(CUP, kindNamed('Lidded')) };
    expect(valueOf('lidded.get(:lid)', { self: JAR, names })).toBe(true);
  });

  it('`count` is what a container directly holds, and `count(K)` those composing `K`', () => {
    expect(valueOf('self.count', { self: SHELF })).toBe(2);
    expect(valueOf('self.count(Lidded)', { self: SHELF })).toBe(1);
    expect(valueOf('self.count(Jar)', { self: SHELF })).toBe(2);
    // The hall holds the shelf, the visitor and nothing deeper.
    expect(valueOf('self.count', { self: HALL })).toBe(2);
    expect(valueOf('self.count(Jar)', { self: HALL })).toBe(0);
  });

  it('`count` on a list is how many it holds, and `includes` whether it holds one', () => {
    expect(valueOf('self.get(:wards).count', { self: JAR })).toBe(2);
    expect(valueOf('self.get(:wards).includes(:tenmoku)', { self: JAR })).toBe(true);
    expect(valueOf('self.get(:wards).includes(:none)', { self: JAR })).toBe(false);
  });

  it('`holds` is true only of what is directly inside', () => {
    const names = { pot: thing(JAR) };
    expect(valueOf('self.holds(pot)', { self: SHELF, names })).toBe(true);
    expect(valueOf('self.holds(pot)', { self: HALL, names })).toBe(false);
  });

  it('`count`, `count(K)` and `holds` see only what is in range of `self`', () => {
    const shut: PassRule<InstanceId> = (container) => container !== SHELF;
    const names = { shelf: thing(SHELF, kindNamed('Shelf')), pot: thing(JAR) };
    // From the nook, a shelf that lets nothing through holds nothing.
    expect(valueOf('shelf.count', { self: NOOK, names, passes: shut })).toBe(0);
    expect(valueOf('shelf.count(Jar)', { self: NOOK, names, passes: shut })).toBe(0);
    expect(valueOf('shelf.holds(pot)', { self: NOOK, names, passes: shut })).toBe(false);
    // The same shelf open is seen as it is.
    expect(valueOf('shelf.count', { self: NOOK, names })).toBe(2);
    expect(valueOf('shelf.holds(pot)', { self: NOOK, names })).toBe(true);
    // The shelf, shut, still sees all it holds: an object reaches its own contents.
    expect(valueOf('self.count', { self: SHELF, passes: shut })).toBe(2);
    expect(valueOf('self.count(Lidded)', { self: SHELF, passes: shut })).toBe(1);
    expect(valueOf('self.holds(pot)', { self: SHELF, names, passes: shut })).toBe(true);
  });

  it('another actor’s hands, which pass nothing, count nothing; its own count all', () => {
    const { draft, visitor } = turn();
    draft.place(CUP, visitor);
    const hands: PassRule<InstanceId> = (container) => container !== visitor;
    const actor = thing(visitor, catalogue.visitorKind!);
    const names = { actor, cup: thing(CUP) };
    expect(valueOf('actor.count', { self: HALL, names, draft, passes: hands })).toBe(0);
    expect(valueOf('actor.holds(cup)', { self: HALL, names, draft, passes: hands })).toBe(false);
    expect(valueOf('self.count', { self: visitor, draft, passes: hands })).toBe(1);
    expect(valueOf('self.holds(cup)', { self: visitor, names, draft, passes: hands })).toBe(true);
  });

  it('`is` asks whether the instance composes the kind, nominally', () => {
    const names = { pot: thing(JAR), lidded: thing(CUP) };
    expect(valueOf('lidded.is(Lidded)', { self: JAR, names })).toBe(true);
    expect(valueOf('lidded.is(Jar)', { self: JAR, names })).toBe(true);
    expect(valueOf('pot.is(Lidded)', { self: JAR, names })).toBe(false);
    expect(valueOf('pot.is(sprout.Actor)', { self: JAR, names })).toBe(false);
  });

  it('`is` resolves a bare kind from the library that wrote the body, then the standard library', () => {
    const names = { hall: thing(HALL), nook: thing(NOOK) };
    const from = (library: string, text: string) => valueOf(text, { self: JAR, names, library });
    // The world's own `Place` hides `sprout.Place` in the world's bodies.
    expect(from('printers_shop', 'nook.is(Place)')).toBe(true);
    expect(from('printers_shop', 'hall.is(Place)')).toBe(false);
    // In the standard library's, `Place` is its own.
    expect(from('sprout', 'hall.is(Place)')).toBe(true);
    expect(from('sprout', 'nook.is(Place)')).toBe(false);
    // Written with its library, a kind means the same from anywhere.
    expect(from('printers_shop', 'hall.is(sprout.Place)')).toBe(true);
  });

  it('`recall` reads what `self` remembers about the actor, or the declared default', () => {
    const { draft, visitor } = turn();
    const names = { actor: thing(visitor, catalogue.visitorKind!) };
    expect(valueOf('actor.recall(:seen)', { self: JAR, names, draft })).toBe(false);
    expect(valueOf('actor.recall(:visits) + 1', { self: JAR, names, draft })).toBe(3);

    const cup = draft.instance(CUP)!;
    draft.write({ ...cup, memory: new Map([[visitor, new Map([['seen', true]])]]) });
    // What the cup remembers is the cup's: the jar's memory of the visitor is untouched.
    expect(valueOf('actor.recall(:seen)', { self: CUP, names, draft })).toBe(true);
    expect(valueOf('actor.recall(:seen)', { self: JAR, names, draft })).toBe(false);
  });

  it('reads a set role: how many, how many of a kind, and whether it holds one', () => {
    const tools: Named = { bound: { binds: 'set', ids: [JAR, CUP] }, type: setOf(null) };
    const names = { tools, pot: thing(JAR), shelf: thing(SHELF) };
    expect(valueOf('tools.count', { self: JAR, names })).toBe(2);
    expect(valueOf('tools.count(Lidded)', { self: JAR, names })).toBe(1);
    expect(valueOf('tools.includes(pot)', { self: JAR, names })).toBe(true);
    expect(valueOf('tools.includes(shelf)', { self: JAR, names })).toBe(false);
  });
});

describe('what a turn is charged', () => {
  it('charges one step for every expression node evaluated', () => {
    const budget = new Budget(DEFAULT_LIMITS.budgets);
    // `>`, `+`, the `get`, `self`, `:fill`, `1` and `2`.
    run('self.get(:fill) + 1 > 2', { self: JAR, budget });
    expect(budget.spentSteps).toBe(7);
  });

  it('does not evaluate, or charge for, the right of `&&` or `||` its left decides', () => {
    const decided = new Budget(DEFAULT_LIMITS.budgets);
    expect(valueOf('false && self.get(:fill) > 1', { self: JAR, budget: decided })).toBe(false);
    expect(decided.spentSteps).toBe(2);

    const open = new Budget(DEFAULT_LIMITS.budgets);
    expect(valueOf('true && self.get(:fill) > 1', { self: JAR, budget: open })).toBe(true);
    expect(open.spentSteps).toBe(7);

    const either = new Budget(DEFAULT_LIMITS.budgets);
    expect(valueOf('true || self.get(:fill) > 1', { self: JAR, budget: either })).toBe(true);
    expect(either.spentSteps).toBe(2);
  });

  it('throws `BudgetExhausted` at the step past the bound, and not before', () => {
    const at = (steps: number) => new Budget({ ...DEFAULT_LIMITS.budgets, steps }, 'command');
    expect(() => run('self.get(:fill) + 1 > 2', { self: JAR, budget: at(6) })).toThrow(
      BudgetExhausted,
    );
    expect(run('self.get(:fill) + 1 > 2', { self: JAR, budget: at(7) })).toEqual({
      binds: 'value',
      value: true,
    });
  });

  it('walks a spine longer than any stack without recursing down it', () => {
    const terms = 20_000;
    const { draft } = turn();
    const text = Array.from({ length: terms }, () => '1').join(' + ');
    const budget = new Budget({ ...DEFAULT_LIMITS.budgets, steps: 2 * terms });
    expect(evaluate(expression(text), frame(budget, draft))).toEqual({
      binds: 'value',
      value: terms,
    });
    expect(budget.spentSteps).toBe(2 * terms - 1);
  });
});

describe('a draw', () => {
  it('draws `random(n)` from the frame’s stream, and `chance(n)` true where the draw is 0', () => {
    const draws = new Draws(7);
    const again = new Draws(7);
    const drawn = [6, 6, 2, 100].map((n) => valueOf(`random(${n})`, { self: JAR, draws }));
    expect(drawn).toEqual([6, 6, 2, 100].map((n) => again.below(n)));
    const chances = new Draws(11);
    const looked = new Draws(11);
    for (let i = 0; i < 20; i++) {
      expect(valueOf('chance(3)', { self: JAR, draws: chances })).toBe(looked.below(3) === 0);
    }
  });

  it('gives the same values for the same seed, however often it is run', () => {
    const run = (seed: number) => {
      const draws = new Draws(seed);
      return Array.from({ length: 12 }, () =>
        valueOf('random(20) + 1 > 10 && chance(2)', { self: JAR, draws }),
      );
    };
    expect(run(5)).toEqual(run(5));
    expect(run(5).concat(run(6))).toContain(true);
  });

  it('is one step, as any leaf is, and draws once however it is written', () => {
    const budget = new Budget(DEFAULT_LIMITS.budgets);
    const draws = new Draws(3);
    valueOf('random(6)', { self: JAR, budget, draws });
    expect(budget.spentSteps).toBe(1);
    expect(draws.drawn).toBe(1);
  });

  it('leaves the right of `&&` undrawn where the left decides', () => {
    const draws = new Draws(3);
    expect(valueOf('false && chance(2)', { self: JAR, draws })).toBe(false);
    expect(draws.drawn).toBe(0);
  });

  it('stays within its bound for any bound and seed written', () => {
    const c = chooser(19);
    for (let i = 0; i < 200; i++) {
      const n = 1 + c.below(i % 2 === 0 ? 12 : 2_147_483_647);
      const value = valueOf(`random(${n})`, { self: JAR, draws: new Draws(c.below(1_000_000)) });
      expect(value, `random(${n})`).toBeGreaterThanOrEqual(0);
      expect(value, `random(${n})`).toBeLessThan(n);
    }
  });
});

describe('what cannot be evaluated', () => {
  it('faults when `+` or `-` leaves the integer range, and not at its edge', () => {
    expect(() => valueOf('2147483647 + 1', { self: JAR })).toThrow(IntegerOverflow);
    expect(() => valueOf('0 - 2147483647 - 2', { self: JAR })).toThrow(IntegerOverflow);
    expect(valueOf('0 - 2147483647 - 1', { self: JAR })).toBe(-2147483648);
    expect(valueOf('-2147483648', { self: JAR })).toBe(-2147483648);
  });

  it('throws an engine error, not a fault, for what the checker refuses', () => {
    const { draft } = turn();
    const at = (text: string) => () =>
      evaluate(expression(text), frame(new Budget(DEFAULT_LIMITS.budgets), draft));
    for (const text of ['nobody', 'chance(2)', '1 && true', 'self == 1', 'self.set(:fill, 1)']) {
      expect(at(text), text).toThrow(/reached the evaluator, which the checker refuses/);
    }
  });

  it('never coerces: an integer is not a condition', () => {
    const { draft } = turn();
    const condition = () =>
      evaluateCondition(
        expression('self.get(:fill)'),
        frame(new Budget(DEFAULT_LIMITS.budgets), draft),
      );
    expect(condition).toThrow(/read as true or false/);
  });
});

describe('an identifier in an expression', () => {
  /** `text`, whose one name the checker resolved to the declared `path`, evaluated in the lamp's body. */
  function throughName(text: string, path: readonly string[]): Evaluated {
    const one = eventTurn();
    const expr = expression(text);
    const name = expr.kind === 'binding' ? expr.name : null;
    if (name === null) throw new Error(`\`${text}\` is not a name`);
    return evaluate(expr, {
      state: one.draft,
      kinds: one.catalogue.lookup,
      library: 'bus',
      self: LAMP,
      bindings: new Map(),
      budget: one.budget,
      caps: one.catalogue.caps,
      names: new Map([[name, { names: 'declared', path, kind: null }]]),
      passes: one.passes,
    });
  }

  it('is the object the checker resolved it to, where it is in range', () => {
    expect(throughName('lantern', ['hall', 'lantern'])).toEqual(boundObject(LANTERN));
  });

  it('faults where what it names is out of range', () => {
    expect(() => throughName('stray', ['yard', 'stray'])).toThrow(NameOutOfRange);
  });
});

describe('a condition that narrows a name in a kind’s body', () => {
  /**
   * A frame over the lantern's body, where `lamp` is whatever is nearest
   * it, and `mine` is bound. As the checker records it, only a `lamp` that
   * `is()` tests is a name; one read where that narrowing holds is a binding.
   */
  function lanternFrame(text: string): { condition: Expr; frame: Frame; draft: Draft } {
    const one = eventTurn();
    const condition = expression(text);
    const names = new Map<Node, PlacedName>();
    const placed: PlacedName = {
      names: 'placed',
      steps: [{ name: 'lamp', madeOf: [] }],
      candidates: [],
    };
    const tested = (expr: Expr): void => {
      if (expr.kind === 'binary') [expr.left, expr.right].forEach(tested);
      if (expr.kind === 'unary') tested(expr.operand);
      const receiver = expr.kind === 'call' && expr.method.text === 'is' ? expr.receiver : null;
      if (receiver?.kind === 'binding' && receiver.name.text === 'lamp') {
        names.set(receiver.name, placed);
      }
    };
    tested(condition);
    return {
      condition,
      draft: one.draft,
      frame: {
        state: one.draft,
        kinds: one.catalogue.lookup,
        library: 'bus',
        self: LANTERN,
        bindings: new Map([['mine', boundObject(LAMP)]]),
        budget: one.budget,
        caps: one.catalogue.caps,
        names,
        passes: one.passes,
      },
    };
  }

  it('binds the name to what it reaches now, for the branch it guards', () => {
    const { condition, frame } = lanternFrame('lamp.is(Lamp)');
    const inner = branchFrame(condition, frame)!;
    expect(inner).not.toBe(frame);
    expect(inner.bindings.get('lamp')).toEqual(boundObject(LAMP));
    expect(inner.bindings.get('mine')).toEqual(boundObject(LAMP));
    expect(frame.bindings.has('lamp')).toBe(false);
  });

  it('faults where the name reaches nothing, as any read through it does', () => {
    const { condition, frame, draft } = lanternFrame('lamp.is(Lamp)');
    draft.place(LAMP, draft.world);
    expect(() => branchFrame(condition, frame)).toThrow(NameOutOfRange);
  });

  it('opens no branch where the condition does not hold', () => {
    for (const text of ['!lamp.is(Lamp)', 'mine.is(Lamp) && 1 > 2', '1 > 2 && lamp.is(Lamp)']) {
      const { condition, frame } = lanternFrame(text);
      expect(branchFrame(condition, frame), text).toBeNull();
    }
  });

  it('leaves the frame as it is for a binding, for `self`, and for any other condition', () => {
    for (const text of ['mine.is(Lamp)', 'self.is(Lantern)', 'mine.count >= 0', '!self.is(Lamp)']) {
      const { condition, frame } = lanternFrame(text);
      expect(branchFrame(condition, frame), text).toBe(frame);
    }
  });

  it('reads the right of `&&` with the name its left narrowed bound, and binds it for the branch', () => {
    // The right's `lamp` is a binding where the left holds, so it reads only through the frame.
    const { condition, frame } = lanternFrame('lamp.is(Lamp) && lamp == mine');
    const inner = branchFrame(condition, frame)!;
    expect(inner.bindings.get('lamp')).toEqual(boundObject(LAMP));
    expect(evaluateCondition(condition, frame)).toBe(true);
    expect(frame.bindings.has('lamp')).toBe(false);
  });

  it('binds a name tested by any operand of a chain of `&&`', () => {
    const { condition, frame } = lanternFrame('1 < 2 && mine.is(Lamp) && lamp.is(Lamp)');
    expect(branchFrame(condition, frame)!.bindings.get('lamp')).toEqual(boundObject(LAMP));
  });

  it('never reads an operand to the right of one that failed, so a name there cannot fault', () => {
    const { condition, frame, draft } = lanternFrame('1 > 2 && lamp.is(Lamp)');
    draft.place(LAMP, draft.world);
    expect(branchFrame(condition, frame)).toBeNull();
    expect(evaluateCondition(condition, frame)).toBe(false);
  });

  it('spends a step for every `&&`, as for any other node', () => {
    const spent = (text: string): number => {
      const { condition, frame } = lanternFrame(text);
      const before = frame.budget.spentSteps;
      evaluate(condition, frame);
      return frame.budget.spentSteps - before;
    };
    expect(spent('1 < 2 && 2 < 3')).toBe(spent('1 < 2 || 2 < 3') + 3);
    expect(spent('1 > 2 && 2 < 3')).toBe(spent('1 > 2 || 2 < 3') - 3);
  });
});

describe('`sees`, in a place’s `lit`', () => {
  /** What `self.sees(sprout.LightSource, :lit)` is, asked of the cellar in `state`. */
  const sees = (state: ReturnType<typeof D.dark>): Evaluated => {
    const context = D.darkContext(state);
    return evaluate(expression('self.sees(sprout.LightSource, :lit)'), {
      state: context.state,
      kinds: D.DARK_CATALOGUE.lookup,
      library: 'dark',
      self: D.CELLAR,
      bindings: new Map(),
      budget: context.budget,
      caps: D.DARK_CATALOGUE.caps,
      names: D.DARK_CATALOGUE.names,
      passes: context.passes,
    });
  };

  it('is whether something the place sees composes the kind and holds the property true', () => {
    expect(sees(D.dark())).toEqual({ binds: 'value', value: false });
    expect(sees(D.dark(undefined, [[D.LAMP, 'lit', true]], [[D.MARTA, D.LAMP]]))).toEqual({
      binds: 'value',
      value: true,
    });
    // A lit lamp in the kitchen is not seen from the cellar.
    expect(sees(D.dark(undefined, [[D.LAMP, 'lit', true]]))).toEqual({
      binds: 'value',
      value: false,
    });
  });
});
