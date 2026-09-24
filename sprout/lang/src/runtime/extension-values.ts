// A value of an extension's type while the world runs (the spec's
// Extensions › What an extension may add, Activation and absence). It
// carries what the extension reads it as and the text it persists as, so
// storing it never runs the extension again. Where the extension is
// absent its type holds its default: the value is the text written or
// stored, kept unread for the extension's return, and renders nothing.

import { frozenPlain, readLiteral, type Plain } from '../declare/extensions.js';
import type { ExtensionType } from '../declare/types.js';
import { ExtensionFault, guarded } from './extension-fault.js';

/** One value of an extension's type: its reading (null where the extension is absent) and its stored text. */
export class ExtensionValue {
  constructor(
    readonly type: ExtensionType,
    readonly value: Plain,
    readonly stored: string,
  ) {}

  /** As a message names it: as the extension prints it, or its stored text where it cannot. */
  toString(): string {
    try {
      const printed = this.type.definition?.print(this.value);
      return typeof printed === 'string' ? printed : this.stored;
    } catch {
      return this.stored;
    }
  }
}

/** What text in quotes is as a value of `type`, which the checker has had the extension read. */
export function extensionLiteral(type: ExtensionType, text: string): ExtensionValue {
  const { definition } = type;
  if (definition === null) return new ExtensionValue(type, null, text);
  const read = readLiteral(type.extension, definition, text);
  if (!('value' in read)) throw new ExtensionFault(type.extension, null, read.problem);
  return new ExtensionValue(type, read.value, persisted(type, read.value));
}

/** A stored value read back under `type`; null where the extension no longer takes it, and the default stands. */
export function restoredExtension(type: ExtensionType, stored: string): ExtensionValue | null {
  const { definition } = type;
  if (definition === null) return new ExtensionValue(type, null, stored);
  const restored = guarded(type.extension, null, 'restoring a stored value', () =>
    definition.restore(stored),
  );
  if (restored === null) return null;
  const value = frozenPlain(restored);
  if (value === undefined) {
    throw new ExtensionFault(type.extension, null, 'restored a value that is not plain.');
  }
  return new ExtensionValue(type, value, stored);
}

/** Whether two values of one extension type are the same, as `==` asks: the extension's answer, or, absent, the stored text's. */
export function sameExtension(a: ExtensionValue, b: ExtensionValue): boolean {
  const { definition } = a.type;
  if (definition === null) return a.stored === b.stored;
  const compares = definition.compares;
  if (compares === false) {
    throw new Error(
      `\`==\` on \`${a.type.extension}.${a.type.name}\` reached the runtime; the checker refuses it.`,
    );
  }
  const same = guarded(a.type.extension, null, 'comparing two values', () =>
    compares(a.value, b.value),
  );
  if (typeof same !== 'boolean') {
    throw new ExtensionFault(
      a.type.extension,
      null,
      'answered a comparison with something not true or false.',
    );
  }
  return same;
}

/** The words a slot renders `value` as: the extension's, or nothing where it is absent. */
export function extensionWords(value: ExtensionValue): string {
  const { definition } = value.type;
  if (definition === null) return '';
  const renders = definition.renders;
  if (renders === false) {
    throw new Error(
      `a slot of \`${value.type.extension}.${value.type.name}\` reached the runtime; the checker refuses it.`,
    );
  }
  const words = guarded(value.type.extension, null, 'rendering a value', () =>
    renders(value.value),
  );
  if (typeof words !== 'string') {
    throw new ExtensionFault(
      value.type.extension,
      null,
      'rendered a value as something not words.',
    );
  }
  return words;
}

function persisted(type: ExtensionType, value: Plain): string {
  const definition = type.definition!;
  const stored = guarded(type.extension, null, 'persisting a value', () =>
    definition.persist(value),
  );
  if (typeof stored !== 'string') {
    throw new ExtensionFault(type.extension, null, 'persisted a value as something not text.');
  }
  return stored;
}
