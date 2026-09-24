import { describe, expect, it } from 'vitest';

import { compileSnippet } from './bench.js';
import {
  REFUSAL_TABLE,
  refusalsSection,
  saidBy,
  WARNING_TABLE,
  warningsSection,
} from './problems.js';
import { renderDiagnostics } from '../../source/diagnostics.js';

describe('what the skill says the compiler warns about', () => {
  it('is, for each entry, a world that compiles and is warned about', () => {
    for (const entry of WARNING_TABLE) {
      const { bundle, diagnostics } = compileSnippet(entry.snippet);
      expect(bundle, entry.about).not.toBeNull();
      expect(diagnostics.length, entry.about).toBeGreaterThan(0);
      expect(
        diagnostics.every((d) => d.severity === 'warning'),
        entry.about,
      ).toBe(true);
    }
  });

  it('prints the compiler’s own words for each', () => {
    const section = warningsSection();
    for (const entry of WARNING_TABLE) {
      expect(section).toContain(`### ${entry.about}`);
      expect(section).toContain(renderDiagnostics(saidBy(entry, 'warning')));
    }
  });

  it('throws for an example that is not warned about, so the list cannot claim a warning', () => {
    expect(() => saidBy({ about: 'Nothing', snippet: {} }, 'warning')).toThrow(
      'does not give a warning',
    );
  });
});

describe('the refusals the skill shows', () => {
  it('are, for each entry, a world the compiler refuses', () => {
    for (const entry of REFUSAL_TABLE) {
      expect(compileSnippet(entry.snippet).bundle, entry.about).toBeNull();
    }
  });

  it('print the compiler’s own words for each, and the file it names', () => {
    const section = refusalsSection();
    for (const entry of REFUSAL_TABLE) {
      const said = saidBy(entry, 'refusal');
      expect(section).toContain(renderDiagnostics(said));
      for (const d of said) expect(section).toContain(`\`${d.at.source.name}\`:`);
    }
  });

  it('throws for an example that compiles, so the list cannot claim a refusal', () => {
    const warned = WARNING_TABLE[0]!;
    expect(() => saidBy(warned, 'refusal')).toThrow('does not give a refusal');
  });
});
