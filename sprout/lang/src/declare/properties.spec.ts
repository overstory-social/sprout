import { describe, expect, it } from 'vitest';

import { Diagnostics } from '../source/diagnostics.js';
import { EnumTable } from './enums.js';
import { parseDeclarations, parseProperty, parseRemembers } from '../syntax/parse.js';
import {
  resolveProperty,
  resolveRemembers,
  restatementOf,
  restateProperty,
  type ResolvedProperty,
} from './properties.js';
import { locationOf, SourceFile } from '../source/source.js';
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
/** The kind these suites' properties are declared in. */
const ORIGIN = 'printers_shop.Kiln';

/** Declare a property the way a kind would, and work out what it means. */
function declare(text: string) {
  const diagnostics = new Diagnostics();
  const declared = parseProperty(new SourceFile('kiln.sprout', text), diagnostics);
  const resolved =
    declared === null
      ? null
      : resolveProperty(declared, ENUMS, 'printers_shop', ORIGIN, diagnostics);
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

  it('is not remembered unless it was declared inside a `remembers` block', () => {
    expect(declare(':wear 0').resolved!.remembered).toBe(false);
  });

  it('records the kind that declared it as its origin, which composition merges on', () => {
    expect(declare(':wear 0').resolved!.origin).toBe(ORIGIN);
  });
});

