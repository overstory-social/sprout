import { describe, expect, it } from 'vitest';

import {
  lineOf,
  plays,
  readScript,
  secondsOf,
  shownExpectation,
  stepOfLine,
  writeScript,
  type Expectation,
  type Script,
  type Step,
} from './script.js';

const read = (steps: unknown[]) => readScript(JSON.stringify({ steps }), 'walk.json');

describe('readScript', () => {
  it('reads every step, what each expects, and what the script is about', () => {
    const script: Script = {
      about: 'A walk.',
      steps: [
        { comment: 'in' },
        { arrive: 'Marta', expect: [{ words: 'A yard.' }] },
        {
          as: 'Marta',
          type: 'take key',
          expect: [
            { reader: 'Marta', kind: 'said', words: 'You take a key.' },
            { level: 'error', text: 'the command faulted, X: y' },
          ],
        },
        { tick: true, expect: [] },
        { advance: '40 minutes' },
        { seed: 7 },
        { leave: 'Marta', expect: [{ level: 'info', text: 'a note' }] },
      ],
    };
    expect(readScript(JSON.stringify(script), 'walk.json')).toEqual(script);
  });

  it('refuses what is not JSON, or not a list of steps, naming the file', () => {
    expect(() => readScript('{ "steps": [', 'walk.json')).toThrow(/^walk\.json: not JSON: /);
    expect(() => readScript('[]', 'walk.json')).toThrow(
      'walk.json: a script is `{ "steps": [ … ] }`',
    );
    expect(() => readScript('{ "steps": [], "notes": 1 }', 'walk.json')).toThrow(
      'walk.json: a script holds `steps` and, if you like, `about`, a string.',
    );
  });

  it('refuses a step of no known shape, naming the step and every shape there is', () => {
    for (const bad of [
      { go: 'north' },
      { as: 'Marta' },
      { arrive: '' },
      { tick: 1 },
      { seed: -1 },
      'look',
    ]) {
      expect(() => read([{ arrive: 'Marta' }, bad]), JSON.stringify(bad)).toThrow(
        'walk.json, step 2: a step is `{ "as": "Marta", "type": "look" }`',
      );
    }
  });

  it('refuses a time it cannot read, and an `expect` on a step that makes nothing', () => {
    expect(() => read([{ advance: 'soon' }])).toThrow(
      'walk.json, step 1: write how long passes, as in `{ "advance": "40 minutes" }`.',
    );
    expect(() => read([{ seed: 3, expect: [] }])).toThrow(
      'walk.json, step 1: `@seed 3` makes nothing, so it expects nothing.',
    );
    expect(() => read([{ comment: 'x', expect: [] }])).toThrow('makes nothing');
  });

  it('refuses an expected line of no known shape, naming the step and the line', () => {
    for (const bad of [
      'A yard.',
      { words: 3 },
      { reader: 'Marta', words: 'A yard.' },
      { level: 'warning', text: 'x' },
    ]) {
      expect(() => read([{ arrive: 'Marta', expect: [{ words: 'ok' }, bad] }])).toThrow(
        'walk.json, step 1, expect 2: an expected line is `{ "words": "You take a brass key." }`',
      );
    }
    expect(() => read([{ arrive: 'Marta', expect: 'A yard.' }])).toThrow(
      '`expect` is a list of lines, or `[]` for silence.',
    );
  });
});

describe('writeScript', () => {
  it('writes one step to a line and each expected line under it, as JSON that reads back', () => {
    const script: Script = {
      about: 'A walk.',
      steps: [
        { arrive: 'Marta', expect: [{ words: 'A yard.' }, { level: 'info', text: 'a note' }] },
        { tick: true, expect: [] },
        { seed: 7 },
      ],
    };
    expect(writeScript(script)).toBe(
      [
        '{',
        '  "about": "A walk.",',
        '  "steps": [',
        '    { "arrive": "Marta", "expect": [',
        '      { "words": "A yard." },',
        '      { "level": "info", "text": "a note" }',
        '    ] },',
        '    { "tick": true, "expect": [] },',
        '    { "seed": 7 }',
        '  ]',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('reads back as the script it wrote, for any mix of steps and lines', () => {
    const expectations: Expectation[] = [
      { words: 'She says "hi" \\ twice.' },
      { reader: 'Ines', kind: 'told', words: 'Marta — ever so — waves.' },
      { level: 'error', text: 'the tick of yard faulted, X: y' },
    ];
    const heads: Step[] = [
      { as: 'Marta', type: 'take the "brass" key' },
      { arrive: 'Ines' },
      { leave: 'Ines' },
      { tick: true },
      { advance: '2 hours' },
    ];
    for (let n = 0; n < 64; n++) {
      const steps: Step[] = [{ comment: `run ${n}` }, { seed: n }];
      for (let i = 0; i < 6; i++) {
        const head = heads[(n + i * 3) % heads.length]!;
        const kept = expectations.slice(0, (n + i) % 4);
        steps.push(n % 5 === i ? head : { ...head, expect: kept });
      }
      const script: Script = n % 2 === 0 ? { steps } : { about: `about ${n}`, steps };
      expect(readScript(writeScript(script), 'x.json')).toEqual(script);
    }
  });
});

describe('the typed line grammar', () => {
  it('reads each line as the step it is, and writes each step back as that line', () => {
    const lines = [
      'Marta> take brass key',
      '@arrive Marta',
      '@leave Marta',
      '@tick',
      '@advance 40 minutes',
      '@seed 7',
      '# a note',
    ];
    for (const line of lines) expect(lineOf(stepOfLine(line, 'stdin:1')!)).toBe(line);
    expect(stepOfLine('Ines Grey>look', 'stdin:1')).toEqual({ as: 'Ines Grey', type: 'look' });
    expect(stepOfLine('   ', 'stdin:1')).toBeNull();
  });

  it('throws, naming where and what to write, for a line it cannot read', () => {
    expect(() => stepOfLine('take kiln', 'stdin:2')).toThrow(
      'stdin:2: a line is what someone types, as in `Marta> take brass key`',
    );
    expect(() => stepOfLine('@arrive', 'stdin:2')).toThrow(
      'stdin:2: `@arrive` wants a nickname, as in `@arrive Marta`.',
    );
    expect(() => stepOfLine('@tick now', 'stdin:2')).toThrow('stdin:2: `@tick` stands alone.');
    expect(() => stepOfLine('@seed x', 'stdin:2')).toThrow(
      'stdin:2: write a whole number, as in `@seed 7`.',
    );
  });
});

describe('secondsOf', () => {
  it('reads a whole number of seconds, minutes or hours, and nothing else', () => {
    expect(secondsOf('40 minutes')).toBe(2400);
    expect(secondsOf('1 hour')).toBe(3600);
    expect(secondsOf('3 seconds')).toBe(3);
    for (const bad of ['soon', '40', 'minutes', '1.5 hours', '2 days', '1 hour 3']) {
      expect(secondsOf(bad), bad).toBeNull();
    }
  });
});

describe('plays and shownExpectation', () => {
  it('say which steps play, and show an expected line as a transcript does', () => {
    expect(
      [{ comment: 'x' }, { seed: 1 }, { tick: true }].map((step) => plays(step as Step)),
    ).toEqual([false, false, true]);
    expect(shownExpectation({ words: 'Hi.' })).toBe('Hi.');
    expect(shownExpectation({ reader: 'Ines', kind: 'told', words: 'Hi.' })).toBe(
      'Ines (told): Hi.',
    );
    expect(shownExpectation({ level: 'info', text: 'a note' })).toBe('[info] a note');
  });
});
