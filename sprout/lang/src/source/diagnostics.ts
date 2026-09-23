// What the compiler says, and where (the spec's The compiler ›
// Diagnostics). The wording of each message and the list of warnings are
// B50's; what is here is the carrier — a problem is a SPAN, a sentence
// and, where there is one, the thing to write instead — and the shape it
// prints in:
//
//   kiln.sprout:23:9    `:door` holds one of open, closed — "closed" is a string.
//                       Write :closed.
//
// A group is aligned to its widest location, so a page of problems reads
// as a column of places and a column of sentences.
//
// Compile outcomes are RETURNED, never thrown (core's errors.ts keeps the
// same line): a refusal is an answer about the world, and an author owed
// a hundred of them is owed all hundred, not the first.

import type { Span } from './source.js';
import { locationOf, positionOf } from './source.js';

/**
 * A refusal is the compiler declining the world — strict at save and
 * publish, and at load only for what the absent table does not cover. A
 * warning is the world compiling with something worth saying about it.
 */
export type Severity = 'refusal' | 'warning';

export interface Diagnostic {
  readonly severity: Severity;
  /** The token the problem is about — never the head of the definition it sits in. */
  readonly at: Span;
  /** One sentence, for someone who is not a programmer. */
  readonly message: string;
  /** What to write instead, where there is something to write. */
  readonly remedy?: string;
  /**
   * The language level this refusal was introduced at, where it is a
   * POLICY the language tightened rather than something that was always
   * wrong. A world accepted at one level keeps loading when the language
   * tightens: at load, a refusal introduced after the level a world was
   * written for applies to it as a warning, never as an error. See
   * `softenPolicy`.
   */
  readonly since?: number;
}

function made(
  severity: Severity,
  at: Span,
  message: string,
  remedy?: string,
  since?: number,
): Diagnostic {
  const diagnostic: Diagnostic = { severity, at, message };
  return {
    ...diagnostic,
    ...(remedy === undefined ? {} : { remedy }),
    ...(since === undefined ? {} : { since }),
  };
}

/** A refusal about the token at `at`. `since` marks it as a policy the language tightened. */
export function refusal(at: Span, message: string, remedy?: string, since?: number): Diagnostic {
  return made('refusal', at, message, remedy, since);
}

/** A warning about the token at `at`. */
export function warning(at: Span, message: string, remedy?: string, since?: number): Diagnostic {
  return made('warning', at, message, remedy, since);
}

/**
 * A world accepted at one level keeps loading when the language tightens
 * (the spec's The compiler › Language levels). A refusal introduced
 * after the level a world was written for applies to that world as a
 * WARNING rather than as an error, so the language can grow stricter
 * without darkening a room somebody already built.
 *
 * A refusal with no `since` was always wrong and stays a refusal.
 */
export function softenPolicy(diagnostics: readonly Diagnostic[], writtenFor: number): Diagnostic[] {
  return diagnostics.map((diagnostic) =>
    diagnostic.severity === 'refusal' &&
    diagnostic.since !== undefined &&
    diagnostic.since > writtenFor
      ? { ...diagnostic, severity: 'warning' }
      : diagnostic,
  );
}

/**
 * Reading order: by file, then by where in it, then refusals before
 * warnings about the same token. Stable, so the same source always
 * reports the same list in the same order — a diagnostic list that
 * shuffles cannot be a golden file.
 */
export function inReadingOrder(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort((a, b) => {
    if (a.at.source.name !== b.at.source.name) {
      return a.at.source.name < b.at.source.name ? -1 : 1;
    }
    if (a.at.start !== b.at.start) return a.at.start - b.at.start;
    if (a.at.end !== b.at.end) return a.at.end - b.at.end;
    if (a.severity !== b.severity) return a.severity === 'refusal' ? -1 : 1;
    return 0;
  });
}

/** Every line of a diagnostic's prose: the sentence, then the remedy. */
function linesOf(diagnostic: Diagnostic): string[] {
  const lines = diagnostic.message.split('\n');
  if (diagnostic.remedy !== undefined) lines.push(...diagnostic.remedy.split('\n'));
  return lines;
}

