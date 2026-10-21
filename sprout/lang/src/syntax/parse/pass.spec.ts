import { describe, expect, it } from 'vitest';

import { locationOf, textOf } from '../../source/source.js';
import { readBody, readWith, rest } from '../../fixtures/readers.js';
import { passStatement } from './pass.js';

const EXAMPLE =
  'Write how much time passes, as in `pass 90 seconds`, `pass 10 minutes` or `pass 1 hours`.';
const WORKED_OUT =
  'Write a whole number, as in `pass 10 minutes`, or put what it is worked out from in brackets, as in `pass (self.get(:wait)) minutes`.';

/** One `pass`, read by `passStatement` from the start of `text`. */
const readPass = (text: string) => readWith(passStatement, text, { name: 'body.sprout' });

/** What refusing `text` said, where and in what words. */
const refused = (text: string) =>
  readPass(text).refusals.map((d) => [locationOf(d.at), d.message, d.remedy]);

describe('`pass <n> seconds | minutes | hours`', () => {
  it('reads the spec’s own, with its count and unit, spanning the whole statement', () => {
    const { read, p, refusals } = readPass('pass 90 seconds\nsay "Later."');
    expect(refusals).toEqual([]);
    expect(rest(p)).toBe('say "Later."');
    expect(read).toMatchObject({
      kind: 'pass-time',
      count: { kind: 'integer', value: 90 },
      unit: 'seconds',
    });
    expect(textOf(read!.at)).toBe('pass 90 seconds');
  });

  it('reads each unit, and a count worked out in brackets, leaving its type to the checker', () => {
    for (const unit of ['seconds', 'minutes', 'hours'] as const) {
      const { read, refusals } = readPass(`pass\n  40\n  ${unit}`);
      expect(refusals, unit).toEqual([]);
      expect(read, unit).toMatchObject({ kind: 'pass-time', count: { value: 40 }, unit });
    }
    const worked = readPass('pass (self.get(:wait) + 1) minutes');
    expect(worked.refusals).toEqual([]);
    expect(textOf(worked.read!.count.at)).toBe('self.get(:wait) + 1');
    expect(textOf(worked.read!.at)).toBe('pass (self.get(:wait) + 1) minutes');
  });

  it('says what is missing, where it is missing, in its own words', () => {
    expect(refused('pass')).toEqual([
      ['body.sprout:1:5', '`pass` does not say how much time passes.', EXAMPLE],
    ]);
    expect(refused('pass 3')).toEqual([
      [
        'body.sprout:1:7',
        '`pass 3` does not say seconds, minutes or hours.',
        'Write `pass 3 hours`, `pass 3 minutes` or `pass 3 seconds`.',
      ],
    ]);
    expect(refused('pass 1 minute')).toEqual([
      [
        'body.sprout:1:8',
        'A pass counts in `minutes`, always written that way.',
        'Write `pass 1 minutes`.',
      ],
    ]);
    expect(refused('pass three minutes')).toEqual([
      [
        'body.sprout:1:6',
        'How much time passes is a whole number written out, or worked out in brackets.',
        WORKED_OUT,
      ],
    ]);
    expect(refused('pass () minutes')).toEqual([
      [
        'body.sprout:1:6',
        'These brackets hold nothing, and a pass needs to know how much time passes.',
        WORKED_OUT,
      ],
    ]);
  });
});

describe('`pass` in a kind’s body', () => {
  it('is a statement inside a block, never the start of the body’s next member', () => {
    const { members, refusals } = readBody(
      'kind Patient {\n  as actor for wait {\n    do {\n      pass 90 seconds\n      say "You wait."\n    }\n  }\n  after command { pass (self.get(:n)) minutes }\n  pass any (true)\n}\n',
    );
    expect(refusals).toEqual([]);
    expect(members.map((member) => member.kind)).toEqual(['play', 'after-command', 'pass']);
  });
});
