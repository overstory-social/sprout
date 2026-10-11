// What one compile has to say, and the one decision its two modes turn
// on (the spec's The compiler › Strict and lenient, What absent means).
// Saving and publishing are strict: any problem is a refusal. Loading is
// lenient: what is missing reads as absent, the gap is recorded in the
// bundle and warned about, and the world runs around it.

import type { CompileMode, Absent } from '../absent.js';
import { Diagnostics } from '../../source/diagnostics.js';
import type { Span } from '../../source/source.js';

/** A table cell, written as a sentence: the rows read as `the object is absent`, lower-case. */
function sentence(cell: string): string {
  return `${cell.charAt(0).toUpperCase()}${cell.slice(1)}.`;
}

/**
 * The one decision the two modes turn on: at publish a problem refuses,
 * at load the same problem is a gap the world runs around. Every
 * module of a compile says which it is raising and lets this answer.
 */
export class Report {
  readonly diagnostics = new Diagnostics();
  readonly absent: Absent[] = [];
  /**
   * Whether a library the manifest named did not travel, or travelled at
   * another hash: absent, per the spec's Kinds › Libraries and
   * namespaces. At publish that is the whole page: everything made of
   * the library would be refused once more at each use, so the compile
   * stops at the manifest and says the one thing it knows.
   */
  private unusableLibrary = false;

  /** @param anywhere where a gap with nothing of its own to point at is reported. */
  constructor(
    readonly mode: CompileMode,
    private readonly anywhere: Span,
  ) {}

  /** Record that a library the manifest named is not usable. */
  libraryRefused(): void {
    this.unusableLibrary = true;
  }

  /** Whether a library the manifest named is not usable, so at publish nothing past the manifest is worth saying. */
  get stopsAtManifest(): boolean {
    return this.mode === 'publish' && this.unusableLibrary;
  }

  /** Always wrong, in either mode: a refusal that leniency does not soften. */
  refuse(at: Span, message: string, remedy?: string): void {
    this.diagnostics.refuse(at, message, remedy);
  }

  /** Worth saying, never fatal. */
  warn(at: Span, message: string, remedy?: string): void {
    this.diagnostics.warn(at, message, remedy);
  }

  /**
   * Wrong to publish and survivable to run: a refusal at publish, a
   * warning at load. Refusing at load would darken a world that was
   * accepted once, which is the opposite of what leniency is for.
   */
  strict(at: Span, message: string, remedy?: string): void {
    if (this.mode === 'publish') this.refuse(at, message, remedy);
    else this.warn(at, message, remedy);
  }

  /**
   * Something is not there. At publish that refuses — a world is not
   * published with a piece missing. At load it is a gap: recorded,
   * warned about, and run around.
   */
  gap(absent: Absent, message: string, remedy?: string): void {
    const at = absent.at ?? this.anywhere;
    if (this.mode === 'publish') {
      this.refuse(at, message, remedy);
      return;
    }
    this.absent.push(absent);
    this.warn(at, `${message} ${sentence(absent.consequence)}`, remedy);
  }
}

/** Refuse a name that appears twice in a list, naming the second one. */
export function refuseRepeats(
  report: Report,
  named: readonly { name: string; at: Span }[],
  what: string,
): void {
  const seen = new Set<string>();
  for (const { name, at } of named) {
    if (seen.has(name)) {
      report.refuse(
        at,
        `There are two ${what} called "${name}".`,
        'Give one of them another name, or remove it.',
      );
    }
    seen.add(name);
  }
}
