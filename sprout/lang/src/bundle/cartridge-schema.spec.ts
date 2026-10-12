import { describe, expect, it } from 'vitest';

import { BENCH } from '../fixtures/bench.js';
import { cartridgeOf, preambleOf } from './cartridge.js';
import { PreambleSchema } from './cartridge-schema.js';

const whole = (): Record<string, unknown> =>
  JSON.parse(JSON.stringify(preambleOf(cartridgeOf(BENCH))));

const refused = (input: unknown): string[] => {
  const result = PreambleSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((one) => one.path.join('.'));
};

describe('the schema of a cartridge’s preamble', () => {
  it('holds what the emitter writes', () => {
    expect(PreambleSchema.safeParse(whole()).success).toBe(true);
  });

  it('refuses a section that is missing, naming it', () => {
    const input = whole();
    delete input['messages'];
    expect(refused(input)).toEqual(['messages']);
  });

  it('refuses a section it does not know, since a cartridge is exactly what it says it is', () => {
    expect(refused({ ...whole(), source: 'world bench' })).toEqual(['']);
  });

  it('refuses a header field of the wrong type, a cap that is not a number, and a run of entries, which the table holds', () => {
    const input = whole() as {
      header: { level: unknown };
      caps: { places: unknown };
      table: { entries?: unknown[] };
    };
    input.header.level = 'one';
    input.caps.places = 'many';
    input.table.entries = [];
    expect(refused(input).sort()).toEqual(['caps.places', 'header.level', 'table'].sort());
  });

  it('accepts a cap that is unset, as null', () => {
    const input = whole() as { caps: { places: unknown } };
    input.caps.places = null;
    expect(refused(input)).toEqual([]);
  });
});