/**
 * One diagnostic, the location in a gutter of `width` characters. The
 * gutter is at least two spaces past the longest location so that the
 * sentences line up in a column of their own.
 */
export function renderDiagnostic(diagnostic: Diagnostic, width?: number): string {
  const location = locationOf(diagnostic.at);
  const gutter = Math.max(width ?? 0, location.length + 2);
  const [first = '', ...rest] = linesOf(diagnostic);
  const head = location.padEnd(gutter) + first;
  return [head, ...rest.map((line) => ' '.repeat(gutter) + line)].join('\n');
}

/** A page of diagnostics in reading order, aligned to the widest location, one blank line apart. */
export function renderDiagnostics(diagnostics: readonly Diagnostic[]): string {
  const ordered = inReadingOrder(diagnostics);
  const width = ordered.reduce((wide, d) => Math.max(wide, locationOf(d.at).length + 2), 0);
  return ordered.map((d) => renderDiagnostic(d, width)).join('\n\n');
}

/**
 * Where diagnostics are collected while something compiles. One of these
 * is threaded through a compile; nothing else decides whether a problem
 * is fatal, because that is `refused` at the end and the caller's to act
 * on.
 */
export class Diagnostics {
  private readonly collected: Diagnostic[] = [];

  /** Refuse the token at `at`, saying what to write instead where there is something. */
  refuse(at: Span, message: string, remedy?: string, since?: number): Diagnostic {
    const diagnostic = refusal(at, message, remedy, since);
    this.collected.push(diagnostic);
    return diagnostic;
  }

  /** Warn about the token at `at`. A warning never refuses a world. */
  warn(at: Span, message: string, remedy?: string, since?: number): Diagnostic {
    const diagnostic = warning(at, message, remedy, since);
    this.collected.push(diagnostic);
    return diagnostic;
  }

  /** Take in diagnostics raised somewhere else — another file, another tier. */
  add(...diagnostics: readonly Diagnostic[]): void {
    this.collected.push(...diagnostics);
  }

  /** Everything raised, in the order it was raised. */
  get all(): readonly Diagnostic[] {
    return this.collected;
  }

  get refusals(): readonly Diagnostic[] {
    return this.collected.filter((d) => d.severity === 'refusal');
  }

  get warnings(): readonly Diagnostic[] {
    return this.collected.filter((d) => d.severity === 'warning');
  }

  /** Whether anything raised refuses the world. */
  get refused(): boolean {
    return this.collected.some((d) => d.severity === 'refusal');
  }

  /** Everything raised, in reading order. */
  sorted(): Diagnostic[] {
    return inReadingOrder(this.collected);
  }

  /** The whole page, as it prints. */
  render(): string {
    return renderDiagnostics(this.collected);
  }
}

/** Somewhere to refuse and warn, as `Diagnostics` is. */
export interface Sayer {
  refuse(at: Span, message: string, remedy?: string): void;
  warn(at: Span, message: string, remedy?: string): void;
}

/**
 * Say through `diagnostics` each refusal or warning once per place and
 * words: for what reads one declaration in several places, as every
 * instance of a kind reads what the kind's body holds.
 */
export function onceEach(diagnostics: Diagnostics): Sayer {
  const said = new Set<string>();
  const first = (at: Span, message: string): boolean => {
    const key = `${at.source.name}:${at.start}:${message}`;
    if (said.has(key)) return false;
    said.add(key);
    return true;
  };
  return {
    refuse: (at, message, remedy) => {
      if (first(at, message)) diagnostics.refuse(at, message, remedy);
    },
    warn: (at, message, remedy) => {
      if (first(at, message)) diagnostics.warn(at, message, remedy);
    },
  };
}

/** `23:9` — a span's line and column without its file, for a message about one file. */
export function lineAndColumn(at: Span): string {
  const { line, column } = positionOf(at);
  return `${line}:${column}`;
}
