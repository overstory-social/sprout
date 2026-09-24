// Prose, rendered for one reader (the spec's Prose › Passages, Slots,
// Conditionals and loops, Bounds).
//
// A slot renders an object as the reader reads it, an option humanised, a
// number in digits, a string as written and an extension's value in the
// words the extension renders it as; another object's passage runs
// with that object as its own `self` and only `actor` and `here` beside
// it, one passage deeper against the turn's bound. `{if}` renders the
// first branch whose condition holds, and `{for}` its body once for each
// thing or element it walks, in order, with `$first`, `$last`, `$index`
// (counting from 1) and `$count` bound. `{one of}` renders one of its
// choices, drawn from the line's draws. Every expression is evaluated as
// a body's is and charged the same steps, and every iteration and every
// choice is a step. Rendering writes nothing.

import type { Expr } from '../syntax/ast.js';
import type { Prose, ProseFor, ProseIf, ProseOneOf, ProseSlot } from '../syntax/ast-prose.js';
import { humanisedOption, libraryOf } from '../declare/enums.js';
import { kindName } from '../declare/kinds.js';
import type { Budget } from '../runtime/budget.js';
import type { Catalogue } from '../runtime/catalogue.js';
import {
  boundObject,
  boundValue,
  evaluate,
  evaluateCondition,
  type Evaluated,
  type Frame,
} from '../runtime/evaluate.js';
import type { InstanceId } from '../runtime/ids.js';
import { SproutList } from '../runtime/lists.js';
import { ExtensionValue, extensionWords } from '../runtime/extension-values.js';
import type { PassRule } from '../runtime/range.js';
import type { Draw } from '../runtime/draws.js';
import type { LineDraws } from './line-draws.js';
import { objectWords, type Naming } from './names.js';
import type { Rendered } from './reflow.js';

/** What rendering reads: the turn's state and names, the bundle, the turn's budget and its draws. */
export interface RenderContext extends Naming {
  readonly catalogue: Catalogue;
  readonly budget: Budget;
  readonly passes: PassRule<InstanceId>;
  /** Each line's draws in a write turn; null in a poll, which draws nothing. */
  readonly draws: LineDraws | null;
  /**
   * The turn's actor, whose output past the host's figure faults the turn;
   * anyone else's cuts them short (`output.ts`). Null where nobody acted.
   */
  readonly actor: InstanceId | null;
}

/** Who speaks prose: its `self`, the library whose kind wrote it, and every other name it renders with. */
export interface Voice {
  readonly self: InstanceId;
  readonly library: string;
  readonly bindings: ReadonlyMap<string, Evaluated>;
}

/** `prose` in `voice`, as `reader` reads it, drawing from `draws` where it may draw. */
export function renderProse(
  prose: Prose,
  voice: Voice,
  reader: InstanceId,
  context: RenderContext,
  draws: Draw | null,
): Rendered[] {
  const out: Rendered[] = [];
  pieces(prose, frameOf(voice, context, draws), reader, context, out);
  return out;
}

function frameOf(voice: Voice, context: RenderContext, draws: Draw | null): Frame {
  const { catalogue } = context;
  return {
    ...(draws === null ? {} : { draws }),
    state: context.state,
    kinds: catalogue.lookup,
    library: voice.library,
    self: voice.self,
    bindings: voice.bindings,
    budget: context.budget,
    caps: catalogue.caps,
    names: catalogue.names,
    passes: context.passes,
  };
}

function pieces(
  prose: Prose,
  frame: Frame,
  reader: InstanceId,
  context: RenderContext,
  out: Rendered[],
): void {
  for (const piece of prose.pieces) {
    switch (piece.kind) {
      case 'prose-words':
        out.push({ words: piece.text });
        break;
      case 'prose-paragraph':
        out.push({ break: 'paragraph' });
        break;
      case 'prose-newline':
        out.push({ break: 'line' });
        break;
      case 'prose-slot':
        slot(piece, frame, reader, context, out);
        break;
      case 'prose-if':
        branch(piece, frame, reader, context, out);
        break;
      case 'prose-for':
        loop(piece, frame, reader, context, out);
        break;
      case 'prose-one-of':
        choose(piece, frame, reader, context, out);
        break;
    }
  }
}

