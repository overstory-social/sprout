// A handler's body, a hook's and a pass rule's, checked (the spec's
// Events, messages and the bus › Receiving, Handlers do not refuse,
// Containers route; The compiler › What it refuses).
//
// In a handler `self` is the kind that wrote it, and its parameters are
// what the message passes, positionally: an authored message's sender, an
// object, and the value it carries, typed by the declaration; an engine
// message's objects and `elapsed`. A hook binds the value the property had
// before. Nobody is acting, so `actor` and `here` are not bound, and the
// body acts as a `do` does without `say`, `refuse` or `allow` (`blocks.ts`).
// A pass rule is a condition over `self`, the container asked.

import type { Diagnostics } from '../source/diagnostics.js';
import type { KindLookup, KindRef } from '../declare/kinds.js';
import type { ResolvedHandler, ResolvedHook } from '../declare/handlers.js';
import type { ResolvedPass } from '../declare/passes.js';
import { writtenPass } from '../syntax/ast.js';
import { nearestOption } from '../declare/enums.js';
import {
  engineParameters,
  handlerParameters,
  hereBinding,
  actorBinding,
  Scope,
  selfBinding,
  showBindingType,
  wasBinding,
  type Binding,
} from './bindings.js';
import { typeOf, type ActSetting, type CheckContext, type MessageSetting } from './check.js';
import type { NameScope } from './names.js';
import { checkBlock } from './blocks.js';

/** Where a handler, a hook or a pass rule is read: the kinds and verbs in scope, and somewhere to say what is wrong. */
export interface HandlerSetting {
  readonly kinds: KindLookup;
  readonly verbs: ActSetting['verbs'];
  readonly diagnostics: Diagnostics;
  /** Where the body's identifiers resolve from; with none, only bindings are names. */
  readonly names?: NameScope;
  /** The messages a send in the body reaches. */
  readonly messages?: MessageSetting;
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
  checkBody(declaration.body, written, self, parameters, setting);
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
  checkBody(declaration.body, written, self, parameters, setting);
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
 * A handler's or a hook's block, with `self` and `parameters` bound and
 * `actor` and `here` withheld, where a parameter does not take the name.
 */
function checkBody(
  body: ResolvedHandler['declaration']['body'],
  written: string,
  self: KindRef,
  parameters: readonly Binding[],
  setting: HandlerSetting,
): void {
  const { diagnostics } = setting;
  const scope = Scope.root();
  scope.introduce(selfBinding(self, body.at), diagnostics);
  for (const parameter of parameters) scope.introduce(parameter, diagnostics);
  for (const [name, binding] of [
    ['actor', actorBinding(null, body.at)],
    ['here', hereBinding(body.at)],
  ] as const) {
    if (scope.lookup(name) !== null) continue;
    const words = {
      message: `\`${name}\` is not bound inside \`${written}\`: nobody is acting when a message arrives.`,
      remedy:
        'Name what you mean through what the message passes, as `on :entered (item, from)` names what arrived.',
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
    acting: { verbs: setting.verbs },
    ...(setting.names === undefined ? {} : { names: setting.names }),
    ...(setting.messages === undefined ? {} : { messages: setting.messages }),
  };
  checkBlock(body, context, { body: 'handler', written });
}
