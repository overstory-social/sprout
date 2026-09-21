import { describe, expect, it } from 'vitest';

import {
  Diagnostics,
  inReadingOrder,
  lineAndColumn,
  refusal,
  renderDiagnostic,
  renderDiagnostics,
  softenPolicy,
  warning,
} from './diagnostics.js';
import { SourceFile } from './source.js';

const KILN = new SourceFile('kiln.sprout', ['kind Kiln {', '  :door "closed"', '}', ''].join('\n'));
const VESSEL = new SourceFile(
  'vessel.sprout',
  ['kind Vessel {', '  :state dyr', '}', ''].join('\n'),
);

const doorValue = KILN.span(KILN.text.indexOf('"closed"'), KILN.text.indexOf('"closed"') + 8);
const stateValue = VESSEL.span(VESSEL.text.indexOf('dyr'), VESSEL.text.indexOf('dyr') + 3);

describe('a diagnostic is a span, a sentence and what to write instead', () => {
  it('keeps the remedy off the object when there is none', () => {
    expect(refusal(doorValue, 'Something.')).toEqual({
      severity: 'refusal',
      at: doorValue,
      message: 'Something.',
    });
  });

  it('carries the remedy when there is one', () => {
    expect(refusal(doorValue, 'Something.', 'Write :closed.').remedy).toBe('Write :closed.');
  });

  it('warns without refusing', () => {
    expect(warning(doorValue, 'Something.').severity).toBe('warning');
  });

  it('names a line and column without its file, for a message about one file', () => {
    expect(lineAndColumn(doorValue)).toBe('2:9');
  });
});

describe('a diagnostic prints its location, its sentence and its remedy', () => {
  it('puts the location in a gutter and the remedy under the sentence', () => {
    const printed = renderDiagnostic(
      refusal(
        doorValue,
        '`:door` holds one of open, closed — "closed" is a string.',
        'Write :closed.',
      ),
    );
    expect(printed).toBe(
      [
        'kiln.sprout:2:9  `:door` holds one of open, closed — "closed" is a string.',
        '                 Write :closed.',
      ].join('\n'),
    );
  });

  it('names the token, not the head of the definition it sits in', () => {
    expect(renderDiagnostic(refusal(doorValue, 'x')).startsWith('kiln.sprout:2:9')).toBe(true);
  });

  it('is one line when there is no remedy', () => {
    expect(renderDiagnostic(refusal(doorValue, 'x')).split('\n')).toHaveLength(1);
  });

  it('indents every line of a remedy that runs to more than one', () => {
    const printed = renderDiagnostic(refusal(doorValue, 'one\ntwo', 'three'));
    expect(printed.split('\n').map((l) => l.trimEnd().length > 0)).toEqual([true, true, true]);
    expect(printed.split('\n').slice(1)).toEqual([
      '                 two',
      '                 three',
    ]);
  });
});

describe('a page of diagnostics lines its sentences up in a column', () => {
  const page = [
    refusal(
      doorValue,
      '`:door` holds one of open, closed — "closed" is a string.',
      'Write :closed.',
    ),
    refusal(
      stateValue,
      '`:state` has no option `dyr`. Did you mean `dry`?',
      'Options: raw, leather, dry, bisque, glazed.',
    ),
  ];

  it('aligns every sentence to the widest location, two spaces past it', () => {
    const lines = renderDiagnostics(page).split('\n');
    const column = (line: string): number => line.length - line.trimStart().length;
    expect(lines[0]!.indexOf('`:door`')).toBe('vessel.sprout:2:10'.length + 2);
    expect(column(lines[1]!)).toBe('vessel.sprout:2:10'.length + 2);
    expect(lines[3]!.indexOf('`:state`')).toBe('vessel.sprout:2:10'.length + 2);
  });

  it('puts a blank line between them', () => {
    expect(renderDiagnostics(page).split('\n')[2]).toBe('');
  });

  it('is empty for nothing at all', () => expect(renderDiagnostics([])).toBe(''));
});

describe('reading order is by file, then by where in it', () => {
  it('sorts across files by name and within one by offset', () => {
    const late = refusal(stateValue, 'late');
    const early = refusal(doorValue, 'early');
    expect(inReadingOrder([late, early]).map((d) => d.message)).toEqual(['early', 'late']);
  });

  it('puts a refusal before a warning about the same token', () => {
    const w = warning(doorValue, 'warn');
    const r = refusal(doorValue, 'refuse');
    expect(inReadingOrder([w, r]).map((d) => d.message)).toEqual(['refuse', 'warn']);
  });

  it('leaves the list it was given alone', () => {
    const given = [refusal(stateValue, 'late'), refusal(doorValue, 'early')];
    inReadingOrder(given);
    expect(given.map((d) => d.message)).toEqual(['late', 'early']);
  });
});

