// A script: what visitors type and what the host does, in order, as JSON
// (the spec's The compiler › The command line). Each step is one visitor
// typing a line, `{ "as": "Marta", "type": "take brass key" }`, or one
// host event: `{ "arrive": "Marta" }`, `{ "leave": "Marta" }`,
// `{ "tick": true }`, `{ "advance": "40 minutes" }`, `{ "seed": 7 }`; a
// `{ "comment": "…" }` step is kept as written. A step that plays may
// carry `expect`, what it should make: a reader's line whole, `{ "reader",
// "kind", "words" }`; the words alone, which any reader reading them
// matches; or any other line at its level, `{ "level", "text" }`, the
// level one of the spec's five (The runtime › Levels). `"expect": []` is
// silence.
//
// The typed line grammar an interactive session reads, `Marta> take brass
// key` and `@arrive Marta`, is read into the same steps, so what a session
// records is a script.

import { isLevel, type Level } from '@overstory/sprout/lang';

/** What a step should make: one line a reader read, its words alone, or any other line at its level. */
export type Expectation =
  | { readonly reader: string; readonly kind: string; readonly words: string }
  | { readonly words: string }
  | { readonly level: Level; readonly text: string };

/** One step of a script. */
export type Step = { readonly comment: string } | { readonly seed: number } | Playing;

/** A step that plays, and may say what it should make. */
export type Playing = (
  | { readonly as: string; readonly type: string }
  | { readonly arrive: string }
  | { readonly leave: string }
  | { readonly tick: true }
  | { readonly advance: string }
) & { readonly expect?: readonly Expectation[] };

/** Whether `step` plays, as every step but a comment and `@seed` does. */
export function plays(step: Step): step is Playing {
  return !('comment' in step) && !('seed' in step);
}

export interface Script {
  /** What the script is about, kept as written. */
  readonly about?: string;
  readonly steps: readonly Step[];
}

const UNITS: Readonly<Record<string, number>> = {
  second: 1,
  seconds: 1,
  minute: 60,
  minutes: 60,
  hour: 3600,
  hours: 3600,
};

