import { describe, expect, it } from 'vitest';

import { locationOf, textOf } from '../../source/source.js';
import { atMember, readWith, rest } from '../../fixtures/readers.js';
import { wakeStatement } from './wake.js';

const EXAMPLE =
  'Write how long to wait, as in `wake in 3 hours`, `wake in 10 minutes` or `wake in 90 seconds`.';

/** One `wake`, read by `wakeStatement` from the start of `text`. */
const readWake = (text: string) => readWith(wakeStatement, text, { name: 'body.sprout' });

/** What refusing `text` said, where and in what words. */
const refused = (text: string) =>
  readWake(text).refusals.map((d) => [locationOf(d.at), d.message, d.remedy]);

describe('`wake in <n> seconds | minutes | hours`', () => {
  it('reads the spec’s own, with its count and unit, spanning the whole statement', () => {
    const { read, p, refusals } = readWake('wake in 3 hours\nsay "Later."');
    expect(refusals).toEqual([]);
    expect(rest(p)).toBe('say "Later."');
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
      const { read, refusals } = readWake(`wake\n  in 40\n  ${unit}`);
      expect(refusals, unit).toEqual([]);
      expect(read, unit).toMatchObject({ kind: 'wake', count: { value: 40 }, unit });
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
      const { refusals } = readWake(text);
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
    /** The `wake` at `from`, read where the handler's block holds it. */
    const wakeAt = (from: string) => {
      const { p, diagnostics } = atMember(text, text.indexOf(from), 'Kiln', {
        name: 'kiln.sprout',
      });
      expect(wakeStatement(p), from).toBeNull();
      return {
        said: diagnostics.refusals.map((d) => [locationOf(d.at), d.message]),
        rest: rest(p),
      };
    };
    const count = wakeAt('wake in 3');
    expect(count.said).toEqual([
      ['kiln.sprout:4:14', '`wake in 3` does not say seconds, minutes or hours.'],
    ]);
    expect(count.rest.startsWith('self.set(:lit, true)\n')).toBe(true);
    const unit = wakeAt('wake in\n');
    expect(unit.said).toEqual([['kiln.sprout:6:12', '`wake in` does not say how long to wait.']]);
    expect(unit.rest.startsWith('send self :stir\n')).toBe(true);
  });
});
