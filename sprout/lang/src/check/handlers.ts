// A handler's body, a hook's, an `after command`'s and a pass rule's,
// checked (the spec's Events, messages and the bus › Receiving, Handlers
// do not refuse, Containers route; Verbs › After a command; The compiler ›
// What it refuses).
//
// In a handler `self` is the kind that wrote it, and its parameters are
// what the message passes, positionally: an authored message's sender, an
// object, and the value it carries, typed by the declaration; an engine
// message's objects and `elapsed`. A hook binds the value the property had
// before. Nobody is acting, so `actor` is not bound, and the body acts as
// a `do` does without `say`, `refuse` or `allow` (`blocks.ts`). `here` is
// bound in an actor's own handler, as its own place, and in no other
// handler or hook (the spec's Prose). An `after command` follows a
// visitor's command, so `actor` is that visitor and `here` their place,
// and it acts and speaks as a `do` does, but never refuses: the deciding
// was done before it ran. A pass rule is a condition over `self`, the
// container asked.

import type { Diagnostics } from '../source/diagnostics.js';
import type { KindLookup, KindRef } from '../declare/kinds.js';
import type { ResolvedAfterCommand, ResolvedHandler, ResolvedHook } from '../declare/handlers.js';
import type { HereKind } from '../declare/places.js';
import type { ResolvedPass } from '../declare/passes.js';
import { writtenPass } from '../syntax/ast-events.js';
import { nearestOption, SPROUT } from '../declare/enums.js';
import {
  actorBinding,
  engineParameters,
  handlerParameters,
  hereBinding,
  Scope,
  selfBinding,
  showBindingType,
  wasBinding,
  type Binding,
} from './bindings.js';
import { typeOf, type ActSetting, type CheckContext, type MessageSetting } from './check.js';
import type { NameScope } from './names.js';
import type { SpeechBook } from './speech.js';
import type { PinnedExtensions } from '../declare/extensions.js';
import { ACTOR, isActor } from '../declare/actors.js';
import { checkBlock } from './blocks.js';

/** Where a handler, a hook, an `after command` or a pass rule is read: the kinds and verbs in scope, and somewhere to say what is wrong. */
export interface HandlerSetting {
  readonly kinds: KindLookup;
  readonly verbs: ActSetting['verbs'];
  readonly heard: ActSetting['heard'];
  readonly diagnostics: Diagnostics;
  /** What `here` is typed as, which an actor's own handler and an `after command` bind. */
  readonly here: HereKind;
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
 * Check one handler `self` wrote, in the scope its message gives it.
 * Returns whether nothing in it was refused.
 */
export function checkHandler(
  handler: ResolvedHandler,
  self: KindRef,
  setting: HandlerSetting,
): boolean {
  const { diagnostics } = setting;
  const before = diagnostics.refusals.length;
  const { declaration, message } = handler;
  const parameters =
    'engine' in message
      ? engineParameters(
          message.engine,
          declaration.parameters,
          declaration.message.at,
          diagnostics,
        )
      : handlerParameters(
          message.declared,
          declaration.parameters,
          declaration.message.at,
          diagnostics,
        );
  const written = `on :${declaration.message.text}`;
  const here = isActor(self) ? hereBinding(setting.here, declaration.body.at) : null;
  checkBody(declaration, written, self, parameters, setting, here);
  return diagnostics.refusals.length === before;
}

/**
 * Check one hook `self` wrote: the property it watches is one `self`
 * holds itself, not one remembered about each actor, and it binds at most
 * the value that property had. Returns whether nothing in it was refused.
 */
export function checkHook(hook: ResolvedHook, self: KindRef, setting: HandlerSetting): boolean {
  const { diagnostics } = setting;
  const before = diagnostics.refusals.length;
  const { declaration } = hook;
  const name = declaration.property.text;
  const written = `changed :${name}`;
  const property = self.properties.get(name);
  const parameters: Binding[] = [];
  if (property === undefined) {
    const held = [...self.properties.values()].filter((one) => !one.remembered);
    const meant = nearestOption(
      name,
      held.map((one) => one.name),
    );
    diagnostics.refuse(
      declaration.property.at,
      `\`${self.name}\` holds no \`:${name}\`, so \`${written}\` has nothing to watch.${meant === null ? '' : ` Did you mean \`:${meant}\`?`}`,
      held.length === 0
        ? `Declare the property in \`${self.name}\`, as in \`:${name} false\`, or take the hook out.`
        : `Name a property \`${self.name}\` holds, as in \`changed :${meant ?? held[0]!.name} (was) { … }\`.`,
    );
  } else if (property.remembered) {
    diagnostics.refuse(
      declaration.property.at,
      `\`:${name}\` is remembered about each actor, and \`changed\` watches what \`${self.name}\` holds itself.`,
      'Do what the change means where the memory is written, or watch a property of its own.',
    );
  } else {
    const [was, ...extra] = declaration.parameters;
    if (extra.length > 0) {
      diagnostics.refuse(
        extra[0]?.at ?? declaration.property.at,
        `\`${written}\` binds the value it had before, and nothing else.`,
        `Write \`${written} (was)\`, or leave the brackets off.`,
      );
    } else if (was !== undefined && was !== null) {
      parameters.push(wasBinding(was.text, property, was.at));
    }
  }
  checkBody(declaration, written, self, parameters, setting);
  return diagnostics.refusals.length === before;
}

