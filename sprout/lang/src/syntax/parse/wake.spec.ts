import { describe, expect, it } from 'vitest';

import { Diagnostics } from '../../source/diagnostics.js';
import { locationOf, SourceFile, textOf } from '../../source/source.js';
import { readStatement } from '../../fixtures/parse.js';
import { parseDeclarations } from '../parse.js';
import { DECLARATION_READERS } from './declarations.js';
import { Parser } from './parser.js';
import { wakeStatement } from './wake.js';

const EXAMPLE =
  'Write how long to wait, as in `wake in 3 hours`, `wake in 10 minutes` or `wake in 90 seconds`.';

/** What refusing `text` said, where and in what words. */
const refused = (text: string) =>
  readStatement(text).refusals.map((d) => [locationOf(d.at), d.message, d.remedy]);

describe('`wake in <n> seconds | minutes | hours`', () => {
  it('reads the spec’s own, with its count and unit, spanning the whole statement', () => {
    const diagnostics = new Diagnostics();
    const p = new Parser(
      new SourceFile('body.sprout', 'wake in 3 hours'),
      diagnostics,
      DECLARATION_READERS,
    );
    const read = wakeStatement(p);
    expect(diagnostics.refusals).toEqual([]);
    expect(read).toMatchObject({
      kind: 'wake',
      count: { kind: 'integer', value: 3 },
      unit: 'hours',
    });
    expect(textOf(read!.at)).toBe('wake in 3 hours');
    expect(textOf(read!.count.at)).toBe('3');
  });

  it('reads each unit, across lines as any statement may be written', () => {
    for (const unit of ['seconds', 'minutes', 'hours'] as const) {
      const { statement, refusals } = readStatement(`wake\n  in 40\n  ${unit}`);
      expect(refusals, unit).toEqual([]);
      expect(statement, unit).toMatchObject({ kind: 'wake', count: { value: 40 }, unit });
    }
  });

  it('says what is missing, where it is missing, and what to write', () => {
    expect(refused('wake')).toEqual([['body.sprout:1:5', '`wake` does not say when.', EXAMPLE]]);
    expect(refused('wake 3 hours')).toEqual([
      ['body.sprout:1:5', '`wake` does not say when.', EXAMPLE],
    ]);
    expect(refused('wake in')).toEqual([
      ['body.sprout:1:8', '`wake in` does not say how long to wait.', EXAMPLE],
    ]);
    expect(refused('wake in 3')).toEqual([
      [
        'body.sprout:1:10',
        '`wake in 3` does not say seconds, minutes or hours.',
        'Write `wake in 3 hours`, `wake in 3 minutes` or `wake in 3 seconds`.',
      ],
    ]);
  });

  it('refuses a count that is not a whole number written out, at what was written', () => {
    for (const [text, at] of [
      ['wake in self.delay minutes', 'self'],
      ['wake in "3" hours', '"3"'],
      ['wake in Three hours', 'Three'],
    ] as const) {
      const { refusals } = readStatement(text);
      expect(
        refusals.map((d) => [textOf(d.at), d.message, d.remedy]),
        text,
      ).toEqual([[at, 'How long a wake waits is a whole number, written out.', EXAMPLE]]);
    }
  });

  it('asks for the plural where the singular is written, and names any other word it does not count in', () => {
    expect(refused('wake in 1 hour')).toEqual([
      [
        'body.sprout:1:11',
        'A wake counts in `hours`, always written that way.',
        'Write `wake in 1 hours`.',
      ],
    ]);
    expect(refused('wake in 1 minute')[0]![1]).toBe(
      'A wake counts in `minutes`, always written that way.',
    );
    expect(refused('wake in 2 days')).toEqual([
      [
        'body.sprout:1:11',
        '`wake in 2` does not say seconds, minutes or hours.',
        'Write `wake in 2 hours`, `wake in 2 minutes` or `wake in 2 seconds`.',
      ],
    ]);
  });

  it('never takes the next statement, or a word starting a line, for its count or unit', () => {
    const text =
      'kind Kiln {\n  :lit false\n  on :stir {\n    wake in 3\n    self.set(:lit, true)\n    wake in\n    send self :stir\n  }\n}\nmessage :stir\n';
    const diagnostics = new Diagnostics();
    const [kiln] = parseDeclarations(new SourceFile('kiln.sprout', text), diagnostics);
    expect(diagnostics.refusals.map((d) => [locationOf(d.at), d.message])).toEqual([
      ['kiln.sprout:4:14', '`wake in 3` does not say seconds, minutes or hours.'],
      ['kiln.sprout:6:12', '`wake in` does not say how long to wait.'],
    ]);
    if (kiln?.kind !== 'kind') return expect.unreachable('the kind is read');
    const handler = kiln.members.find((m) => m.kind === 'handler');
    if (handler?.kind !== 'handler') return expect.unreachable('the handler is read');
    expect(handler.body.statements.map((s) => s.kind)).toEqual(['expression-statement', 'send']);
  });
});
