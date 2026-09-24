// A place's exits and links checked against the whole bundle, and
// `connect` (the spec's Verbs › Exits, An exit may be conditional, Places
// inside places, Links; The compiler › What it refuses, What it warns
// about).
//
// An exit or a link is declared only on a place, since only a place holds
// visitors. An exit's destination is named as any name in its body is,
// and must be a place other than the world; in a kind's body, where each
// instance's place decides which object it is, one of those it could be
// must be a place, and the run leads nowhere through one that is not. Its
// `when` is a condition over `self`, the place, read-only
// and pure as a pass rule's is: nobody is acting while it is polled, so
// `actor` and `here` are not bound. `connect` assigns one of `self`'s
// links, named by its direction, to a binding: a link leads only where
// the world made a place, and a place written in source has an exit.

import type { ConnectStatement, Expr, ObjectPath } from '../syntax/ast.js';
import { writtenPath } from '../syntax/ast.js';
import type { Diagnostics } from '../source/diagnostics.js';
import type { ResolvedExit } from '../declare/exits.js';
import { shownName } from '../declare/enums.js';
import { kindName, type KindLookup, type KindRef } from '../declare/kinds.js';
import { actorBinding, hereBinding, Scope, selfBinding, showBindingType } from './bindings.js';
import { typeOf, type CheckContext } from './check.js';
import { dottedType, type NameScope } from './names.js';
import { pathType } from './statements.js';

/** What an exit is checked against: the kinds, where its names resolve, and somewhere to say what is wrong. */
export interface ExitSetting {
  readonly kinds: KindLookup;
  readonly diagnostics: Diagnostics;
  readonly names: NameScope;
}

/** What a place is, as a remedy says it. */
const A_PLACE = 'something that composes `sprout.Place` or writes `contains actors`';

/**
 * Check one exit or link `self` wrote: `self` is a place, an exit leads
 * to one, and its `when` is a condition. Returns whether nothing in it
 * was refused.
 */
export function checkExit(exit: ResolvedExit, self: KindRef, setting: ExitSetting): boolean {
  const { diagnostics } = setting;
  const { line } = exit;
  const word = line.kind === 'grammar-exit' ? 'exit' : 'link';
  if (!self.containsActors) {
    diagnostics.refuse(
      line.direction.at,
      `\`${self.name}\` is not a place, so nobody stands in it to take a way out.`,
      `Write the ${word} on a place: ${A_PLACE}.`,
    );
    return false;
  }
  if (line.kind === 'grammar-link') return true;
  const leads = checkDestination(line.destination, self, setting);
  const holds = line.when === null || checkWhen(line.when, self, setting);
  return leads && holds;
}

/** Where an exit leads: a place written in the world, named from where the exit is. */
function checkDestination(path: ObjectPath, self: KindRef, setting: ExitSetting): boolean {
  const { diagnostics, names } = setting;
  const context: CheckContext = {
    scope: Scope.root(),
    kinds: setting.kinds,
    from: self.library,
    self,
    diagnostics,
    names,
  };
  const type = dottedType(path, context);
  if (type === null) return false;
  const written = writtenPath(path);
  if (names.table.get(path)?.names === 'world') {
    diagnostics.refuse(
      path.at,
      `\`${written}\` is the world, and an exit leads to a place inside it.`,
      `Lead the exit to a place in the world: ${A_PLACE}.`,
    );
    return false;
  }
  const named = names.table.get(path);
  if (named?.names === 'placed') {
    // Which object it is is each instance's; refused only where none it could be holds actors.
    const reached = named.candidates.filter((one) => one.steps.length === path.parts.length);
    if (reached.some((one) => one.kind === null || one.kind.containsActors)) return true;
    diagnostics.refuse(
      path.at,
      `Nothing called \`${written}\` holds actors, so nobody could stand where this exit leads.`,
      `Lead it to a place: ${A_PLACE}.`,
    );
    return false;
  }
  if (type.binds !== 'object' || type.kind === null || type.kind.containsActors) return true;
  diagnostics.refuse(
    path.at,
    `\`${written}\` does not hold actors, so nobody could stand where this exit leads.`,
    `Lead it to a place: ${A_PLACE}.`,
  );
  return false;
}