/** `Marta> take brass key`: who types it and what they typed. */
export const TYPED_LINE = /^([^\s>@#][^>]*)> ?(.*)$/;

const SHAPES =
  'a step is `{ "as": "Marta", "type": "look" }`, `{ "arrive": "Marta" }`, `{ "leave": "Marta" }`, ' +
  '`{ "tick": true }`, `{ "advance": "40 minutes" }`, `{ "seed": 7 }` or `{ "comment": "…" }`';

/** How long `advance` says passes, in seconds; null where it does not say it as `40 minutes`. */
export function secondsOf(advance: string): number | null {
  const [count, unit, ...rest] = advance.trim().split(/\s+/);
  const each = unit === undefined ? undefined : UNITS[unit];
  if (rest.length > 0 || !/^\d+$/.test(count ?? '') || each === undefined) return null;
  return Number(count) * each;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function expectationOf(value: unknown, where: string): Expectation {
  if (isRecord(value)) {
    const keys = Object.keys(value).sort().join(',');
    if (keys === 'kind,reader,words' && nonEmpty(value['reader']) && nonEmpty(value['kind'])) {
      if (typeof value['words'] === 'string') {
        return { reader: value['reader'], kind: value['kind'], words: value['words'] };
      }
    }
    if (keys === 'words' && typeof value['words'] === 'string') return { words: value['words'] };
    if (keys === 'level,text' && typeof value['text'] === 'string') {
      const level = value['level'];
      if (isLevel(level)) return { level, text: value['text'] };
    }
  }
  throw new Error(
    `${where}: an expected line is \`{ "words": "You take a brass key." }\`, ` +
      '`{ "reader": "Ines", "kind": "told", "words": "Marta takes a brass key." }` ' +
      'or a line at its level, `{ "level": "info", "text": "…" }`, the level one of ' +
      '`prose`, `error`, `warning`, `info` and `debug`.',
  );
}

function stepOf(value: unknown, where: string): Step {
  if (!isRecord(value)) throw new Error(`${where}: ${SHAPES}.`);
  const { expect, ...rest } = value;
  const keys = Object.keys(rest).sort().join(',');
  let step: Step;
  if (keys === 'as,type' && nonEmpty(rest['as']) && typeof rest['type'] === 'string') {
    step = { as: rest['as'], type: rest['type'] };
  } else if (keys === 'arrive' && nonEmpty(rest['arrive'])) step = { arrive: rest['arrive'] };
  else if (keys === 'leave' && nonEmpty(rest['leave'])) step = { leave: rest['leave'] };
  else if (keys === 'tick' && rest['tick'] === true) step = { tick: true };
  else if (keys === 'advance' && typeof rest['advance'] === 'string') {
    if (secondsOf(rest['advance']) === null) {
      throw new Error(`${where}: write how long passes, as in \`{ "advance": "40 minutes" }\`.`);
    }
    step = { advance: rest['advance'] };
  } else if (keys === 'seed' && Number.isSafeInteger(rest['seed']) && Number(rest['seed']) >= 0) {
    step = { seed: Number(rest['seed']) };
  } else if (keys === 'comment' && typeof rest['comment'] === 'string') {
    step = { comment: rest['comment'] };
  } else throw new Error(`${where}: ${SHAPES}.`);
  if (expect === undefined) return step;
  if ('seed' in step || 'comment' in step) {
    throw new Error(`${where}: \`${lineOf(step)}\` makes nothing, so it expects nothing.`);
  }
  if (!Array.isArray(expect)) {
    throw new Error(`${where}: \`expect\` is a list of lines, or \`[]\` for silence.`);
  }
  return {
    ...step,
    expect: expect.map((one, i) => expectationOf(one, `${where}, expect ${i + 1}`)),
  };
}

/** `text` as a script named `name`; thrown, saying where and what to write, where it is not one. */
export function readScript(text: string, name: string): Script {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    throw new Error(`${name}: not JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!isRecord(value) || !Array.isArray(value['steps'])) {
    throw new Error(`${name}: a script is \`{ "steps": [ … ] }\`, and ${SHAPES}.`);
  }
  const extra = Object.keys(value).filter((key) => key !== 'steps' && key !== 'about');
  if (extra.length > 0 || (value['about'] !== undefined && typeof value['about'] !== 'string')) {
    throw new Error(`${name}: a script holds \`steps\` and, if you like, \`about\`, a string.`);
  }
  const steps = value['steps'].map((step, i) => stepOf(step, `${name}, step ${i + 1}`));
  return typeof value['about'] === 'string' ? { about: value['about'], steps } : { steps };
}

/** `value` as JSON on one line, spaced as a person writes it: `{ "arrive": "Marta" }`. */
function inline(value: object): string {
  const parts = Object.entries(value).map(
    ([key, one]) => `${JSON.stringify(key)}: ${JSON.stringify(one)}`,
  );
  return `{ ${parts.join(', ')} }`;
}

/**
 * `script` as its file holds it: one step to a line, and each line a step
 * expects on a line of its own under it, so a golden reads down the page
 * as the transcript it is.
 */
export function writeScript(script: Script): string {
  const steps = script.steps.map((step) => {
    if (!plays(step) || step.expect === undefined) return `    ${inline(step)}`;
    const { expect, ...head } = step;
    const opened = inline(head).slice(0, -2);
    if (expect.length === 0) return `    ${opened}, "expect": [] }`;
    const lines = expect.map((one) => `      ${inline(one)}`).join(',\n');
    return `    ${opened}, "expect": [\n${lines}\n    ] }`;
  });
  const about = script.about === undefined ? '' : `  "about": ${JSON.stringify(script.about)},\n`;
  return `{\n${about}  "steps": [\n${steps.join(',\n')}\n  ]\n}\n`;
}

/** `step` as the typed line grammar writes it: `Marta> take brass key`, `@arrive Marta`, `# …`. */
export function lineOf(step: Step): string {
  if ('comment' in step) return `# ${step.comment}`;
  if ('seed' in step) return `@seed ${step.seed}`;
  if ('as' in step) return `${step.as}> ${step.type}`;
  if ('arrive' in step) return `@arrive ${step.arrive}`;
  if ('leave' in step) return `@leave ${step.leave}`;
  if ('tick' in step) return '@tick';
  return `@advance ${step.advance}`;
}

/**
 * `line` in the typed line grammar, as a step: null for a blank line.
 * Thrown, naming `where` and saying what to write, where it is none.
 */
export function stepOfLine(line: string, where: string): Step | null {
  const trimmed = line.trim();
  if (trimmed === '') return null;
  if (trimmed.startsWith('#')) return { comment: trimmed.slice(1).trim() };
  if (trimmed.startsWith('@')) {
    const [word, ...rest] = trimmed.slice(1).trim().split(/\s+/);
    const arg = rest.join(' ');
    switch (word) {
      case 'arrive':
      case 'leave':
        if (arg === '')
          throw new Error(`${where}: \`@${word}\` wants a nickname, as in \`@${word} Marta\`.`);
        return word === 'arrive' ? { arrive: arg } : { leave: arg };
      case 'tick':
        if (arg !== '') throw new Error(`${where}: \`@tick\` stands alone.`);
        return { tick: true };
      case 'advance':
        if (secondsOf(arg) === null) {
          throw new Error(`${where}: write how long passes, as in \`@advance 40 minutes\`.`);
        }
        return { advance: arg };
      case 'seed':
        if (!/^\d+$/.test(arg))
          throw new Error(`${where}: write a whole number, as in \`@seed 7\`.`);
        return { seed: Number(arg) };
      default:
        throw new Error(
          `${where}: \`@${word ?? ''}\` is not something the host does here. ` +
            'Write `@arrive`, `@leave`, `@tick`, `@advance` or `@seed`.',
        );
    }
  }
  const typed = TYPED_LINE.exec(trimmed);
  if (typed === null) {
    throw new Error(
      `${where}: a line is what someone types, as in \`Marta> take brass key\`, what the host does, ` +
        'as in `@arrive Marta`, or a `#` comment.',
    );
  }
  return { as: typed[1]!.trim(), type: typed[2]! };
}

/** `expected` as a transcript line: `Ines (told): …`, the words alone, or `[info] …`. */
export function shownExpectation(expected: Expectation): string {
  if ('level' in expected) return `[${expected.level}] ${expected.text}`;
  if ('reader' in expected) return `${expected.reader} (${expected.kind}): ${expected.words}`;
  return expected.words;
}
