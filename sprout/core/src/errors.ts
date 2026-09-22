// One error class with codes, and one rule: compile outcomes are always
// RETURNED as `problems`, never thrown; everything else throws a
// SproutError. A fault is neither — it is a turn's outcome.

export type SproutErrorCode =
  | 'no-such-microworld'
  | 'language-too-new'
  | 'not-loaded'
  | 'limit-exceeded'
  | 'no-such-extension'
  | 'duplicate-name';

export class SproutError extends Error {
  constructor(
    readonly code: SproutErrorCode,
    readonly detail: string,
  ) {
    super(`${code}: ${detail}`);
    this.name = 'SproutError';
  }
}
