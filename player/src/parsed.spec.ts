import { describe, expect, it } from 'vitest';

import { BudgetExhausted, storedId, type Parsed, type Parser } from '@overstory/sprout/lang';

import { bundleOf, KILN_YARD, LANE } from './fixtures/worlds.js';
import { faultedParseOf, fillerOf, handedOf, parseRecordOf, readReadingOf } from './parsed.js';
import { arrive, freshStage, playStep } from './play.js';

/** What the parser returned for each line `lines` types as Marta in `world`, with the bounds it drew. */
function parsesOf(
  name: string,
  world: Record<string, string>,
  lines: readonly string[],
): { parsed: Parsed; draws: number[] }[] {
  const stage = freshStage(bundleOf(name, world));
  const recorded: { parsed: Parsed; draws: number[] }[] = [];
  const parse: Parser = (text, actor, context) => {
    const draws: number[] = [];
    const parsed = stage.host.parse(text, actor, {
      ...context,
      draws: { below: (n) => (draws.push(n), context.draws.below(n)) },
    });
    recorded.push({ parsed, draws });
    return parsed;
  };
  const watched = { ...stage, host: { ...stage.host, parse } };
  arrive(watched, 'Marta');
  lines.forEach((line, i) => playStep(watched, { as: 'Marta', type: line }, `line ${i + 1}`));
  return recorded;
}

/** `path` as an id in the world `w`. */
const id = (path: string) => storedId('w', `w.${path}`);

/** What the parser returned for the one line `lines` types. */
function firstParse(
  name: string,
  world: Record<string, string>,
  lines: readonly string[],
): { parsed: Parsed; draws: number[] } {
  const [first] = parsesOf(name, world, lines);
  if (first === undefined) throw new Error('the parser read nothing');
  return first;
}

describe('fillerOf', () => {
  it('keeps each kind of binding by id or value, and a role bound to nothing as unbound', () => {
    expect(fillerOf('target', { object: id('key') })).toEqual({
      role: 'target',
      binds: 'object',
      id: 'w.key',
    });
    expect(fillerOf('things', { set: [id('a'), id('b')] })).toEqual({
      role: 'things',
      binds: 'set',
      ids: ['w.a', 'w.b'],
    });
    expect(
      fillerOf('way', { exit: { direction: 'north', label: 'the north door', to: id('hall') } }),
    ).toEqual({
      role: 'way',
      binds: 'exit',
      direction: 'north',
      label: 'the north door',
      to: 'w.hall',
    });
    expect(fillerOf('notch', { value: 3 })).toEqual({ role: 'notch', binds: 'value', value: 3 });
    expect(fillerOf('tool', undefined)).toEqual({ role: 'tool', binds: 'unbound' });
  });
});

describe('parseRecordOf', () => {
  it('keeps a reading with its bindings in the order it bound them, and what it spent', () => {
    const { parsed } = firstParse('kiln_yard', KILN_YARD, ['fire kiln']);
    expect('reading' in parsed).toBe(true);
    if (!('reading' in parsed)) return;
    expect(parseRecordOf(parsed, [], 7)).toEqual({
      reading: readReadingOf(parsed.reading),
      rest: [],
      drawn: null,
      corrected: [],
      draws: [],
      steps: 7,
    });
    expect(readReadingOf(parsed.reading).bindings).toEqual([
      { role: 'target', binds: 'object', id: 'kiln_yard.yard.kiln' },
    ]);
  });

  it('keeps a draw among readings that tied, naming the thing the engine said it meant', () => {
    const { parsed, draws } = firstParse('lane', LANE, ['take key']);
    const record = parseRecordOf(parsed, draws, 1);
    expect(record).toMatchObject({ drawn: { among: 2 }, draws: [2] });
    expect('drawn' in record && record.drawn?.meant).toMatch(/^lane\.yard\.(brass|iron)_key$/);
  });

  it('keeps an answer as the line said, who says it, and what it binds', () => {
    const { parsed } = firstParse('kiln_yard', KILN_YARD, ['sing loudly']);
    const record = parseRecordOf(parsed, [], 4);
    expect(record).toMatchObject({
      answered: {
        line: { passage: 'unknown' },
        bindings: [{ name: 'actor' }, { name: 'here', object: 'kiln_yard.yard' }],
      },
      draws: [],
      steps: 4,
    });
  });
});

describe('faultedParseOf', () => {
  it('names the fault the parse ended in, with what it had drawn and spent', () => {
    const thrown = new BudgetExhausted('steps', 10, 'a command turn may take 10 steps.');
    expect(faultedParseOf(thrown, [3], 11)).toEqual({
      faulted: { name: 'BudgetExhausted', detail: 'steps: a command turn may take 10 steps.' },
      draws: [3],
      steps: 11,
    });
  });
});

describe('handedOf', () => {
  it('keeps the reading planned, and the item to re-read only where there is one', () => {
    const { parsed } = firstParse('kiln_yard', KILN_YARD, ['fire kiln']);
    if (!('reading' in parsed)) throw new Error('not a reading');
    const planned = readReadingOf(parsed.reading);
    expect(handedOf(parsed.reading, undefined)).toEqual({ planned });
    const reread = {
      role: 'target',
      words: 'kiln',
      values: [],
      referents: [storedId('kiln_yard', 'kiln_yard.yard.kiln')],
    };
    expect(handedOf(parsed.reading, reread)).toEqual({ planned, reread });
  });
});
