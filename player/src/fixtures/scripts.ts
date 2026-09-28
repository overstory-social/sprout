import { lineOf, plays, stepOfLine, type Script, type Step } from '../script.js';

// Spec support for the player, the REPL and the CLI, never imported by a
// command: a script written as typed lines, and a played script read as
// the transcript an interactive session prints with `--debug`.

/** `lines` in the typed line grammar, one step each, as a script; thrown as `stepOfLine` throws, naming `name:line`. */
export function scriptOf(lines: string, name = 'yard.json'): Script {
  const steps: Step[] = [];
  for (const [i, line] of lines.split('\n').entries()) {
    const step = stepOfLine(line, `${name}:${i + 1}`);
    if (step !== null) steps.push(step);
  }
  return { steps };
}

/** `script` as a transcript: each step's line, and under it what it expects, a host line by its text. */
export function transcriptOf(script: Script): string {
  const lines = script.steps.flatMap((step) => {
    const expect = plays(step) ? step.expect : undefined;
    if (expect === undefined) return [lineOf(step)];
    const under =
      expect.length === 0
        ? ['(nothing)']
        : expect.map((one) =>
            'level' in one
              ? one.text
              : 'reader' in one
                ? `${one.reader} (${one.kind}): ${one.words}`
                : one.words,
          );
    return [lineOf(step), ...under.map((line) => `  ${line}`)];
  });
  return lines.map((line) => `${line}\n`).join('');
}
