// What a case of the engine conformance suite checks with, importing no
// test framework: each throws, naming what it checked, where it fails.
// Values are compared as JSON with every object's keys sorted, since the
// order of an object's keys is no part of what an engine gives.

/** `v` with every object's keys in sorted order. */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

const shown = (v: unknown) => JSON.stringify(canonical(v));

/** Throws where `cond` is false. */
export function ok(cond: unknown, what: string): asserts cond {
  if (!cond) throw new Error(`engine conformance: ${what}`);
}

/** Throws where `actual` is not `expected`. */
export function equal(actual: unknown, expected: unknown, what: string): void {
  const a = shown(actual);
  const b = shown(expected);
  if (a !== b) throw new Error(`engine conformance: ${what}\n  expected ${b}\n  received ${a}`);
}

/** Whether `actual` holds everything `partial` does: each key of an object, and every item of a list, in order. */
function holds(actual: unknown, partial: unknown): boolean {
  if (Array.isArray(partial)) {
    return (
      Array.isArray(actual) &&
      actual.length === partial.length &&
      partial.every((one, at) => holds(actual[at], one))
    );
  }
  if (partial !== null && typeof partial === 'object') {
    if (actual === null || typeof actual !== 'object') return false;
    return Object.entries(partial).every(([key, one]) =>
      holds((actual as Record<string, unknown>)[key], one),
    );
  }
  return Object.is(actual, partial);
}

/** Throws where `actual` does not hold all `partial` does. */
export function match(actual: unknown, partial: unknown, what: string): void {
  if (!holds(actual, partial)) {
    throw new Error(
      `engine conformance: ${what}\n  expected to hold ${shown(partial)}\n  received ${shown(actual)}`,
    );
  }
}

/** Throws where `run` does not reject with words that match `words`. */
export async function rejects(
  run: () => Promise<unknown>,
  words: RegExp,
  what: string,
): Promise<void> {
  try {
    await run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ok(words.test(message), `${what}: refused as ${message}`);
    return;
  }
  throw new Error(`engine conformance: ${what}: it was taken`);
}
