// An extension's code, run where the evaluator can contain it (the
// spec's Extensions › Trust). A throw from an extension, or an answer it
// may not give, becomes a fault naming the extension, which abandons the
// turn as any fault does; it contains a buggy extension, never a
// malicious one.

import type { InstanceId } from './ids.js';

/** An extension that threw, or gave what it may not, while a turn ran it. */
export class ExtensionFault extends Error {
  constructor(
    readonly extension: string,
    /** The object whose body ran it, where one did. */
    readonly object: InstanceId | null,
    detail: string,
  ) {
    super(`The extension \`${extension}\` ${detail}`);
    this.name = 'ExtensionFault';
  }
}

/** What `run` gives, where it gives it; a throw from it, a fault naming `extension`. */
export function guarded<T>(
  extension: string,
  object: InstanceId | null,
  what: string,
  run: () => T,
): T {
  try {
    return run();
  } catch (thrown) {
    const detail = thrown instanceof Error ? thrown.message : String(thrown);
    throw new ExtensionFault(extension, object, `threw ${what}: ${detail}.`);
  }
}