/**
 * An exit's `when`: a boolean over `self`, with `actor` and `here`
 * withheld; the literal `false`, which never holds, is warned about.
 */
function checkWhen(when: Expr, self: KindRef, setting: ExitSetting): boolean {
  const { diagnostics } = setting;
  const scope = Scope.root();
  scope.introduce(selfBinding(self, when.at), diagnostics);
  for (const [name, binding] of [
    ['actor', actorBinding(null, when.at)],
    ['here', hereBinding(when.at)],
  ] as const) {
    const words = {
      message: `\`${name}\` is not bound in an exit's \`when\`: it is asked of the place, whoever looks.`,
      remedy:
        'Read the place through `self`, as in `when (self.get(:lit))`, or a thing by its name.',
    };
    scope.withhold(
      { name, at: binding.at, unread: words, bound: { bindable: false, words } },
      diagnostics,
    );
  }
  const context: CheckContext = {
    scope,
    kinds: setting.kinds,
    from: self.library,
    self,
    diagnostics,
    names: setting.names,
  };
  const type = typeOf(when, context);
  if (type === null) return false;
  if (type.binds !== 'value' || type.type.type !== 'boolean') {
    diagnostics.refuse(
      when.at,
      `An exit's \`when\` says whether it applies, so it is true or false, and this is ${showBindingType(type)}.`,
      'Write a condition, as in `when (self.get(:lit))`.',
    );
    return false;
  }
  if (when.kind === 'boolean' && !when.value) {
    diagnostics.warn(
      when.at,
      "This exit's `when` is `false`, so the exit never applies.",
      'Give it a condition that can hold, or take the exit out.',
    );
  }
  return true;
}

/**
 * `connect north to cell`: a link the writing kind's closure declares in
 * that direction, and a binding holding a place. Returns whether it was
 * accepted.
 */
export function checkConnect(statement: ConnectStatement, context: CheckContext): boolean {
  const { diagnostics } = context;
  const self = context.self;
  const direction = statement.link.text;
  let accepted = true;
  if (self !== null) {
    const links = self.exits.filter((exit) => exit.line.kind === 'grammar-link');
    if (!links.some((link) => link.direction === direction)) {
      const has = links.map((link) => link.direction);
      diagnostics.refuse(
        statement.link.at,
        `\`${self.name}\` has no link \`${direction}\`, so there is nothing to connect.`,
        has.length === 0
          ? `Declare one in its grammar block, as in \`link ${direction} "deeper into the dark"\`.`
          : `Connect one it has: ${has.map((one) => `\`connect ${one} to …\``).join(', ')}; or declare \`link ${direction} "…"\`.`,
      );
      accepted = false;
    }
  }
  const destination = statement.destination;
  const written = writtenPath(destination);
  const [only, ...rest] = destination.parts;
  if (only === undefined || rest.length > 0 || context.scope.lookup(only.text) === null) {
    diagnostics.refuse(
      destination.at,
      `\`${written}\` is not a binding, and a link leads only to a place the world made while it runs.`,
      `Connect it to a binding that holds the place, as in \`let cell = spawn Cell in self\` then \`connect ${direction} to cell\`; a place written in source is reached by an \`exit\`.`,
    );
    return false;
  }
  const type = pathType(destination, context);
  if (type === null) return false;
  if (type.binds !== 'object') {
    diagnostics.refuse(
      destination.at,
      `A link leads to a place, and \`${written}\` is ${showBindingType(type)}.`,
      `Connect it to one place, as in \`connect ${direction} to cell\`.`,
    );
    return false;
  }
  if (type.kind !== null && !type.kind.containsActors) {
    diagnostics.refuse(
      destination.at,
      `\`${shownName(kindName(type.kind), context.from)}\` does not hold actors, so nobody could stand where this link leads.`,
      `Connect it to a place: ${A_PLACE}.`,
    );
    return false;
  }
  return accepted;
}
