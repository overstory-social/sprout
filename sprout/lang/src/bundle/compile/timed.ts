// The warnings about the engine's two timed messages (the spec's The
// compiler › What it warns about; Time): an `on :tick` on an object that
// is not a place, since only a place is ticked; a `wake` that nothing
// answers with `on :woke`; and an `on :woke` that nothing asks for with
// `wake`. They are warned rather than refused, since what a kind is
// composed with may bring the other half, so a kind in the bundle that
// runs the one and brings the other silences the warning.
//
// Only the world's own handlers and `wake`s are warned about, each once:
// a library's are its author's. An object counts as ticked where its kind
// declares `contains actors`; the objects asked are the declared ones, in
// declared order, and then each kind a body spawns.

import type { Block, Statement, WakeStatement } from '../../syntax/ast.js';
import type { HandlerDeclaration } from '../../syntax/ast-events.js';
import type { Diagnostics } from '../../source/diagnostics.js';
import { libraryOf } from '../../declare/enums.js';
import { writtenKind } from '../../declare/compose.js';
import type { KindLookup, KindRef } from '../../declare/kinds.js';
import type { ComposedObject } from '../../declare/objects.js';
import type { ObjectTree } from '../../declare/tree.js';

/** What the warnings read: every composed kind, the objects and where they sit, and whose declarations are the world's. */
export interface TimedSetting {
  readonly kinds: readonly KindRef[];
  /** What a `spawn` names its kind from. */
  readonly lookup: KindLookup;
  readonly composed: readonly ComposedObject[];
  readonly tree: ObjectTree;
  /** The world's own namespace. */
  readonly namespace: string;
  readonly diagnostics: Diagnostics;
}

/** Warn at each of the world's `on :tick` handlers, `wake`s and `on :woke` handlers that never run or arrive. */
export function warnUntimed(setting: TimedSetting): void {
  warnTickOffPlace(setting);
  warnUnansweredWake(setting);
  warnUnaskedWoke(setting);
}

/** A body a kind runs, with the kind that wrote it. */
interface Body {
  readonly origin: string;
  readonly block: Block | null;
}

/** An object that may be sent `:tick`, as the warning names it. */
interface Ticked {
  readonly named: string;
  readonly kind: KindRef;
}

/** Warn at each `on :tick` an object that is not a place runs, naming the first such object. */
function warnTickOffPlace(setting: TimedSetting): void {
  const { namespace, diagnostics } = setting;
  const warned = new Set<HandlerDeclaration>();
  for (const { named, kind } of tickable(setting)) {
    if (kind.containsActors) continue;
    for (const { origin, declaration } of kind.handlers.get('tick') ?? []) {
      if (libraryOf(origin) !== namespace || warned.has(declaration)) continue;
      warned.add(declaration);
      diagnostics.warn(
        declaration.message.at,
        `${named} is not a place, so \`on :tick\` never runs.`,
        'Only a place, whose kind writes `contains actors`, is ticked. Move the handler to the kind of the place it stands in, or ask with `wake in 10 minutes` and answer `on :woke (elapsed) { … }` here.',
      );
    }
  }
}

/** The declared objects, in declared order, and then each kind a body spawns, first spawn first. */
function tickable(setting: TimedSetting): Ticked[] {
  const found: Ticked[] = [];
  for (const object of setting.composed) {
    const placement = setting.tree.placements.get(object);
    if (object.kind === null || placement === undefined) continue;
    found.push({ named: `\`${placement.path.join('.')}\``, kind: object.kind });
  }
  const spawned = new Set<KindRef>();
  for (const kind of setting.kinds) {
    for (const { origin, block } of bodiesOf(kind)) {
      for (const statement of statementsIn(block)) {
        const spawn =
          statement.kind === 'spawn'
            ? statement
            : statement.kind === 'let' && statement.value.kind === 'spawn'
              ? statement.value
              : null;
        if (spawn === null) continue;
        const written = spawn.spawned;
        const made =
          written.library === null
            ? setting.lookup.unqualified(written.name.text, libraryOf(origin))
            : setting.lookup.qualified(written.library.text, written.name.text);
        if (made === null || spawned.has(made)) continue;
        spawned.add(made);
        found.push({ named: `A spawned \`${writtenKind(written)}\``, kind: made });
      }
    }
  }
  return found;
}

/** Warn at each of the world's `wake`s that no kind running it answers with `on :woke`. */
function warnUnansweredWake(setting: TimedSetting): void {
  const { kinds, namespace, diagnostics } = setting;
  const answered = new Set<WakeStatement>();
  const written = new Map<WakeStatement, string>();
  for (const kind of kinds) {
    const answers = (kind.handlers.get('woke') ?? []).length > 0;
    for (const wake of wakesOf(kind)) {
      written.set(wake.statement, wake.origin);
      if (answers) answered.add(wake.statement);
    }
  }
  for (const [statement, origin] of written) {
    if (answered.has(statement) || libraryOf(origin) !== namespace) continue;
    diagnostics.warn(
      statement.at,
      'Nothing here answers `:woke`, so this `wake` comes to nothing.',
      'Say what happens when it arrives with `on :woke (elapsed) { … }` in this kind, or take the `wake` out.',
    );
  }
}

/** Warn at each of the world's `on :woke` handlers that no kind running it asks for with `wake`. */
function warnUnaskedWoke(setting: TimedSetting): void {
  const { kinds, namespace, diagnostics } = setting;
  const asked = new Set<HandlerDeclaration>();
  const written = new Map<HandlerDeclaration, string>();
  for (const kind of kinds) {
    const asks = wakesOf(kind).length > 0;
    for (const { origin, declaration } of kind.handlers.get('woke') ?? []) {
      written.set(declaration, origin);
      if (asks) asked.add(declaration);
    }
  }
  for (const [declaration, origin] of written) {
    if (asked.has(declaration) || libraryOf(origin) !== namespace) continue;
    diagnostics.warn(
      declaration.message.at,
      'Nothing here asks to be woken, so `on :woke` never runs.',
      'Ask with `wake in 10 minutes` in a `do`, a handler or a hook of this kind, or take the handler out.',
    );
  }
}

/** Every `wake` a kind runs, with the kind that wrote it. */
function wakesOf(kind: KindRef): { readonly origin: string; readonly statement: WakeStatement }[] {
  return bodiesOf(kind).flatMap(({ origin, block }) =>
    statementsIn(block).flatMap((statement) =>
      statement.kind === 'wake' ? [{ origin, statement }] : [],
    ),
  );
}

/** Every body a kind runs: its plays' `do`s, its handlers and its hooks. */
function bodiesOf(kind: KindRef): Body[] {
  return [
    ...[...kind.plays.values()]
      .flat()
      .map((play) => ({ origin: play.origin, block: play.declaration.do })),
    ...[...kind.handlers.values()]
      .flat()
      .map((one) => ({ origin: one.origin, block: one.declaration.body })),
    ...[...kind.hooks.values()]
      .flat()
      .map((one) => ({ origin: one.origin, block: one.declaration.body })),
  ];
}

/** Every statement in `block`, however deep inside an `if`, in the order written. */
function statementsIn(block: Block | null): Statement[] {
  const found: Statement[] = [];
  const pending: Statement[] = [...(block?.statements ?? [])].reverse();
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    found.push(next);
    if (next.kind !== 'if') continue;
    const otherwise =
      next.otherwise === null
        ? []
        : next.otherwise.kind === 'if'
          ? [next.otherwise]
          : next.otherwise.statements;
    pending.push(...[...next.then.statements, ...otherwise].reverse());
  }
  return found;
}
