import { describe, expect, it } from 'vitest';

import { Diagnostics } from './diagnostics.js';
import { EnumTable } from './enums.js';
import { parseDeclarations, parseProperty, parseRemembers } from './parse.js';
import { resolveProperty, resolveRemembers } from './properties.js';
import { locationOf, SourceFile } from './source.js';
import { integer, showType } from './types.js';

function table(): EnumTable {
  const enums = new EnumTable();
  const diagnostics = new Diagnostics();
  const declared = parseDeclarations(
    new SourceFile('enums.sprout', 'enum Ward { oak, silver }\nenum Drying { wet, cured }\n'),
    diagnostics,
  ).filter((d) => d.kind === 'enum');
  enums.add('printers_shop', declared, diagnostics);
  return enums;
}
const ENUMS = table();

/** Declare a property the way a kind would, and work out what it means. */
function declare(text: string) {
  const diagnostics = new Diagnostics();
  const declared = parseProperty(new SourceFile('kiln.sprout', text), diagnostics);
  const resolved =
    declared === null ? null : resolveProperty(declared, ENUMS, 'printers_shop', diagnostics);
  return { resolved, diagnostics, refusals: diagnostics.refusals };
}

describe('a property is a name, a type and a default', () => {
  it('takes its type from the literal', () => {
    expect(declare(':lit false').resolved).toMatchObject({
      name: 'lit',
      type: { type: 'boolean' },
    });
    expect(declare(':wear 0').resolved!.type).toEqual(integer());
    expect(declare(':note "a line"').resolved!.type).toEqual({ type: 'string' });
  });

  it('takes the same type spelled out, which is the same declaration', () => {
    const fromLiteral = declare(':lit false').resolved!;
    const written = declare(':lit boolean default false').resolved!;
    expect(written.type).toEqual(fromLiteral.type);
    expect(written.name).toBe(fromLiteral.name);
  });

  it('reads the spec’s own examples', () => {
    expect(showType(declare(':lit false').resolved!.type)).toBe('boolean');
    expect(showType(declare(':lit boolean default false').resolved!.type)).toBe('boolean');
    expect(showType(declare(':wear 0 min 0 max 99').resolved!.type)).toBe('integer 0 to 99');
    expect(showType(declare(':state Drying default wet').resolved!.type)).toBe('Drying');
    expect(showType(declare(':opens [Ward] default [oak]').resolved!.type)).toBe('[Ward]');
    expect(showType(declare(':note string default ""').resolved!.type)).toBe('string');
  });

  it('keeps the declaration it came from, so a later problem can point at it', () => {
    const { resolved } = declare(':wear 0');
    expect(resolved!.declaration.name.text).toBe('wear');
    expect(locationOf(resolved!.declaration.at)).toBe('kiln.sprout:1:1');
  });

  it('is not remembered unless it was declared inside a :remembers', () => {
    expect(declare(':wear 0').resolved!.remembered).toBe(false);
  });
});

describe('an integer’s range narrows its type, so the default is checked against it', () => {
  it('takes both bounds', () => {
    expect(declare(':wear 0 min 0 max 99').resolved!.type).toEqual(integer(0, 99));
  });

  it('takes either one on its own, leaving the other at the whole range', () => {
    expect(declare(':wear 0 min 0').resolved!.type).toMatchObject({ min: 0 });
    expect(declare(':wear 0 max 99').resolved!.type).toMatchObject({ max: 99 });
  });

  it('takes them in either order', () => {
    expect(declare(':wear 0 max 99 min 0').resolved!.type).toEqual(integer(0, 99));
  });

  it('refuses a default outside the range it just declared', () => {
    const { resolved, refusals } = declare(':wear 0 min 5 max 99');
    expect(resolved).toBeNull();
    expect(refusals[0]!.message).toBe('0 is outside 5 to 99.');
  });

  it('refuses a min above its max', () => {
    const { resolved, refusals } = declare(':wear 0 min 99 max 0');
    expect(resolved).toBeNull();
    expect(refusals[0]!.message).toBe('`:wear` has a min of 99 and a max of 0.');
    expect(refusals[0]!.remedy).toBe('A min is never above its max.');
  });

  it('refuses a range on anything that is not an integer', () => {
    const { resolved, refusals } = declare(':note "x" min 0');
    expect(resolved).toBeNull();
    expect(refusals[0]!.message).toBe('`:note` holds string, which has no range.');
    expect(refusals[0]!.remedy).toBe('Only an integer takes a `min` and a `max`.');
  });

  it('takes a negative bound', () => {
    expect(declare(':below -5 min -10 max 0').resolved!.type).toEqual(integer(-10, 0));
  });
});

describe('a default that is not a value of the type is refused at the default', () => {
  it('refuses the wrong kind of value', () => {
    const { resolved, refusals } = declare(':lit boolean default 4');
    expect(resolved).toBeNull();
    expect(refusals[0]!.message).toBe('This holds boolean, and the number 4 is not one.');
    expect(locationOf(refusals[0]!.at)).toBe('kiln.sprout:1:22');
  });

  it('refuses an option the enum does not have', () => {
    const { refusals } = declare(':state Drying default damp');
    expect(refusals[0]!.message).toContain('`Drying` has no option `damp`');
  });

  it('refuses a list element of the wrong type', () => {
    expect(declare(':opens [Ward] default [oak, 4]').resolved).toBeNull();
  });

  it('refuses a bare option with no enum written, since it names none', () => {
    const { resolved, refusals } = declare(':ward iron');
    expect(resolved).toBeNull();
    expect(refusals[0]!.message).toBe('`iron` does not say which enum it belongs to.');
  });
});

describe('what an object remembers about each actor', () => {
  function remember(text: string) {
    const diagnostics = new Diagnostics();
    const declared = parseRemembers(new SourceFile('kiln.sprout', text), diagnostics);
    const resolved =
      declared === null ? [] : resolveRemembers(declared, ENUMS, 'printers_shop', diagnostics);
    return { resolved, refusals: diagnostics.refusals };
  }

  it('is typed by the same rules and written in the same syntax', () => {
    const { resolved, refusals } = remember(
      ':remembers [handled: false, ward_seen: Ward default oak, visits: 0 min 0 max 99]',
    );
    expect(refusals).toEqual([]);
    expect(resolved.map((p) => p.name)).toEqual(['handled', 'ward_seen', 'visits']);
    expect(resolved.map((p) => showType(p.type))).toEqual(['boolean', 'Ward', 'integer 0 to 99']);
  });

  it('marks every one of them as remembered', () => {
    const { resolved } = remember(':remembers [visits: 0]');
    expect(resolved.every((p) => p.remembered)).toBe(true);
  });

  it('refuses the same name remembered twice, at the second', () => {
    const { resolved, refusals } = remember(':remembers [visits: 0, visits: 1]');
    expect(resolved.map((p) => p.name)).toEqual(['visits']);
    expect(refusals[0]!.message).toBe('`visits` is remembered twice.');
  });

  it('drops one it cannot resolve and keeps the rest', () => {
    const { resolved, refusals } = remember(':remembers [handled: false, ward: iron, visits: 0]');
    expect(resolved.map((p) => p.name)).toEqual(['handled', 'visits']);
    expect(refusals).toHaveLength(1);
  });

  it('remembers nothing when it says nothing', () => {
    expect(remember(':remembers []').resolved).toEqual([]);
  });
});
