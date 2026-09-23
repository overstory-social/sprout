import { describe, expect, it } from 'vitest';

import { SourceFile, locationOf } from '../../source/source.js';
import type { Absent } from '../absent.js';
import { refuseRepeats, Report } from './report.js';

const FILE = new SourceFile('sprout.json', '{\n  "name": "shop"\n}\n');
const HEAD = FILE.span(0, 0);
const AT = FILE.span(4, 10);

const gone = (at: Absent['at']): Absent => ({
  what: 'kiln.sprout',
  kind: 'file',
  reason: 'missing',
  at,
  consequence: 'everything it declared reads as absent',
});

describe('a report answers the one question the two modes turn on', () => {
  it('refuses a gap at publish and records nothing', () => {
    const report = new Report('publish', HEAD);
    report.gap(gone(AT), 'The file is missing.', 'Add it.');
    expect(report.absent).toEqual([]);
    expect(report.diagnostics.all.map((d) => [d.severity, d.message, d.remedy])).toEqual([
      ['refusal', 'The file is missing.', 'Add it.'],
    ]);
  });

  it('records a gap at load, and warns with what the world does without it', () => {
    const report = new Report('load', HEAD);
    report.gap(gone(AT), 'The file is missing.');
    expect(report.absent).toEqual([gone(AT)]);
    expect(report.diagnostics.all.map((d) => [d.severity, d.message])).toEqual([
      ['warning', 'The file is missing. Everything it declared reads as absent.'],
    ]);
  });

  it('reports a gap with nothing to point at where it was told to', () => {
    const report = new Report('publish', HEAD);
    report.gap(gone(null), 'The file is missing.');
    expect(locationOf(report.diagnostics.all[0]!.at)).toBe('sprout.json:1:1');
  });

  it('refuses what is strict at publish, and only warns of it at load', () => {
    const publish = new Report('publish', HEAD);
    const load = new Report('load', HEAD);
    for (const report of [publish, load]) report.strict(AT, 'Unnamed.');
    expect(publish.diagnostics.all[0]!.severity).toBe('refusal');
    expect(load.diagnostics.all[0]!.severity).toBe('warning');
  });

  it('refuses what is always wrong in either mode', () => {
    const load = new Report('load', HEAD);
    load.refuse(AT, 'Never.');
    expect(load.diagnostics.refusals.map((d) => d.message)).toEqual(['Never.']);
  });
});

describe('a kind made of a library already refused at the manifest is not asked for again', () => {
  const composed = (what: string, kind: Absent['kind']): Absent => ({
    what,
    kind,
    reason: 'missing',
    at: AT,
    consequence: 'the object is absent',
  });

  it('says nothing at publish for a kind-in-composition, kind-in-role or world gap naming that library', () => {
    const report = new Report('publish', HEAD);
    report.libraryRefused('sprout');
    report.gap(
      composed('sprout.Actor', 'kind-in-composition'),
      'Nothing here is a `sprout.Actor`.',
    );
    report.gap(composed('sprout.Actor', 'kind-in-role'), 'Nothing here is a `sprout.Actor`.');
    report.gap(composed('sprout.World', 'world'), '`sprout.World` is not here.');
    expect(report.diagnostics.all).toEqual([]);
  });

  it('still refuses a kind written without a library, even when the library is refused', () => {
    const report = new Report('publish', HEAD);
    report.libraryRefused('sprout');
    report.gap(composed('Actor', 'kind-in-composition'), 'Nothing here is an `Actor`.');
    expect(report.diagnostics.refusals.map((d) => d.message)).toEqual([
      'Nothing here is an `Actor`.',
    ]);
  });

  it('still refuses a gap of a library that was not refused', () => {
    const report = new Report('publish', HEAD);
    report.libraryRefused('sprout');
    report.gap(composed('paint.Wall', 'kind-in-composition'), 'Nothing here is a `paint.Wall`.');
    expect(report.diagnostics.refusals.map((d) => d.message)).toEqual([
      'Nothing here is a `paint.Wall`.',
    ]);
  });

  it('changes nothing at load: the gap is still recorded and warned about', () => {
    const report = new Report('load', HEAD);
    report.libraryRefused('sprout');
    report.gap(
      composed('sprout.Actor', 'kind-in-composition'),
      'Nothing here is a `sprout.Actor`.',
    );
    expect(report.absent).toEqual([composed('sprout.Actor', 'kind-in-composition')]);
    expect(report.diagnostics.all[0]!.severity).toBe('warning');
  });

  it('leaves an unrelated absence row alone even where the text happens to hold a dot', () => {
    const report = new Report('publish', HEAD);
    report.libraryRefused('sprout');
    report.gap(composed('sprout.hall', 'place-of-arrival'), 'There is nothing at `sprout.hall`.');
    expect(report.diagnostics.refusals.map((d) => d.message)).toEqual([
      'There is nothing at `sprout.hall`.',
    ]);
  });
});

describe('a name written twice is refused at the second', () => {
  it('names the second, and says nothing of names written once', () => {
    const report = new Report('publish', HEAD);
    const second = FILE.span(12, 18);
    refuseRepeats(
      report,
      [
        { name: 'kiln', at: AT },
        { name: 'yard', at: AT },
        { name: 'kiln', at: second },
      ],
      'files',
    );
    expect(report.diagnostics.all.map((d) => [d.at, d.message])).toEqual([
      [second, 'There are two files called "kiln".'],
    ]);
  });
});
