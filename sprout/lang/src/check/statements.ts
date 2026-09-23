// What the compiler checks of a statement: a `let`, a call that writes,
// `spawn` and `destroy` (the spec's Properties › Naming a value; The
// world model › Spawning, Destroying; The world). Expressions inside
// them are `check.ts`'s.
//
// Two rules from the world model are kept here. The world is the one
// object that can be neither spawned nor destroyed, so a spawn of a kind
// composing `sprout.World`, and a `destroy self` whose `self` is the
// world, are refused. And a spawn's container must hold things where the
// compiler can tell: a binding of the bare object type is accepted, and
// the engine checks it when the spawn runs.

import type {
  DestroyStatement,
  Expr,
  LetStatement,
  ObjectPath,
  SpawnStatement,
} from '../syntax/ast.js';
import { writtenPath } from '../syntax/ast.js';
import {
  letBinding,
  objectOf,
  showBindingType,
  type Binding,
  type BindingType,
} from './bindings.js';
import { kindName, type KindRef } from '../declare/kinds.js';
import { WORLD } from '../declare/sprout-world.js';
import { writtenKind } from '../declare/compose.js';
import {
  bindingType,
  checkEffectCall,
  isEffect,
  resolveKind,
  typeOf,
  type CheckContext,
} from './check.js';

/**
 * `let ribs = tools.count(Rib)` — a name for what an expression works
 * out, or for what a `spawn` makes, brought into scope for the rest of
 * its block. Its type is the expression's EXACTLY, and a spawn's is its
 * kind: nothing is widened, because nothing was annotated.
 *
 * There is no reassignment, so `Scope.introduce` refuses a second `let`
 * of one name as shadowing, in the words it refuses any other.
 */
export function checkLet(statement: LetStatement, context: CheckContext): Binding | null {
  const value = statement.value;
  let type: BindingType | null;
  if (value.kind === 'spawn') {
    const kind = checkSpawn(value, context);
    if (kind === null) return null;
    type = objectOf(kind);
  } else {
    type = typeOf(value, context);
    if (type === null) return null;
  }
  const binding = letBinding(statement.name.text, type, statement.name.at);
  return context.scope.introduce(binding, context.diagnostics) ? binding : null;
}

/**
 * A call in statement position: the four that write and the one that
 * remembers. Everything else is a value, and using a value as a
 * statement is a refusal with nothing to say for itself.
 */
export function checkEffect(expr: Expr, context: CheckContext): boolean {
  if (!isEffect(expr)) {
    context.diagnostics.refuse(
      expr.at,
      'This reads something rather than doing something.',
      'A body changes the world with `self.set(…)`, `self.adjust(…)`, `self.add(…)`, `self.remove(…)` or `x.remember(…)`.',
    );
    return false;
  }
  return checkEffectCall(expr, context);
}

/**
 * `spawn Cup in actor` — the kind it makes, for a `let` to type its
 * binding by, or null having said why. The kind and the container are
 * each checked, so an author owed both problems is told both.
 */
export function checkSpawn(statement: SpawnStatement, context: CheckContext): KindRef | null {
  const kind = spawnedKind(statement, context);
  const holds = checkContainer(statement.container, writtenKind(statement.spawned), context);
  return holds ? kind : null;
}

/** `destroy self` — refused only where `self` is the world, which is never destroyed. */
export function checkDestroy(statement: DestroyStatement, context: CheckContext): boolean {
  if (context.self === null || !context.self.composes.has(WORLD)) return true;
  context.diagnostics.refuse(
    statement.at,
    '`destroy self` here would destroy the world, and the world is never destroyed.',
    'Write it in the body of the thing that should go.',
  );
  return false;
}

/** The kind a spawn makes, refused where it is unknown or is what the world is made of. */
function spawnedKind(statement: SpawnStatement, context: CheckContext): KindRef | null {
  const kind = resolveKind(statement.spawned, context);
  if (kind === null || !kind.composes.has(WORLD)) return kind;
  const written = writtenKind(statement.spawned);
  context.diagnostics.refuse(
    statement.spawned.at,
    kindName(kind) === WORLD
      ? `\`${written}\` is what the world is made of, and there is only ever one world.`
      : `\`${written}\` composes \`${WORLD}\`, which is what the world is made of, and there is only ever one world.`,
    'Spawn a kind of your own, as in `spawn Cup in self`.',
  );
  return null;
}

/**
 * Whether what a spawn names as its container may hold the new one. A
 * dotted path names an identifier inside a body, which nothing resolves
 * yet (B32), so it is refused as a name nothing here answers to.
 */
function checkContainer(path: ObjectPath, spawned: string, context: CheckContext): boolean {
  const name =
    path.parts.length === 1
      ? path.parts[0]!
      : { kind: 'ident' as const, at: path.at, text: writtenPath(path) };
  const type = bindingType(name, context);
  if (type === null) return false;
  if (type.binds !== 'object') {
    context.diagnostics.refuse(
      path.at,
      `A new \`${spawned}\` goes into something that holds things, and \`${name.text}\` is ${showBindingType(type)}.`,
      'Name a container, as in `spawn Cup in self`.',
    );
    return false;
  }
  if (type.kind === null || type.kind.contains) return true;
  context.diagnostics.refuse(
    path.at,
    `\`${kindName(type.kind)}\` holds nothing, so nothing can be spawned in it.`,
    'Containment is a declaration: a kind that holds things writes `contains`.',
  );
  return false;
}
