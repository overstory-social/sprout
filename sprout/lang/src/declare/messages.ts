// Messages, and the value they carry (the spec's Events › Declaring a
// message).
//
// A message is declared beside verbs and enums, by a world or a library,
// with the type of the value it carries if it carries one. Sending an
// undeclared message, or a declared one with the wrong value, is a
// compile error — which is what makes a misspelt `:illumnating` an error
// rather than a handler that never fires.
//
// Checking a SEND against this table is B32's, and a handler's value
// binding is `check/bindings.ts`'s. What is here is the declaration and
// the table they both read.

import type { MessageDeclaration } from '../syntax/ast.js';
import type { Diagnostics } from '../source/diagnostics.js';
import { readable } from '../source/words.js';
import { ENGINE_MESSAGES, engineMessage } from './engine-messages.js';
import type { EnumTable } from './enums.js';
import { qualifiedName, SPROUT } from './enums.js';
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

/** Every message the bundle declares, by library and name. */
export class MessageTable {
  private readonly byQualified = new Map<string, DeclaredMessage>();

  /**
   * Add a library's declarations, resolving what each carries. Two
   * messages of one name in one library collide; two in different
   * libraries do not, because libraries namespace messages. No library
   * may take an engine message's name (the spec's Reserved names).
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
