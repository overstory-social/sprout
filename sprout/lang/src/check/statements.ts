// What the compiler checks of a statement: a `let`, a call that writes,
// `spawn`, `destroy` and `move` (the spec's Properties › Naming a value;
// The world model › Spawning, Destroying; Verbs › Moving something; The
// compiler › What it refuses). Expressions inside them are `check.ts`'s.
//
// Two rules from the world model are kept here. The world is the one
// object that can be neither spawned, destroyed nor moved, so a spawn of
// a kind composing `sprout.World`, and a `destroy self` or a `move` of
// something known to be the world, are refused. A spawned actor is an
// NPC, so a spawn of a kind composing `sprout.Actor` but not the visitor
// kind is refused (the spec's Actors and visitors). And a spawn's container
// and a move's destination must hold things where the compiler can tell:
// a binding of the bare object type is accepted, and the engine checks it
// when the statement runs.

import type {
  DestroyStatement,
  Expr,
  Ident,
  LetStatement,
  MoveStatement,
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
import { isActor, isNpc, notAnNpc } from '../declare/actors.js';
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
  const spawned = writtenKind(statement.spawned);
  const holds = checkContainer(statement.container, context, {
    goes: `A new \`${spawned}\``,
    into: 'spawned in',
    example: 'spawn Cup in self',
  });
  return holds ? kind : null;
}

/**
 * `move target to self` — one thing, which is not the world, into
 * something that holds things. Both sides are checked, so an author owed
 * two problems is told both.
 */
export function checkMove(statement: MoveStatement, context: CheckContext): boolean {
  const moves = checkThing(statement.thing, context);
  const moved = writtenPath(statement.thing);
  const holds = checkContainer(statement.destination, context, {
    goes: `\`${moved}\``,
    into: 'moved into',
    example: `move ${moved} to ${moved === 'self' ? 'actor' : 'self'}`,
  });
  return moves && holds;
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

/**
 * The kind a spawn makes, refused where it is unknown, is what the world
 * is made of, or is an actor that is not an NPC.
 */
function spawnedKind(statement: SpawnStatement, context: CheckContext): KindRef | null {
  const kind = resolveKind(statement.spawned, context);
  if (kind === null) return null;
  const written = writtenKind(statement.spawned);
  const visitor = context.visitor ?? null;
  if (visitor !== null && isActor(kind) && !isNpc(kind, visitor)) {
    context.diagnostics.refuse(
      statement.spawned.at,
      notAnNpc(written, visitor),
      `Spawn \`${visitor.name}\`, what this world's visitors are made of, or a kind that composes it, to make an NPC; or spawn a kind that is not an actor.`,
    );
    return null;
  }
  if (!kind.composes.has(WORLD)) return kind;
  context.diagnostics.refuse(
    statement.spawned.at,
    kindName(kind) === WORLD
      ? `\`${written}\` is what the world is made of, and there is only ever one world.`
      : `\`${written}\` composes \`${WORLD}\`, which is what the world is made of, and there is only ever one world.`,
    'Spawn a kind of your own, as in `spawn Cup in self`.',
  );
  return null;
}

/** What moves: one object, and not the world, which goes nowhere. */
function checkThing(path: ObjectPath, context: CheckContext): boolean {
  const name = nameOf(path);
  const type = bindingType(name, context);
  if (type === null) return false;
  if (type.binds !== 'object') {
    context.diagnostics.refuse(
      path.at,
      `\`move\` moves one thing, and \`${name.text}\` is ${showBindingType(type)}.`,
      type.binds === 'set'
        ? 'Name one thing, as in `move target to self`; a set is moved one of its things at a time.'
        : 'Name a thing in the world, as in `move target to self`; a value goes nowhere.',
    );
    return false;
  }
  if (type.kind === null || !type.kind.composes.has(WORLD)) return true;
  context.diagnostics.refuse(
    path.at,
    `\`move ${name.text}\` here would move the world, and the world goes nowhere.`,
    'Write it in the body of the thing that should move.',
  );
  return false;
}

/** How a container's refusal names what goes into it. */
interface Going {
  /** What goes in, as the sentence starts: "A new `Cup`", "`target`". */
  readonly goes: string;
  /** How a refusal says nothing goes into a container that holds nothing: "spawned in". */
  readonly into: string;
  /** The statement written right, for the remedy. */
  readonly example: string;
}

/**
 * Whether what a spawn or a move names as its container may hold what
 * goes in. A dotted path names an identifier inside a body, which nothing
 * resolves yet (B32), so it is refused as a name nothing here answers to.
 */
function checkContainer(path: ObjectPath, context: CheckContext, going: Going): boolean {
  const name = nameOf(path);
  const type = bindingType(name, context);
  if (type === null) return false;
  if (type.binds !== 'object') {
    context.diagnostics.refuse(
      path.at,
      `${going.goes} goes into something that holds things, and \`${name.text}\` is ${showBindingType(type)}.`,
      `Name a container, as in \`${going.example}\`.`,
    );
    return false;
  }
  if (type.kind === null || type.kind.contains) return true;
  context.diagnostics.refuse(
    path.at,
    `\`${kindName(type.kind)}\` holds nothing, so nothing can be ${going.into} it.`,
    'Containment is a declaration: a kind that holds things writes `contains`.',
  );
  return false;
}

/** A path as the one name it is looked up by: its only part, or the whole of it written out. */
function nameOf(path: ObjectPath): Ident {
  return path.parts.length === 1
    ? path.parts[0]!
    : { kind: 'ident', at: path.at, text: writtenPath(path) };
}
