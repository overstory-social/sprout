// A role's body, checked: the `permit` and the `do` of one `as <role> for
// <verb>` (the spec's Verbs › Playing a role, The actor's own part, The
// two passes, Optional tools, Value roles, A role-player narrows its own
// options; Prose; The compiler › What it refuses).
//
// Inside, `self` is the role-player, `actor` whoever is acting, typed by
// the world's visitor kind, `here` their place, and the verb's other roles
// are bound by name, typed by what fills them. The role played is `self`
// and is not bound by its own name, except a set role, whose whole set
// every participant sees. A tool some reading leaves unbound, and every
// value tool, is withheld: read only inside `if (bound …)`. A value tool
// this body gives no `from` is never bound here, and never read. A
// `permit` decides and a `do` acts, as `blocks.ts` checks each.

import type { Diagnostics } from '../source/diagnostics.js';
import { textOf, type Span } from '../source/source.js';
import { readable } from '../source/words.js';
import type { KindLookup, KindRef } from '../declare/kinds.js';
import { ACTOR, isActor } from '../declare/actors.js';
import { ACTOR_ROLE, type ResolvedPlay } from '../declare/roles.js';
import type { ResolvedRole, ResolvedVerb } from '../declare/verbs.js';
import {
  actorBinding,
  hereBinding,
  roleBinding,
  Scope,
  selfBinding,
  setRoleBinding,
  type Binding,
  type Words,
} from './bindings.js';
import type { ActSetting, CheckContext } from './check.js';
import { checkBlock } from './blocks.js';

/** Where a play is read: the kinds and verbs in scope, what visitors are made of, and somewhere to say what is wrong. */
export interface PlaySetting {
  readonly kinds: KindLookup;
  readonly verbs: ActSetting['verbs'];
  /** The world's visitor kind; null where the world has none to name, which has been said. */
  readonly visitor: KindRef | null;
  readonly diagnostics: Diagnostics;
}

/**
 * Check one play `self` wrote, its `permit` and its `do`, in the scope a
 * participant in its verb has. Returns whether nothing in it was refused.
 */
export function checkPlay(play: ResolvedPlay, self: KindRef, setting: PlaySetting): boolean {
  const { diagnostics } = setting;
  const before = diagnostics.refusals.length;
  const verb = setting.verbs.qualified(play.library, play.verb);
  // A verb composing found and resolving did not is one whose declaration
  // was refused, which has been said.
  if (verb === null) return true;
  const head = play.declaration.head;
  if (play.role === ACTOR_ROLE && !isActor(self)) {
    const roles = verb.roles.map((role) => role.name);
    diagnostics.refuse(
      head.role.at,
      `Only an actor acts, and \`${self.name}\` does not compose \`${ACTOR}\`.`,
      roles.length === 0
        ? `Compose \`${ACTOR}\` into \`${self.name}\`: only the one acting plays \`${verb.name}\`.`
        : `Compose \`${ACTOR}\` into \`${self.name}\`, or play one of \`${verb.name}\`'s roles instead: ${readable(roles)}.`,
    );
  }

  const scope = Scope.root();
  scope.introduce(selfBinding(self, head.at), diagnostics);
  scope.introduce(actorBinding(setting.visitor, head.at), diagnostics);
  scope.introduce(hereBinding(head.at), diagnostics);
  for (const role of verb.roles) bindRole(role, play, verb, self, scope, diagnostics);

  const context: CheckContext = {
    scope,
    kinds: setting.kinds,
    from: self.library,
    self,
    diagnostics,
    verb: verb.name,
    acting: { verbs: setting.verbs },
  };
  const declaration = play.declaration;
  if (declaration.permit !== null) checkBlock(declaration.permit, context, { body: 'permit' });
  if (declaration.do !== null) checkBlock(declaration.do, context, { body: 'do' });
  return diagnostics.refusals.length === before;
}

/**
 * One of the verb's roles, brought into the body's scope as it is there:
 * bound, withheld until `bound` asks, never bound, or `self`.
 */
function bindRole(
  role: ResolvedRole,
  play: ResolvedPlay,
  verb: ResolvedVerb,
  self: KindRef,
  scope: Scope,
  diagnostics: Diagnostics,
): void {
  const at = play.declaration.head.at;
  const name = role.name;
  const narrowing = play.narrows.get(name) ?? null;
  const filler = role.filler ?? { fills: 'open' as const };
  // Only the engine's `go` has an exit role, and what an exit binds is B28's.
  if (filler.fills === 'exit') return;

  const thing = filler.fills === 'kind' || filler.fills === 'open';
  if (thing && narrowing !== null) {
    // `from` on a role a thing fills: `roleBinding` says why it narrows nothing.
    roleBinding(name, filler, narrowing, narrowing.at, diagnostics);
    return;
  }
  if (role.many) {
    scope.introduce(
      setRoleBinding(name, filler.fills === 'kind' ? filler.kind : null, at),
      diagnostics,
    );
    return;
  }
  if (name === play.role) {
    const played = `\`${name}\` is \`self\` in \`as ${name} for ${verb.name}\``;
    scope.withhold(
      {
        name,
        at,
        unread: { message: `${played}.`, remedy: 'Write `self`.' },
        bound: {
          bindable: false,
          words: {
            message: `${played}, and is always there.`,
            remedy: 'Take the `if` out and read `self`.',
          },
        },
      },
      diagnostics,
    );
    return;
  }
  if (!thing && narrowing === null) {
    const never = neverBound(name, filler.fills, self);
    scope.withhold(
      { name, at, unread: never, bound: { bindable: false, words: never } },
      diagnostics,
    );
    return;
  }

  const binding: Binding | null = roleBinding(
    name,
    filler,
    narrowing,
    narrowing?.at ?? at,
    diagnostics,
  );
  if (binding === null) return;
  if (!role.optional) {
    scope.introduce(binding, diagnostics);
    return;
  }
  scope.withhold(
    {
      name,
      at,
      unread: {
        message: `\`${name}\` may be missing here: ${whyMissing(role, verb, self)}.`,
        remedy: `Read it inside \`if (bound ${name}) { … }\`.`,
      },
      bound: { bindable: true, binding },
    },
    diagnostics,
  );
}

/** Why a tool may be unbound where a body reads it, for the refusal to say. */
function whyMissing(role: ResolvedRole, verb: ResolvedVerb, self: KindRef): string {
  if (role.omittedBy !== null) {
    return `${phraseAsWritten(role.omittedBy.declaration.at)} leaves it out`;
  }
  if (role.filler?.fills === 'symbol') {
    return `what a visitor names may be none of the options \`${self.name}\` hears`;
  }
  if (role.filler?.fills === 'integer') {
    return `the number a visitor names may be outside the ones \`${self.name}\` hears`;
  }
  return `\`${verb.name}\` marks it \`optional\``;
}

/** A phrase as its author wrote it, quotes and all, in backticks. */
function phraseAsWritten(at: Span): string {
  return `\`${textOf(at)}\``;
}

/** What is said of a value tool this body hears nothing for, read or asked about. */
function neverBound(name: string, fills: 'symbol' | 'integer', self: KindRef): Words {
  return fills === 'symbol'
    ? {
        message: `\`${name}\` has no options here, so it is never bound.`,
        remedy: `Write \`${name} from :<a list property>\` in this body, naming the options \`${self.name}\` hears.`,
      }
    : {
        message: `\`${name}\` has no numbers here, so it is never bound.`,
        remedy: `Write \`${name} from :<an integer property>\` or \`${name} from 1 to 12\` in this body, naming the numbers \`${self.name}\` hears.`,
      };
}