describe('Diagnostics collects what a compile has to say', () => {
  it('keeps refusals and warnings apart, and says whether the world is refused', () => {
    const diagnostics = new Diagnostics();
    expect(diagnostics.refused).toBe(false);
    diagnostics.warn(doorValue, 'nothing sends `:stir`.');
    expect(diagnostics.refused).toBe(false);
    diagnostics.refuse(doorValue, '`:door` holds one of open, closed.', 'Write :closed.');
    expect(diagnostics.refused).toBe(true);
    expect(diagnostics.refusals).toHaveLength(1);
    expect(diagnostics.warnings).toHaveLength(1);
    expect(diagnostics.all).toHaveLength(2);
  });

  it('gives back every problem, not the first', () => {
    const diagnostics = new Diagnostics();
    diagnostics.refuse(doorValue, 'one');
    diagnostics.refuse(stateValue, 'two');
    diagnostics.refuse(doorValue, 'three');
    expect(diagnostics.all.map((d) => d.message)).toEqual(['one', 'two', 'three']);
  });

  it('keeps them in the order they were raised, and sorts on request', () => {
    const diagnostics = new Diagnostics();
    diagnostics.refuse(stateValue, 'late');
    diagnostics.refuse(doorValue, 'early');
    expect(diagnostics.all.map((d) => d.message)).toEqual(['late', 'early']);
    expect(diagnostics.sorted().map((d) => d.message)).toEqual(['early', 'late']);
  });

  it('takes in problems raised somewhere else', () => {
    const diagnostics = new Diagnostics();
    diagnostics.add(refusal(doorValue, 'from another file'), warning(stateValue, 'and another'));
    expect(diagnostics.all).toHaveLength(2);
  });

  it('renders the whole page in reading order', () => {
    const diagnostics = new Diagnostics();
    diagnostics.refuse(stateValue, 'late');
    diagnostics.refuse(doorValue, 'early');
    expect(diagnostics.render().split('\n\n')[0]).toContain('early');
  });
});

describe('a policy the language tightens becomes a warning for a world written before it', () => {
  const since = (level: number) =>
    refusal(doorValue, 'a rule added later', 'do it the new way', level);

  it('softens a refusal introduced after the level the world was written for', () => {
    const [softened] = softenPolicy([since(3)], 2);
    expect(softened!.severity).toBe('warning');
    expect(softened!.message).toBe('a rule added later');
    expect(softened!.remedy).toBe('do it the new way');
    expect(softened!.since).toBe(3);
  });

  it('leaves a refusal introduced at or before that level alone', () => {
    expect(softenPolicy([since(2)], 2)[0]!.severity).toBe('refusal');
    expect(softenPolicy([since(1)], 2)[0]!.severity).toBe('refusal');
  });

  it('leaves a refusal that was always wrong alone, whatever the level', () => {
    expect(softenPolicy([refusal(doorValue, 'always wrong')], 1)[0]!.severity).toBe('refusal');
  });

  it('leaves warnings alone', () => {
    const [left] = softenPolicy([warning(doorValue, 'a warning', undefined, 9)], 1);
    expect(left!.severity).toBe('warning');
  });

  it('softens each one it should and no others', () => {
    const page = [since(3), refusal(stateValue, 'always wrong'), since(1)];
    expect(softenPolicy(page, 2).map((d) => d.severity)).toEqual(['warning', 'refusal', 'refusal']);
  });

  it('leaves the list it was given alone', () => {
    const page = [since(3)];
    softenPolicy(page, 2);
    expect(page[0]!.severity).toBe('refusal');
  });

  it('keeps `since` off a diagnostic that has no policy behind it', () => {
    expect(refusal(doorValue, 'x')).not.toHaveProperty('since');
    expect(refusal(doorValue, 'x', 'y')).not.toHaveProperty('since');
  });

  it('carries `since` through a collector', () => {
    const diagnostics = new Diagnostics();
    diagnostics.refuse(doorValue, 'a rule added later', undefined, 4);
    expect(diagnostics.all[0]!.since).toBe(4);
  });
});