/**
 * Check one `after command` `self` wrote, with `actor`, typed as
 * `sprout.Actor`, and `here` bound. Returns whether nothing in it was refused.
 */
export function checkAfterCommand(
  after: ResolvedAfterCommand,
  self: KindRef,
  setting: HandlerSetting,
): boolean {
  const { diagnostics } = setting;
  const before = diagnostics.refusals.length;
  const body = after.declaration.body;
  const scope = Scope.root();
  scope.introduce(selfBinding(self, body.at), diagnostics);
  scope.introduce(actorBinding(setting.kinds.qualified(SPROUT, 'Actor'), body.at), diagnostics);
  scope.introduce(hereBinding(setting.here, body.at), diagnostics);
  checkBlock(body, contextFor(after.declaration, self, scope, setting), { body: 'after' });
  return diagnostics.refusals.length === before;
}

/**
 * Check one pass rule `self` wrote: a condition, read with `self` the
 * container asked and nothing else bound. Returns whether it was accepted.
 */
export function checkPass(pass: ResolvedPass, self: KindRef, setting: HandlerSetting): boolean {
  const { diagnostics } = setting;
  const scope = Scope.root();
  scope.introduce(selfBinding(self, pass.declaration.at), diagnostics);
  const context: CheckContext = {
    scope,
    kinds: setting.kinds,
    from: self.library,
    self,
    diagnostics,
    ...(setting.names === undefined ? {} : { names: setting.names }),
    undrawn: { by: 'pass', written: writtenPass(pass.declaration) },
  };
  const rule = pass.declaration.rule;
  const type = typeOf(rule, context);
  if (type === null) return false;
  if (type.binds === 'value' && type.type.type === 'boolean') return true;
  const written = writtenPass(pass.declaration);
  diagnostics.refuse(
    rule.at,
    `\`${written}\` lets a message through or not, so its rule is true or false, and this is ${showBindingType(type)}.`,
    `Write \`${written} (true)\`, \`${written} (false)\`, or a condition, as in \`pass any (self.get(:open))\`.`,
  );
  return false;
}

/**
 * A handler's or a hook's block, with `self` and `parameters` bound, then
 * `here` where it is given and no parameter takes the name; `actor`, and
 * `here` where it is not bound, are withheld.
 */
function checkBody(
  declaration: ResolvedHandler['declaration'] | ResolvedHook['declaration'],
  written: string,
  self: KindRef,
  parameters: readonly Binding[],
  setting: HandlerSetting,
  here: Binding | null = null,
): void {
  const { diagnostics } = setting;
  const body = declaration.body;
  const scope = Scope.root();
  scope.introduce(selfBinding(self, body.at), diagnostics);
  for (const parameter of parameters) scope.introduce(parameter, diagnostics);
  if (here !== null && scope.lookup('here') === null) scope.introduce(here, diagnostics);
  for (const name of ['actor', 'here']) {
    if (scope.lookup(name) !== null) continue;
    const placeless = name === 'here' && written.startsWith('on ');
    const words = {
      message: placeless
        ? `\`here\` is not bound inside \`${written}\`: only an actor's own handler has a place, and \`${self.name}\` does not compose \`${ACTOR}\`.`
        : `\`${name}\` is not bound inside \`${written}\`: nobody is acting when a message arrives.`,
      remedy: placeless
        ? `Compose \`${ACTOR}\` into \`${self.name}\` if it is an actor, or name the place through what the message passes, as \`on :entered (item, from)\` names where it came from.`
        : 'Name what you mean through what the message passes, as `on :entered (item, from)` names what arrived.',
    };
    scope.withhold(
      { name, at: body.at, unread: words, bound: { bindable: false, words } },
      diagnostics,
    );
  }
  checkBlock(body, contextFor(declaration, self, scope, setting), { body: 'handler', written });
}

/** What an acting body that answers no verb is checked in: `scope` over `self`. */
function contextFor(
  declaration:
    | ResolvedHandler['declaration']
    | ResolvedHook['declaration']
    | ResolvedAfterCommand['declaration'],
  self: KindRef,
  scope: Scope,
  setting: HandlerSetting,
): CheckContext {
  return {
    scope,
    kinds: setting.kinds,
    from: self.library,
    self,
    diagnostics: setting.diagnostics,
    acting: { verbs: setting.verbs, heard: setting.heard },
    ...(setting.names === undefined ? {} : { names: setting.names }),
    ...(setting.messages === undefined ? {} : { messages: setting.messages }),
    ...(setting.extensions === undefined ? {} : { extensions: setting.extensions }),
    ...(setting.speech === undefined ? {} : { speech: { ...setting.speech, body: declaration } }),
  };
}
