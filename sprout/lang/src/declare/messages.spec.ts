import { describe, expect, it } from 'vitest';

import type { MessageDeclaration } from '../syntax/ast.js';
import { Diagnostics } from '../source/diagnostics.js';
import { ENGINE_MESSAGES } from './engine-messages.js';
import { EnumTable } from './enums.js';
import { MessageTable } from './messages.js';
import { parseDeclarations } from '../syntax/parse.js';
import { SourceFile } from '../source/source.js';
import { BOOLEAN, integer, showType, STRING } from './types.js';

function enumsOf(text: string, library = 'printers_shop'): EnumTable {
  const enums = new EnumTable();
  const diagnostics = new Diagnostics();
  enums.add(
    library,
    parseDeclarations(new SourceFile('enums.sprout', text), diagnostics).filter(
      (d) => d.kind === 'enum',
    ),
    diagnostics,
  );
  return enums;
}
const ENUMS = enumsOf('enum Ward { oak, silver }');

/** Declare messages the way a file does, and put them in a table. */
function declare(text: string, library = 'printers_shop', enums = ENUMS) {
  const diagnostics = new Diagnostics();
  const declared = parseDeclarations(new SourceFile('events.sprout', text), diagnostics).filter(
    (d): d is MessageDeclaration => d.kind === 'message',
  );
  const table = new MessageTable();
  table.add(library, declared, enums, diagnostics);
  return { table, diagnostics, refusals: diagnostics.refusals };
}

describe('a message is declared with the type of what it carries, if it carries anything', () => {
  it('reads the spec’s own three', () => {
    const { table, refusals } = declare(
      ['message :stir', 'message :unlock_attempt', 'message :illuminating with boolean'].join('\n'),
    );
    expect(refusals).toEqual([]);
    expect(table.all().map((m) => m.name)).toEqual(['stir', 'unlock_attempt', 'illuminating']);
    expect(table.unqualified('stir', 'printers_shop')!.carries).toBeNull();
    expect(table.unqualified('illuminating', 'printers_shop')!.carries).toEqual(BOOLEAN);
  });

  it('carries any of the value types', () => {
    const { table, refusals } = declare(
      [
        'message :a with integer',
        'message :b with string',
        'message :c with Ward',
        'message :d with [Ward]',
      ].join('\n'),
    );
    expect(refusals).toEqual([]);
    const carried = (name: string) => showType(table.unqualified(name, 'printers_shop')!.carries!);
    expect([carried('a'), carried('b'), carried('c'), carried('d')]).toEqual([
      'integer',
      'string',
      'Ward',
      '[Ward]',
    ]);
  });

  it('carries nothing when it says nothing', () => {
    expect(declare('message :stir').table.unqualified('stir', 'printers_shop')!.carries).toBeNull();
  });

  it('refuses a carried type that is not a type', () => {
    const { table, refusals } = declare('message :a with Nonsense');
    expect(refusals[0]!.message).toBe('`Nonsense` is not a type.');
    expect(table.unqualified('a', 'printers_shop')).toBeNull();
  });

  it('refuses a message carrying an object, which is never written', () => {
    const { table, refusals } = declare('message :a with object');
    expect(refusals[0]!.message).toBe('The object type is never written.');
    expect(table.unqualified('a', 'printers_shop')).toBeNull();
  });
});

