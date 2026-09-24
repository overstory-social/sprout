// A description, derived (the spec's Prose; Verbs › Engine verbs; The
// runtime › Turns, The view). A thing's `describe` runs with `self` the
// thing, `actor` whoever is looking and `here` their place, and gives its
// words with `text`, each one line in the order run; it only reads, so it
// runs the same in a write turn, after the queue, and in a poll, and it
// draws nothing. What a line says is carried unrendered, for `prose/` to
// render; where the lines render nothing, or the thing has no describe,
// the world's `unremarkable` is read in their place, so looking at
// anything always reads something.

import type { Block, IfStatement, Statement } from '../syntax/ast.js';
import { libraryOf } from '../declare/enums.js';
import { speechOf, type Speech } from './body.js';
import type { Budget } from './budget.js';
import type { Catalogue } from './catalogue.js';
import { engineLine } from './engine-lines.js';
import {
  boundObject,
  evaluate,
  evaluateCondition,
  type Evaluated,
  type Frame,
} from './evaluate.js';
import type { InstanceId } from './ids.js';
import type { PassRule } from './range.js';
import type { Said } from './reading.js';
import type { StateReader } from './state.js';

/** What describing reads: the turn's state or the committed one, the bundle, the meter and the pass rules. */
export interface DescribeContext {
  readonly state: StateReader;
  readonly catalogue: Catalogue;
  readonly budget: Budget;
  readonly passes: PassRule<InstanceId>;
}

/** What one reader reads of a thing when they look at it. */
export interface Description {
  /** The thing described. */
  readonly of: InstanceId;
  /** Who is looking, the one reader. */
  readonly to: InstanceId;
  /** Each `text` its describe ran, in order, from the thing, as a `described` line. */
  readonly lines: readonly Said[];
  /** The world's `unremarkable`, with `thing` the thing: read where the lines render nothing. */
  readonly unremarkable: Said;
}

/** The world's line for a thing with nothing to say for itself (the spec's Engine verbs). */
const UNREMARKABLE = 'unremarkable';

/** The stock line, in fixed words, for a world whose standard library leaves `unremarkable` out. */
const STOCK = 'There is nothing special about {thing}.';

/**
 * What `actor` reads looking at `thing`: its describe run, each statement
 * a step and each expression as a body's is charged. An actor who is
 * away looks at nothing, which is the engine's defect.
 */
export function describeFor(
  thing: InstanceId,
  actor: InstanceId,
  context: DescribeContext,
): Description {
  const { state } = context;
  const instance = state.instance(thing);
  if (instance === undefined) throw new Error(`\`${thing}\` is described, and is not an instance.`);
  const here = state.instance(actor)?.container ?? null;
  if (here === null) throw new Error(`\`${actor}\` is away, and an away visitor looks at nothing.`);

  const world = state.instance(state.world);
  const passage = world?.kind.passages.get(UNREMARKABLE);
  const unremarkable: Said = {
    effect: 'described',
    to: [actor],
    by: state.world,
    speaker: null,
    said: passage === undefined ? engineLine(STOCK) : { passage },
    bindings: new Map([['thing', boundObject(thing)]]),
  };

  const describe = instance.kind.describe;
  if (describe === null) return { of: thing, to: actor, lines: [], unremarkable };
  const frame: Frame = {
    state,
    kinds: context.catalogue.lookup,
    library: libraryOf(describe.origin),
    self: thing,
    bindings: new Map<string, Evaluated>([
      ['actor', boundObject(actor)],
      ['here', boundObject(here)],
    ]),
    budget: context.budget,
    caps: context.catalogue.caps,
    names: context.catalogue.names,
    passes: context.passes,
  };
  const lines: Said[] = [];
  runBlock(describe.declaration.body, frame, (said, bindings) =>
    lines.push({ effect: 'described', to: [actor], by: thing, speaker: null, said, bindings }),
  );
  return { of: thing, to: actor, lines, unremarkable };
}

/** Where each `text` goes, with every name in scope where it ran. */
type Texts = (said: Speech, bindings: ReadonlyMap<string, Evaluated>) => void;

/** A block's statements in order, in a scope of its own: a `let` lives to its `}`. */
function runBlock(block: Block, outer: Frame, texts: Texts): void {
  const bindings = new Map(outer.bindings);
  const frame: Frame = { ...outer, bindings };
  for (const statement of block.statements) runStatement(statement, frame, bindings, texts);
}

/**
 * One statement, one step. A describe holds exactly what the checker lets
 * it hold, `let`, `if` and `text`, so anything else is the engine's defect.
 */
function runStatement(
  statement: Statement,
  frame: Frame,
  bindings: Map<string, Evaluated>,
  texts: Texts,
): void {
  frame.budget.spend();
  switch (statement.kind) {
    case 'let':
      if (statement.value.kind === 'spawn') break;
      bindings.set(statement.name.text, evaluate(statement.value, frame));
      return;
    case 'if':
      runIf(statement, frame, texts);
      return;
    case 'text':
      texts(speechOf(statement, frame), new Map(bindings));
      return;
    default:
      break;
  }
  throw new Error(
    `\`${statement.kind}\` reached a \`describe\`, which only reads and gives words; the checker refuses it.`,
  );
}

/** An `if` and each `else if` after it, as the chain it is; each link tested past the first is a step. */
function runIf(statement: IfStatement, frame: Frame, texts: Texts): void {
  for (let link: IfStatement = statement; ;) {
    if (evaluateCondition(link.condition, frame)) {
      runBlock(link.then, frame, texts);
      return;
    }
    const otherwise = link.otherwise;
    if (otherwise === null) return;
    if (otherwise.kind === 'block') {
      runBlock(otherwise, frame, texts);
      return;
    }
    frame.budget.spend();
    link = otherwise;
  }
}
