import {
  LANGUAGE_LEVEL,
  compileMicroworld,
  type Archive,
  type MicroworldProblem,
  type Program,
} from '@overstory/sprout';
import { MEDIA } from '@overstory/sprout-ext-media';

// `sprout check` (the split proposal §6): `compileMicroworld` in strict
// mode with the extensions the CLI installs — problems by file, line
// and column, or as JSON (§3.3's `Problem`, exactly) for an editor or a
// CI step; exit 1 on any. An archive that `use`s an extension the CLI
// lacks fails here with the extension's name, as the compiler says it.

/** The extensions this CLI installs: pictures (`use media`). */
export const EXTENSIONS = MEDIA;

export interface CheckResult {
  ok: boolean;
  problems: MicroworldProblem[];
  warnings: string[];
  program: Program;
}

export function checkArchive(archive: Archive): CheckResult {
  const problems: MicroworldProblem[] = [];
  if (archive.manifest && archive.manifest.language > LANGUAGE_LEVEL) {
    problems.push({
      file: 'sprout.json',
      definition: null,
      line: 1,
      column: 1,
      message: `This archive needs language level ${archive.manifest.language}; this sprout speaks ${LANGUAGE_LEVEL}.`,
    });
  }
  const {
    program,
    problems: compiled,
    warnings,
  } = compileMicroworld(archive, {
    strict: true,
    ext: EXTENSIONS,
  });
  problems.push(...compiled);
  return { ok: problems.length === 0, problems, warnings, program };
}

/** `file:line:column message`, one per line, then the warnings; or "ok" with the counts. */
export function formatCheck(result: CheckResult): string {
  const lines = result.problems.map((p) => `${p.file ?? '-'}:${p.line}:${p.column} ${p.message}`);
  for (const w of result.warnings) lines.push(`warning: ${w}`);
  if (result.ok) {
    const { program } = result;
    lines.push(
      `ok: ${program.rooms.size} rooms, ${program.objects.size} objects, ${program.kinds.size} kinds${program.entry ? `, the door is ${program.entry}` : ', no door'}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

/** The same, as JSON: `{ ok, problems, warnings }`, each problem as the compiler gave it. */
export function formatCheckJson(result: CheckResult): string {
  return `${JSON.stringify(
    { ok: result.ok, problems: result.problems, warnings: result.warnings },
    null,
    2,
  )}\n`;
}
