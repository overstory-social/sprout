import {
  compileBundle,
  DEFAULT_BLESSED,
  inReadingOrder,
  positionOf,
  renderDiagnostics,
  type Bundle,
  type Diagnostic,
} from '@overstory/sprout/lang';

import { readWorld } from './world.js';

// `sprout check`: compile a folder strictly, as publishing would, and
// report every diagnostic by file, line and column — as a page for a
// person, or as JSON for an editor or a script. Exit 1 on any refusal.
// It blesses what a host starts from, the standard library's hash, since
// "using the standard library costs an author nothing" (the spec's
// Limits › Static caps).

export interface CheckResult {
  readonly ok: boolean;
  readonly diagnostics: readonly Diagnostic[];
  readonly bundle: Bundle | null;
}

export function checkWorld(dir: string): CheckResult {
  const world = readWorld(dir);
  if (world.source === null) {
    return { ok: false, diagnostics: inReadingOrder(world.diagnostics), bundle: null };
  }
  const { bundle, diagnostics } = compileBundle(world.source, {
    mode: 'publish',
    blessed: DEFAULT_BLESSED,
  });
  const all = inReadingOrder([...world.diagnostics, ...diagnostics]);
  return { ok: bundle !== null, diagnostics: all, bundle };
}

/**
 * The world's own declarations: what its files hold, not the libraries it
 * vendored, and every object written in the world's body at any depth.
 */
function ownDeclarations(bundle: Bundle): number {
  const vendored = new Set(bundle.libraries.flatMap((library) => library.files));
  return (
    bundle.definitions.filter((d) => !vendored.has(d.at.source)).length + bundle.objects.length
  );
}

/** The diagnostics as a page, then one line saying what was checked. */
export function formatCheck(result: CheckResult): string {
  const page = renderDiagnostics(result.diagnostics);
  const refusals = result.diagnostics.filter((d) => d.severity === 'refusal').length;
  const warnings = result.diagnostics.length - refusals;
  const summary = result.ok
    ? `ok: ${ownDeclarations(result.bundle!)} declarations in ${result.bundle!.manifest.files.length} files${warnings > 0 ? `, ${warnings} warning${warnings === 1 ? '' : 's'}` : ''}`
    : `refused: ${refusals} problem${refusals === 1 ? '' : 's'}`;
  return page.length > 0 ? `${page}\n\n${summary}\n` : `${summary}\n`;
}

/** One JSON object per diagnostic, with the position worked out. */
export function formatCheckJson(result: CheckResult): string {
  const diagnostics = result.diagnostics.map((d) => {
    const { line, column } = positionOf(d.at);
    return {
      file: d.at.source.name,
      line,
      column,
      severity: d.severity,
      message: d.message,
      ...(d.remedy === undefined ? {} : { remedy: d.remedy }),
    };
  });
  return `${JSON.stringify({ ok: result.ok, diagnostics }, null, 2)}\n`;
}