describe('an enum and the option to start at, written as one', () => {
  it('means exactly what the two written apart mean', () => {
    const qualified = declare(':ward Ward.oak');
    expect(qualified.refusals).toEqual([]);
    const apart = declare(':ward Ward default oak').resolved!;
    expect(qualified.resolved!.type).toEqual(apart.type);
    expect(showType(qualified.resolved!.type)).toBe('Ward');
    expect(qualified.resolved!.declaration.default).toMatchObject({
      kind: 'option-literal',
      name: { text: 'oak' },
    });
  });

  it('resolves the enum through the library it names', () => {
    const enums = new EnumTable();
    const diagnostics = new Diagnostics();
    const declared = parseDeclarations(
      new SourceFile('sprout.sprout', 'enum Ward { oak, silver }\n'),
      diagnostics,
    ).filter((d) => d.kind === 'enum');
    enums.add('sprout', declared, diagnostics);
    const written = parseProperty(
      new SourceFile('kiln.sprout', ':ward sprout.Ward.oak'),
      diagnostics,
    );
    const resolved = resolveProperty(written!, enums, 'printers_shop', ORIGIN, diagnostics);
    expect(diagnostics.refusals).toEqual([]);
    expect(resolved!.type).toMatchObject({
      type: 'symbol',
      of: { library: 'sprout', name: 'Ward' },
    });
  });

  it('is checked against the enum like any other option, at the option', () => {
    const { resolved, refusals } = declare(':ward Ward.slver');
    expect(resolved).toBeNull();
    expect(refusals[0]!.message).toBe('`Ward` has no option `slver`. Did you mean `silver`?');
    expect(refusals[0]!.remedy).toBe('Options: oak, silver.');
    expect(locationOf(refusals[0]!.at)).toBe('kiln.sprout:1:12');
  });

  it('takes no range, because what it holds is a symbol', () => {
    const { resolved, refusals } = declare(':ward Ward.oak min 0');
    expect(resolved).toBeNull();
    expect(refusals[0]!.message).toBe('`:ward` holds Ward, which has no range.');
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
    expect(refusals[0]!.message).toBe('`:lit` holds true or false, and 4 is a number.');
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
      declared === null
        ? []
        : resolveRemembers(declared, ENUMS, 'printers_shop', ORIGIN, diagnostics);
    return { resolved, refusals: diagnostics.refusals };
  }

  it('is typed by the same rules and written in the same syntax', () => {
    const { resolved, refusals } = remember(
      'remembers { :handled false :ward_seen Ward default oak :visits 0 min 0 max 99 }',
    );
    expect(refusals).toEqual([]);
    expect(resolved.map((p) => p.name)).toEqual(['handled', 'ward_seen', 'visits']);
    expect(resolved.map((p) => showType(p.type))).toEqual(['boolean', 'Ward', 'integer 0 to 99']);
  });

  it('marks every one of them as remembered', () => {
    const { resolved } = remember('remembers { :visits 0 }');
    expect(resolved.every((p) => p.remembered)).toBe(true);
  });

  it('refuses the same name remembered twice, at the second', () => {
    const { resolved, refusals } = remember('remembers { :visits 0 :visits 1 }');
    expect(resolved.map((p) => p.name)).toEqual(['visits']);
    expect(refusals[0]!.message).toBe('`:visits` is remembered twice.');
  });

  it('drops one it cannot resolve and keeps the rest', () => {
    const { resolved, refusals } = remember('remembers { :handled false :ward iron :visits 0 }');
    expect(resolved.map((p) => p.name)).toEqual(['handled', 'visits']);
    expect(refusals).toHaveLength(1);
  });

  it('remembers nothing when it says nothing', () => {
    expect(remember('remembers { }').resolved).toEqual([]);
  });
});

describe('a composer restates a property to change its default, keeping its type', () => {
  /** A property as the kind that declared it holds it. */
  function composed(text: string, remembered = false): ResolvedProperty {
    const diagnostics = new Diagnostics();
    const declared = parseProperty(new SourceFile('container.sprout', text), diagnostics);
    const resolved = resolveProperty(
      declared!,
      ENUMS,
      'sprout',
      'sprout.Container',
      diagnostics,
      remembered,
    );
    expect(diagnostics.refusals, text).toEqual([]);
    return resolved!;
  }
  const CAPACITY = composed(':capacity 8 min 0 max 99');
  const WARD = composed(':ward printers_shop.Ward default oak');
  const OPENED = composed(':opened false', true);

  /** Restate `of` in `printers_shop.Crate`'s body. */
  function restate(of: ResolvedProperty, text: string, remembered = false) {
    const diagnostics = new Diagnostics();
    const declared = parseProperty(new SourceFile('crate.sprout', text), diagnostics);
    const resolved = restateProperty(
      of,
      declared!,
      remembered,
      ENUMS,
      'printers_shop',
      'printers_shop.Crate',
      diagnostics,
    );
    return { resolved, refusals: diagnostics.refusals };
  }

  it('reads a bare default against the composed type, so `:capacity 40` keeps the range', () => {
    const { resolved, refusals } = restate(CAPACITY, ':capacity 40');
    expect(refusals).toEqual([]);
    expect(resolved!.type).toEqual(integer(0, 99));
    expect(resolved!.declaration.default).toMatchObject({ value: 40 });
  });

  it('takes a bare option, since the enum is already known: `:ward silver`', () => {
    const { resolved, refusals } = restate(WARD, ':ward silver');
    expect(refusals).toEqual([]);
    expect(showType(resolved!.type)).toBe('Ward');
  });

  it('makes the restating kind the origin', () => {
    expect(restate(CAPACITY, ':capacity 40').resolved!.origin).toBe('printers_shop.Crate');
  });

  it('refuses a default outside the composed range, at the default', () => {
    const { resolved, refusals } = restate(CAPACITY, ':capacity 400');
    expect(resolved).toBeNull();
    expect(refusals.map((d) => [locationOf(d.at), d.message])).toEqual([
      ['crate.sprout:1:11', '400 is outside 0 to 99.'],
    ]);
  });

  it('takes the composed type written out in full', () => {
    const { resolved, refusals } = restate(CAPACITY, ':capacity 40 min 0 max 99');
    expect(refusals).toEqual([]);
    expect(resolved!.type).toEqual(integer(0, 99));
  });

  it('refuses another type, at the type, naming the one it keeps and where it is from', () => {
    const { resolved, refusals } = restate(CAPACITY, ':capacity string default "big"');
    expect(resolved).toBeNull();
    expect(refusals.map((d) => [locationOf(d.at), d.message, d.remedy])).toEqual([
      [
        'crate.sprout:1:11',
        '`:capacity` holds integer 0 to 99 in `sprout.Container`, and whatever composes it keeps that type.',
        'Restate only its default, as in `:capacity 8`; a property holding something else takes a name of its own.',
      ],
    ]);
  });

  it('refuses another range as a change of type, and offers the default that was written', () => {
    const { resolved, refusals } = restate(CAPACITY, ':capacity 40 min 0 max 50');
    expect(resolved).toBeNull();
    expect(refusals.map((d) => [locationOf(d.at), d.remedy])).toEqual([
      [
        'crate.sprout:1:18',
        'Restate only its default, as in `:capacity 40`; a property holding something else takes a name of its own.',
      ],
    ]);
  });

  it('refuses a remembered property restated as a plain one, and the reverse', () => {
    const plain = restate(OPENED, ':opened true');
    expect(plain.resolved).toBeNull();
    expect(plain.refusals.map((d) => [d.message, d.remedy])).toEqual([
      [
        '`:opened` is remembered about each actor in `sprout.Container`, and whatever composes it keeps that.',
        'Restate it as it is declared there: `remembers { :opened true }`.',
      ],
    ]);
    const remembered = restate(CAPACITY, ':capacity 40', true);
    expect(remembered.refusals.map((d) => d.message)).toEqual([
      '`:capacity` is not remembered in `sprout.Container`, and whatever composes it keeps that.',
    ]);
  });

  it('keeps a remembered property remembered', () => {
    const { resolved, refusals } = restate(OPENED, ':opened true', true);
    expect(refusals).toEqual([]);
    expect(resolved!.remembered).toBe(true);
  });
});

describe('a restatement is written out for a remedy as the author would write it', () => {
  it('writes a property with its default as it was written', () => {
    expect(restatementOf(declare(':state Drying default wet').resolved!)).toBe('`:state wet`');
    expect(restatementOf(declare(':note "a \\{line}"').resolved!)).toBe('`:note "a \\{line}"`');
  });

  it('writes a remembered one inside a `remembers` block', () => {
    const diagnostics = new Diagnostics();
    const declared = parseRemembers(
      new SourceFile('k.sprout', 'remembers { :seen 0 }'),
      diagnostics,
    );
    const [seen] = resolveRemembers(declared!, ENUMS, 'printers_shop', ORIGIN, diagnostics);
    expect(restatementOf(seen!)).toBe('`remembers { :seen 0 }`');
  });
});