describe('a message’s identity is its library and its name', () => {
  it('keeps two libraries’ messages of one name apart', () => {
    const table = new MessageTable();
    const diagnostics = new Diagnostics();
    const one = parseDeclarations(
      new SourceFile('a.sprout', 'message :stir with integer'),
      diagnostics,
    ).filter((d): d is MessageDeclaration => d.kind === 'message');
    const two = parseDeclarations(new SourceFile('b.sprout', 'message :stir'), diagnostics).filter(
      (d): d is MessageDeclaration => d.kind === 'message',
    );
    table.add('sprout', one, ENUMS, diagnostics);
    table.add('printers_shop', two, ENUMS, diagnostics);
    expect(diagnostics.refusals).toEqual([]);
    expect(table.qualified('sprout', 'stir')!.carries).toEqual(integer());
    expect(table.qualified('printers_shop', 'stir')!.carries).toBeNull();
  });

  it('refuses two of one name in one library, naming the second', () => {
    const { table, refusals } = declare('message :stir\nmessage :stir with boolean');
    expect(refusals).toHaveLength(1);
    expect(refusals[0]!.message).toBe('printers_shop declares two messages called `:stir`.');
    expect(table.unqualified('stir', 'printers_shop')!.carries).toBeNull();
  });

  it('finds the standard library’s from anywhere, since `sprout` is always in scope', () => {
    const table = new MessageTable();
    const diagnostics = new Diagnostics();
    table.add(
      'sprout',
      parseDeclarations(new SourceFile('a.sprout', 'message :stir'), diagnostics).filter(
        (d): d is MessageDeclaration => d.kind === 'message',
      ),
      ENUMS,
      diagnostics,
    );
    expect(table.unqualified('stir', 'printers_shop')!.library).toBe('sprout');
    expect(table.unqualified('stir', 'anything_at_all')!.library).toBe('sprout');
  });

  it('knows nothing about a message nobody declared', () => {
    expect(new MessageTable().unqualified('illumnating', 'printers_shop')).toBeNull();
  });

  it('resolves a carried enum from the declaring library’s own scope', () => {
    // `Ward` is the world's, so a `sprout` message cannot see it.
    const { table, refusals } = declare('message :a with Ward', 'sprout');
    expect(refusals[0]!.message).toBe('`Ward` is not a type.');
    expect(table.all()).toEqual([]);
  });
});

describe('an authored message may not take an engine message’s name', () => {
  it('refuses each of the eight, at the name, and declares none of them', () => {
    for (const { name } of ENGINE_MESSAGES) {
      const { table, refusals } = declare(`message :${name}`);
      expect(refusals, name).toHaveLength(1);
      expect(refusals[0]!.message).toBe(
        `\`:${name}\` is one of the engine's messages, and the engine sends those itself.`,
      );
      expect(refusals[0]!.at.start, name).toBe('message '.length);
      expect(refusals[0]!.remedy).toContain('as in `:rang`');
      expect(table.all()).toEqual([]);
    }
  });

  it('names every engine message in the remedy', () => {
    const { refusals } = declare('message :tick with integer');
    for (const { name } of ENGINE_MESSAGES) expect(refusals[0]!.remedy).toContain(`\`:${name}\``);
  });

  it('refuses a library’s as well as a world’s, the standard library’s included', () => {
    expect(declare('message :woke', 'sprout').refusals).toHaveLength(1);
    expect(declare('message :arrived', 'a_library').refusals).toHaveLength(1);
  });

  it('keeps the rest of the declarations', () => {
    const { table, refusals } = declare('message :entered\nmessage :rang');
    expect(refusals).toHaveLength(1);
    expect(table.all().map((m) => m.name)).toEqual(['rang']);
  });

  it('leaves a name that only begins like one alone', () => {
    expect(declare('message :ticked\nmessage :arrived_late').refusals).toEqual([]);
  });
});

describe('what the parser makes of a message declaration', () => {
  it('refuses a message with no name', () => {
    const diagnostics = new Diagnostics();
    parseDeclarations(new SourceFile('a.sprout', 'message stir'), diagnostics);
    expect(diagnostics.refusals[0]!.message).toBe('A message needs a name.');
    expect(diagnostics.refusals[0]!.remedy).toContain('`message :stir`');
  });

  it('refuses `with` followed by nothing that is a type', () => {
    const diagnostics = new Diagnostics();
    parseDeclarations(new SourceFile('a.sprout', 'message :a with 4'), diagnostics);
    expect(diagnostics.refusals[0]!.message).toContain('is not a type');
  });

  it('keeps reading after one it cannot read', () => {
    const diagnostics = new Diagnostics();
    const declared = parseDeclarations(
      new SourceFile('a.sprout', 'message stir\nmessage :fired'),
      diagnostics,
    );
    expect(declared).toHaveLength(1);
    expect((declared[0] as MessageDeclaration).name.text).toBe('fired');
  });

  it('reads messages and enums from one file', () => {
    const diagnostics = new Diagnostics();
    const declared = parseDeclarations(
      new SourceFile('a.sprout', 'enum Ward { oak }\nmessage :stir\nenum Cuff { dry }'),
      diagnostics,
    );
    expect(diagnostics.refusals).toEqual([]);
    expect(declared.map((d) => d.kind)).toEqual(['enum', 'message', 'enum']);
  });

  it('carries a string as readily as anything else', () => {
    expect(
      declare('message :said with string').table.unqualified('said', 'printers_shop')!.carries,
    ).toEqual(STRING);
  });
});
