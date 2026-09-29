// A role's body, checked: the `permit` and the `do` of one `as <role> for
// <verb>` (the spec's Verbs › Playing a role, The actor's own part, The
// two passes, Roles compose, Optional tools, Value roles, A role-player
// narrows its own options; Prose; The compiler › What it refuses).
//
// A wildcard, `as tool for any`, plays every verb at once and so knows no
// verb's roles: its `permit` has `self`, `actor` and `here`, and a name
// any verb gives a role is refused there, saying why.
//
// Inside, `self` is the role-player, `actor` whoever is acting, typed as
// `sprout.Actor` since a person or an NPC may be acting, `here` their
// place, and the verb's other roles
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
import type { HereKind } from '../declare/places.js';
import { SPROUT } from '../declare/enums.js';
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
import type { ActSetting, CheckContext, MessageSetting } from './check.js';
import type { NameScope } from './names.js';
import { checkBlock } from './blocks.js';
import type { SpeechBook } from './speech.js';
import type { PinnedExtensions } from '../declare/extensions.js';

/** Where a play is read: the kinds and verbs in scope, and somewhere to say what is wrong. */
export interface PlaySetting {
  readonly kinds: KindLookup;
  /** What `here` is typed as in this world. */
  readonly here: HereKind;
  readonly verbs: ActSetting['verbs'];
  readonly diagnostics: Diagnostics;
  /** Where the body's identifiers resolve from; with none, only bindings are names. */
  readonly names?: NameScope;
  /** The messages a send in the body reaches. */
  readonly messages?: MessageSetting;
  /** Where what the body says is recorded. */
  readonly speech?: SpeechBook;
  /** The extensions the bundle pins, whose statements the body may write. */
  readonly extensions?: PinnedExtensions;
}

/**
 * Check one play `self` wrote, its `permit` and its `do`, in the scope a
 * participant in its verb has. Returns whether nothing in it was refused.
 */
export function checkPlay(play: ResolvedPlay, self: KindRef, setting: PlaySetting): boolean {
  if (play.any) return checkWildcard(play, self, setting);
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

  const scope = participantScope(self, head.at, setting);
  for (const role of verb.roles) bindRole(role, play, verb, self, scope, diagnostics);
  checkBodies(play, contextOf(play, self, scope, setting, verb.name));
  return diagnostics.refusals.length === before;
}

/**
 * Check a wildcard's `permit`, which knows no verb: every name some verb
 * gives a role is withheld, its own category as `self`. Returns whether
 * nothing in it was refused.
 */
function checkWildcard(play: ResolvedPlay, self: KindRef, setting: PlaySetting): boolean {
  const { diagnostics } = setting;
  const before = diagnostics.refusals.length;
  const at = play.declaration.head.at;
  const written = `as ${play.role} for any`;
  const scope = participantScope(self, at, setting);
  const names = new Set([play.role]);
  for (const verb of setting.verbs.all()) for (const role of verb.roles) names.add(role.name);
  for (const name of names) {
    if (scope.lookup(name) !== null) continue;
    const words: Words =
      name === play.role
        ? { message: `\`${name}\` is \`self\` in \`${written}\`.`, remedy: 'Write `self`.' }
        : {
            message: `\`${name}\` names a verb's role, and \`${written}\` plays every verb at once, so it cannot know any verb's other roles.`,
            remedy: `Read only \`self\` and \`actor\` here, or write \`as ${play.role} for <verb>\`, where that verb's roles are bound by name.`,
          };
    scope.withhold({ name, at, unread: words, bound: { bindable: false, words } }, diagnostics);
  }
  checkBodies(play, contextOf(play, self, scope, setting, null));
  return diagnostics.refusals.length === before;
}

/** The scope every participant's body starts from: `self`, `actor` and `here`. */
function participantScope(self: KindRef, at: Span, setting: PlaySetting): Scope {
  const { diagnostics } = setting;
  const scope = Scope.root();
  scope.introduce(selfBinding(self, at), diagnostics);
  const actor = setting.kinds.qualified(SPROUT, 'Actor');
  scope.introduce(actorBinding(actor, at), diagnostics);
  scope.introduce(hereBinding(setting.here, at), diagnostics);
  return scope;
}

/** What a play's bodies are checked in; `verb` is null for a wildcard. */
function contextOf(
  play: ResolvedPlay,
  self: KindRef,
  scope: Scope,
  setting: PlaySetting,
  verb: string | null,
): CheckContext {
  return {
    scope,
    kinds: setting.kinds,
    from: self.library,
    self,
    diagnostics: setting.diagnostics,
    ...(verb === null ? {} : { verb }),
    acting: { verbs: setting.verbs },
    ...(setting.names === undefined ? {} : { names: setting.names }),
    ...(setting.messages === undefined ? {} : { messages: setting.messages }),
    ...(setting.extensions === undefined ? {} : { extensions: setting.extensions }),
    ...(setting.speech === undefined
      ? {}
      : { speech: { ...setting.speech, body: play.declaration } }),
  };
}

/** A play's `permit`, which decides, and its `do`, which acts. */
function checkBodies(play: ResolvedPlay, context: CheckContext): void {
  const declaration = play.declaration;
  if (declaration.permit !== null) checkBlock(declaration.permit, context, { body: 'permit' });
  if (declaration.do !== null) checkBlock(declaration.do, context, { body: 'do' });
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
  // An exit is the engine's to take, and binds nothing in a play.
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
