import { describe, expect, it } from 'vitest';

import { BENCH } from '../fixtures/bench.js';
import { cartridgeOf } from './cartridge.js';
import { CartridgeSchema } from './cartridge-schema.js';

const whole = (): Record<string, unknown> => JSON.parse(JSON.stringify(cartridgeOf(BENCH)));

const refused = (input: unknown): string[] => {
  const result = CartridgeSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((one) => one.path.join('.'));
};

describe('the schema of a cartridge’s JSON', () => {
  it('holds what the emitter writes', () => {
    expect(CartridgeSchema.safeParse(whole()).success).toBe(true);
  });

  it('refuses a section that is missing, naming it', () => {
    const input = whole();
    delete input['messages'];
    expect(refused(input)).toEqual(['messages']);
  });

  it('refuses a section it does not know, since a cartridge is exactly what it says it is', () => {
    expect(refused({ ...whole(), source: 'world bench' })).toEqual(['']);
  });

  it('refuses a header field of the wrong type, a cap that is not a number, and an entry of no shape', () => {
    const input = whole() as {
      header: { level: unknown };
      caps: { places: unknown };
      table: { entries: unknown[] };
    };
    input.header.level = 'one';
    input.caps.places = 'many';
    input.table.entries.push({ x: [] });
    expect(refused(input).sort()).toEqual(
      ['caps.places', 'header.level', `table.entries.${input.table.entries.length - 1}`].sort(),
    );
  });

  it('accepts a cap that is unset, as null', () => {
    const input = whole() as { caps: { places: unknown } };
    input.caps.places = null;
    expect(refused(input)).toEqual([]);
  });
});