/** One slot, as the checker typed it. */
function slot(
  piece: ProseSlot,
  frame: Frame,
  reader: InstanceId,
  context: RenderContext,
  out: Rendered[],
): void {
  const { expr } = piece;
  if (expr.kind === 'member' && expr.member.text !== 'count') {
    passageOf(expr.receiver, expr.member.text, frame, reader, context, out);
    return;
  }
  const value = evaluate(expr, frame);
  if (value.binds === 'object') {
    out.push({ words: objectWords(value.id, reader, context) });
    return;
  }
  if (
    value.binds === 'set' ||
    typeof value.value === 'boolean' ||
    value.value instanceof SproutList
  ) {
    throw new Error('a slot rendered a set, a boolean or a list, which the checker refuses.');
  }
  const text =
    typeof value.value === 'number'
      ? String(value.value)
      : value.value instanceof ExtensionValue
        ? extensionWords(value.value)
        : context.catalogue.optionSlots.has(piece)
          ? humanisedOption(value.value)
          : value.value;
  out.push({ words: text });
}

/**
 * `{pot.greeting}`: the passage of that name as `pot`'s kind has it, with
 * `pot` its own `self` and `actor` and `here` beside it where they are
 * bound, one passage deeper. A passage its kind lacks, being in a
 * `.prose` file the world was loaded without, renders nothing.
 */
function passageOf(
  receiver: Expr,
  name: string,
  frame: Frame,
  reader: InstanceId,
  context: RenderContext,
  out: Rendered[],
): void {
  const owner = evaluate(receiver, frame);
  if (owner.binds !== 'object') throw new Error('a passage was rendered of what is not an object.');
  const passage = frame.state.instance(owner.id)?.kind.passages.get(name);
  if (passage === undefined) return;
  const bindings = new Map<string, Evaluated>();
  for (const carried of ['actor', 'here']) {
    const bound = frame.bindings.get(carried);
    if (bound !== undefined) bindings.set(carried, bound);
  }
  const voice = { self: owner.id, library: libraryOf(passage.origin), bindings };
  context.budget.passage(() => {
    pieces(passage.body.prose, frameOf(voice, context, frame.draws ?? null), reader, context, out);
  });
}

/** An `{if}` chain: the first branch whose condition holds, each condition tested a step. */
function branch(
  block: ProseIf,
  frame: Frame,
  reader: InstanceId,
  context: RenderContext,
  out: Rendered[],
): void {
  for (let link: ProseIf = block; ;) {
    frame.budget.spend();
    if (evaluateCondition(link.condition, frame)) {
      pieces(link.then, frame, reader, context, out);
      return;
    }
    const otherwise = link.otherwise;
    if (otherwise === null) return;
    if (otherwise.kind === 'prose') {
      pieces(otherwise, frame, reader, context, out);
      return;
    }
    link = otherwise;
  }
}

/** A `{one of}`: one of its choices, each as likely, drawn as a step. */
function choose(
  block: ProseOneOf,
  frame: Frame,
  reader: InstanceId,
  context: RenderContext,
  out: Rendered[],
): void {
  frame.budget.spend();
  if (frame.draws === undefined) {
    throw new Error('a `{one of}` was rendered where nothing draws, which the checker refuses.');
  }
  pieces(block.choices[frame.draws.below(block.choices.length)]!, frame, reader, context, out);
}

/** A `{for}`: its body once for each thing or element walked, each iteration a step. */
function loop(
  block: ProseFor,
  frame: Frame,
  reader: InstanceId,
  context: RenderContext,
  out: Rendered[],
): void {
  const walked = walk(block, frame);
  walked.forEach((each, i) => {
    frame.budget.spend();
    const bindings = new Map(frame.bindings);
    bindings.set(block.variable.text, each);
    bindings.set('$first', boundValue(i === 0));
    bindings.set('$last', boundValue(i === walked.length - 1));
    bindings.set('$index', boundValue(i + 1));
    bindings.set('$count', boundValue(walked.length));
    pieces(block.body, { ...frame, bindings }, reader, context, out);
  });
}

/** What a `{for}` walks: a container's contents, those composing its kind, a set, or a list's elements. */
function walk(block: ProseFor, frame: Frame): Evaluated[] {
  const over = evaluate(block.over, frame);
  if (block.walks === 'of') {
    if (over.binds === 'set') return over.ids.map(boundObject);
    if (over.binds === 'value' && over.value instanceof SproutList) {
      return over.value.elements.map(boundValue);
    }
    throw new Error('`{for … of}` walked what is not a list or a set, which the checker refuses.');
  }
  if (over.binds !== 'object') {
    throw new Error('`{for … in}` walked what is not a container, which the checker refuses.');
  }
  const contents = frame.state.children(over.id);
  const { filter } = block;
  if (filter === null) return contents.map(boundObject);
  const kind =
    filter.library === null
      ? frame.kinds.unqualified(filter.name.text, frame.library)
      : frame.kinds.qualified(filter.library.text, filter.name.text);
  if (kind === null)
    throw new Error(`\`${filter.name.text}\` is not a kind, which the checker refuses.`);
  const identity = kindName(kind);
  return contents
    .filter((id) => frame.state.instance(id)?.kind.composes.has(identity) === true)
    .map(boundObject);
}
