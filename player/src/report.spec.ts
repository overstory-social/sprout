import { describe, expect, it } from 'vitest';

import { bundleOf, KILN_YARD, RIVER, scriptOf } from './fixtures/index.js';
import { playSteps } from './play.js';
import { reportOf, writeReport, type PlayedRun } from './report.js';

const kilnYard = bundleOf('kiln_yard', KILN_YARD);

/** `lines` played over the kiln yard, as a run named `name`. */
function run(lines: string, name = 'yard.json'): PlayedRun {
  return { name, played: playSteps(kilnYard, scriptOf(lines, name), name) };
}

const WALK = `@arrive Marta
Marta> fire kiln
Marta> fire kiln
Marta> xyzzy
Marta> kick kiln
Marta> look
Marta> look
Marta> look
@advance 1 hours`;

describe('what a playthrough reached', () => {
  const report = reportOf(kilnYard, [run(WALK)]);

  it('counts the lines typed, and each visitor’s command turns', () => {
    expect(report.scripts).toEqual(['yard.json']);
    expect(report.seeds).toEqual([0]);
    expect(report.reading.typed).toBe(7);
    expect(report.turns).toEqual({ Marta: 7 });
  });

  it('lists a line the parser answered in place of reading it, apart from one refused in the consent pass', () => {
    expect(report.reading.unread).toEqual([
      {
        at: 'yard.json, step 4',
        as: 'Marta',
        typed: 'xyzzy',
        said: 'That is not something you can do here.',
        line: 'unknown',
      },
    ]);
    expect(report.reading.refused).toEqual([
      {
        at: 'yard.json, step 3',
        as: 'Marta',
        typed: 'fire kiln',
        said: 'It is firing already.',
        line: null,
      },
    ]);
    // One unread line, and one refused, of seven typed.
    expect(report.reading.unreadRate).toBe(0.14);
    expect(report.reading.refusedRate).toBe(0.14);
  });

  it('gives every fault in full, with the step whose turn it ended', () => {
    expect(report.faults).toEqual([
      {
        at: 'yard.json, step 5',
        turn: 'command',
        name: 'IntegerOverflow',
        detail: '2147483648 is outside the integer range, -2147483648 to 2147483647.',
        against: null,
      },
    ]);
  });

  it('counts the places stood in and the things a reading named, against what the world declares', () => {
    expect(report.reach.places).toEqual({ declared: 2, reached: ['yard'], never: ['shed'] });
    expect(report.reach.objects).toEqual({ declared: 1, reached: ['yard.kiln'], never: [] });
  });

  it('counts the verbs a visitor may type, the engine’s among them, and those read; a faulted turn reaches nothing', () => {
    const { verbs } = report.reach;
    expect(verbs.reached).toEqual(['kiln_yard.fire', 'sprout.look']);
    expect(verbs.never).toContain('kiln_yard.kick');
    expect(verbs.never).toContain('sprout.examine');
    expect(verbs.declared).toBe(verbs.reached.length + verbs.never.length);
  });

  it('counts the handlers that ran, the wake’s among them, by where the world’s own files write them', () => {
    expect(report.reach.handlers).toEqual({
      declared: 2,
      reached: ['kiln_yard.Kiln on woke (kiln.sprout:10:3)'],
      never: ['kiln_yard.Yard on tick (yard.sprout:3:3)'],
    });
  });

  it('lists the prose nobody saw: every string the world’s own files give `say`, `tell`, `text` or `refuse` never rendered', () => {
    expect(report.reach.passages.never).toEqual([
      'kiln_yard.sprout:11:22 "A dark shed."',
      'yard.sprout:3:20 "{one of}Smoke drifts.{or}The air is still.{/one of}"',
      'kiln.sprout:8:41 "Clang."',
    ]);
    expect(report.reach.passages.reached).toEqual([
      'yard.sprout:2:20 "A kiln yard."',
      'kiln.sprout:4:44 "It is firing already."',
      'kiln.sprout:5:54 "The chamber takes the flame."',
      'kiln.sprout:12:11 "The kiln ticks as it cools."',
    ]);
    // The standard library's passages are rendered, and are not the world's to count.
    expect(report.reach.passages.declared).toBe(7);
  });

  it('names the same line typed, and the same answer read, three times in a row', () => {
    expect(report.repetition).toEqual([
      { at: 'yard.json, step 6', as: 'Marta', what: 'line', text: 'look', times: 3 },
      { at: 'yard.json, step 6', as: 'Marta', what: 'answer', text: 'A kiln yard.', times: 3 },
    ]);
  });
});

