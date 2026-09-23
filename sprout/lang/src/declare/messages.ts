// Messages, and the value they carry (the spec's Events › Declaring a
// message).
//
// A message is declared beside verbs and enums, by a world or a library,
// with the type of the value it carries if it carries one. Sending an
// undeclared message, or a declared one with the wrong value, is a
// compile error — which is what makes a misspelt `:illumnating` an error
// rather than a handler that never fires.
//
// What a message name reaches from inside a library is here too, since a
// handler, a pass rule and a send all ask it the same way: one of the
// engine's own by its name, else the library's own message, else the
// standard library's. A handler's value binding is `check/bindings.ts`'s.

import type { MessageDeclaration } from '../syntax/ast.js';
import type { Diagnostics } from '../source/diagnostics.js';
import { isMemberWord } from '../syntax/reserved.js';
import { readable } from '../source/words.js';
import { ENGINE_MESSAGES, engineMessage, type EngineMessage } from './engine-messages.js';
import type { EnumTable } from './enums.js';
import { nearestOption, qualifiedName, SPROUT } from './enums.js';
import { resolveType, type ValueType } from './types.js';

const ENGINE_NAMES = ENGINE_MESSAGES.map((message) => `:${message.name}`);

/** A message as the whole bundle sees it: whose it is, what it is called, what it carries. */
export interface DeclaredMessage {
  readonly library: string;
  readonly name: string;
  /** The type of the value it carries, or null when it carries none. */
  readonly carries: ValueType | null;
  readonly declaration: MessageDeclaration;
}

/** Every message the bundle declares, asked the two ways a kind is. */
export interface MessageLookup {
  qualified(library: string, name: string): DeclaredMessage | null;
  unqualified(name: string, from: string): DeclaredMessage | null;
  all(): readonly DeclaredMessage[];
}

/** What a message's name reaches: one of the engine's, or one a library declares. */
export type ReachedMessage =
  { readonly engine: EngineMessage } | { readonly declared: DeclaredMessage };

/**
 * The message `name` reaches from inside `from`: the engine's of that
 * name, else `from`'s own, else the standard library's; null where
 * nothing answers.
 */
export function reachMessage(
  name: string,
  from: string,
  messages: MessageLookup,
): ReachedMessage | null {
  const engine = engineMessage(name);
  if (engine !== null) return { engine };
  const declared = messages.unqualified(name, from);
  return declared === null ? null : { declared };
}

/**
 * The one key a message is known by across the bundle: an engine
 * message's bare name, a declared one's qualified name. A qualified name
 * always holds a dot and a bare one never does, so the two cannot meet.
 */
export function messageKey(reached: ReachedMessage): string {
  return 'engine' in reached
    ? reached.engine.name
    : qualifiedName(reached.declared.library, reached.declared.name);
}

/** What is said of a message nothing in reach of `from` declares, with the one most likely meant. */
export function unknownMessage(
  name: string,
  from: string,
  messages: MessageLookup,
): { message: string; remedy: string } {
  const reachable = messages
    .all()
    .filter((one) => one.library === from || one.library === SPROUT)
    .map((one) => one.name);
  const meant = nearestOption(name, [...reachable, ...ENGINE_MESSAGES.map((one) => one.name)]);
  return {
    message: `Nothing declares a message \`:${name}\`.${meant === null ? '' : ` Did you mean \`:${meant}\`?`}`,
    remedy:
      meant === null
        ? `Declare it with \`message :${name}\`, beside the world's kinds and verbs.`
        : `Write \`:${meant}\`, or declare \`message :${name}\`.`,
  };
}

/** Every message the bundle declares, by library and name. */
export class MessageTable implements MessageLookup {
  private readonly byQualified = new Map<string, DeclaredMessage>();

  /**
   * Add a library's declarations, resolving what each carries. Two
   * messages of one name in one library collide; two in different
   * libraries do not, because libraries namespace messages. No library
   * may take an engine message's name or a member's word (the spec's
   * Names › Reserved names).
   */
  add(
    library: string,
    declarations: readonly MessageDeclaration[],
    enums: EnumTable,
    diagnostics: Diagnostics,
  ): void {
    for (const declared of declarations) {
      if (engineMessage(declared.name.text) !== null) {
        diagnostics.refuse(
          declared.name.at,
          `\`:${declared.name.text}\` is one of the engine's messages, and the engine sends those itself.`,
          `The engine's messages are ${readable(ENGINE_NAMES)}. Name yours for what it means to your world, as in \`:rang\`.`,
        );
        continue;
      }
      if (isMemberWord(declared.name.text)) {
        diagnostics.refuse(
          declared.name.at,
          `\`:${declared.name.text}\` names a member of a kind, so it cannot name a message.`,
          'Choose another word, as in `:rang`.',
        );
        continue;
      }
      const key = qualifiedName(library, declared.name.text);
      if (this.byQualified.has(key)) {
        diagnostics.refuse(
          declared.name.at,
          `${library} declares two messages called \`:${declared.name.text}\`.`,
          'Give one of them another name, or remove it.',
        );
        continue;
      }
      let carries: ValueType | null = null;
      if (declared.carries !== null) {
        carries = resolveType(declared.carries, enums, library, diagnostics);
        if (carries === null) continue;
      }
      this.byQualified.set(key, {
        library,
        name: declared.name.text,
        carries,
        declaration: declared,
      });
    }
  }

  /** A message by its full identity: `sprout.stir` is not `ericworld.stir`. */
  qualified(library: string, name: string): DeclaredMessage | null {
    return this.byQualified.get(qualifiedName(library, name)) ?? null;
  }

  /** A message written without a library: the asking world's own first, then `sprout`'s. */
  unqualified(name: string, from: string): DeclaredMessage | null {
    return this.qualified(from, name) ?? this.qualified(SPROUT, name);
  }

  /** Every message in the bundle, in the order it was added. */
  all(): DeclaredMessage[] {
    return [...this.byQualified.values()];
  }
}