describe('what a turn that faulted reached', () => {
  it('is only the words it told of the fault: no thing, verb, handler or passage of what it did', () => {
    const report = reportOf(kilnYard, [run('@arrive Marta\nMarta> kick kiln')]);
    expect(report.faults.map((fault) => fault.name)).toEqual(['IntegerOverflow']);
    expect(report.reach.objects.reached).toEqual([]);
    expect(report.reach.verbs.reached).toEqual([]);
    expect(report.reach.handlers.reached).toEqual([]);
    // What the arrival read, and not the `say "Clang."` the kick never finished.
    expect(report.reach.passages.reached).toEqual(['yard.sprout:2:20 "A kiln yard."']);
  });
});

describe('a passage that printed nothing', () => {
  it('was not seen, and counts as never reached', () => {
    const quiet = bundleOf('kiln_yard', {
      ...KILN_YARD,
      'yard.sprout': `kind Yard is sprout.Place {
  :lit false
  describe { text lamp  text "A kiln yard." }
  passage lamp { {if self.get(:lit)}A lamp burns.{/if} }
  on :tick { tell "{one of}Smoke drifts.{or}The air is still.{/one of}" }
}
`,
    });
    const played = playSteps(quiet, scriptOf('@arrive Marta\nMarta> look'), 'yard.json');
    const report = reportOf(quiet, [{ name: 'yard.json', played }]);
    expect(report.reach.passages.never).toContain('kiln_yard.Yard.lamp (yard.sprout:4:11)');
    expect(report.reach.passages.reached).toContain('yard.sprout:3:31 "A kiln yard."');
  });
});

describe('the places a playthrough reached', () => {
  it('counts every place that holds a visitor, so riding a boat reaches the river it is in', () => {
    const river = bundleOf('river', RIVER);
    const played = playSteps(
      river,
      scriptOf('@arrive Marta\nMarta> go in', 'river.json'),
      'river.json',
    );
    const report = reportOf(river, [{ name: 'river.json', played }]);
    expect(report.reach.places).toEqual({
      declared: 3,
      reached: ['dock', 'reach', 'reach.boat'],
      never: [],
    });
  });
});

describe('what several playthroughs reached', () => {
  it('is their union, each step named by its own script', () => {
    const inside = run('@arrive Ines\nInes> look\n@seed 7\nInes> go in\n@tick', 'shed.json');
    const report = reportOf(kilnYard, [run(WALK), inside]);
    expect(report.scripts).toEqual(['yard.json', 'shed.json']);
    expect(report.seeds).toEqual([0, 7]);
    expect(report.reach.places.never).toEqual([]);
    expect(report.reach.passages.never).not.toContain('kiln_yard.sprout:11:22 "A dark shed."');
    expect(report.reading.typed).toBe(9);
  });

  it('names a repetition only within one visitor’s lines, never across two', () => {
    const report = reportOf(kilnYard, [
      run('@arrive Marta\n@arrive Ines\nMarta> look\nInes> look\nMarta> look\nInes> look'),
    ]);
    expect(report.repetition).toEqual([]);
  });

  it('reaches nothing and misreads nothing over no scripts at all', () => {
    const report = reportOf(kilnYard, []);
    expect(report.reading).toEqual({
      typed: 0,
      unread: [],
      refused: [],
      unreadRate: 0,
      refusedRate: 0,
    });
    expect(report.reach.places.reached).toEqual([]);
    expect(report.reach.passages.never).toHaveLength(report.reach.passages.declared);
  });
});

describe('a report, written', () => {
  it('is JSON, as it reads back', () => {
    const report = reportOf(kilnYard, [run(WALK)]);
    const text = writeReport(report);
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text)).toEqual(report);
  });
});
