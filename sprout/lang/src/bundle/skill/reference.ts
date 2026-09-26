// The generated skill's reference sections (the spec's The compiler › The
// generated skill): the manifest's fields, the declarations and the
// members of a body, the limits and what passing each does, the reserved
// words, and the extensions a host installs. Each list is the compiler's
// own table; where the skill adds an example and a sentence, a word with
// none is a defect the generator throws for, and the examples of the
// members are compiled together in one probing kind.

import { compileSnippet, type Snippet } from './bench.js';
import { entriesFor, type Entry } from './entries.js';
import { blocks, code, heading, listed, table } from './markdown.js';
import { MANIFEST_FIELDS } from '../manifest.js';
import { LIMIT_TABLE, type Limits, type WhenExceeded } from '../limits.js';
import type { Extension, ExtensionParameterType } from '../../declare/extensions.js';
import { MEMBER_WORDS, RESERVED_WORDS } from '../../syntax/reserved.js';
import { DECLARATION_READERS } from '../../syntax/parse/declarations.js';
import { kindMembers } from '../../syntax/parse/bodies.js';
import { Parser } from '../../syntax/parse/parser.js';
import { worldMembers } from '../../syntax/parse/world.js';
import { Diagnostics, renderDiagnostics } from '../../source/diagnostics.js';
import { SourceFile } from '../../source/source.js';

/** The manifest section: every field, and what to write for it. */
export function manifestSection(): string {
  const rows = Object.entries(MANIFEST_FIELDS).map(([field, write]) => [code(field), write]);
  return blocks(
    heading(2, 'The manifest'),
    '`sprout.json` says what the world is before a line of it is read. Every file the world is made ' +
      'of is named in `files`, and a kind is written in the file named for it: `kind TypeCase` in ' +
      '`type_case.sprout`, the world in the file named for the world.',
    table(['field', 'write'], rows),
  );
}

/** Each declaration a file may hold, by the word it starts with. */
export const DECLARATION_TABLE: readonly Entry[] = [
  {
    word: 'enum',
    example: 'enum Ward { oak, silver }',
    means: 'a named set of options, which a property or a value role holds one of',
  },
  {
    word: 'kind',
    example: 'kind Lamp is sprout.Fixture { … }',
    means: 'what things are made of; a kind composes others with `is`',
  },
  {
    word: 'message',
    example: 'message :lit with boolean',
    means: 'a message things send each other, with the type of the value it carries, if any',
  },
  {
    word: 'object',
    example: 'object lamp is Lamp { … }',
    means: 'a thing in the world, written inside the world or inside what holds it',
  },
  {
    word: 'verb',
    example: 'verb light { role target: Lamp  "light [target]" }',
    means: 'something a visitor types: its roles, then its phrases',
  },
  {
    word: 'world',
    example: 'world lantern_yard is sprout.World { … }',
    means: 'the world, once, in the file named for it; everything in it is written in its body',
  },
];

/** Each member a kind's body, an object's or the world's may hold, by the word it starts with. */
export const MEMBER_TABLE: readonly Entry[] = [
  {
    word: 'remembers',
    example: 'remembers { :visits 0 min 0 max 99 }',
    means: 'properties held for each actor',
  },
  {
    word: 'visitors',
    example: 'visitors are Person',
    means: 'the world’s kind for visitors, and `visitors arrive at yard`, where they start',
  },
  {
    word: 'contains',
    example: 'contains',
    means: 'it holds things; `contains actors` holds people too',
  },
  { word: 'passage', example: 'passage hum { {self} hums. }', means: 'named words, said by name' },
  {
    word: 'prose',
    example: 'prose "probe.prose"',
    means: 'passages written in a `.prose` file beside it',
  },
  {
    word: 'without',
    example: 'without on :stir from Bell',
    means: 'leaves out one member it would take from a kind it composes',
  },
  {
    word: 'grammar',
    example: 'grammar { name "probe"  nouns "gadget" }',
    means: 'what it is called and answers to, and a place’s exits and links',
  },
  {
    word: 'describe',
    example: 'describe { text "A probe." }',
    means: 'what whoever looks at it reads',
  },
  { word: 'depart', example: 'depart (to) { allow }', means: 'a guard on it being moved away' },
  {
    word: 'release',
    example: 'release (item, to) { allow }',
    means: 'a guard on something it holds being taken out',
  },
  {
    word: 'accept',
    example: 'accept (item, from) { allow }',
    means: 'a guard on something being put in it',
  },
  {
    word: 'as',
    example: 'as target for poke { do { say "Poked." } }',
    means: 'its part in a verb: a `permit` that may refuse, and a `do` that acts',
  },
  { word: 'on', example: 'on :stir { tell "Stirred." }', means: 'a handler for a message' },
  {
    word: 'changed',
    example: 'changed :lit (was) { tell "It flickers." }',
    means: 'a hook, run when one of its own properties changes',
  },
  {
    word: 'pass',
    example: 'pass any (true)',
    means: 'whether a message sent inside it passes out, or from outside in',
  },
  { word: 'object', example: 'object pin is Pin', means: 'a thing inside it' },
];

/** The member words a body's readers answer to: a kind's and an object's, and the world's. */
function memberWords(): { kind: Set<string>; world: Set<string> } {
  const p = new Parser(new SourceFile('', ''), new Diagnostics(), DECLARATION_READERS);
  return {
    kind: new Set(kindMembers(p, '', () => null).keys()),
    world: new Set(worldMembers(p, '').keys()),
  };
}

/** Every member example but the world's own, in one kind, with what each needs beside it. */
export function membersProbe(): Snippet {
  const own = MEMBER_TABLE.filter((entry) => entry.word !== 'visitors');
  return {
    hall: '    object probe is Probe',
    files: {
      'probe.sprout': [
        'kind Probe is Bell {',
        '  :lit false',
        ...own.map((entry) => `  ${entry.example}`),
        '}',
        '',
        'verb poke { role target  "poke [target]" }',
        'message :stir',
        '',
      ].join('\n'),
      'probe.prose': 'passage later { Later. }\n',
      'bell.sprout': 'kind Bell {\n  on :stir { tell "It rings." }\n}\n',
      'pin.sprout': 'kind Pin { }\n',
    },
  };
}

/** The declarations section: what a file declares, then what a body may hold. */
export function declarationsSection(): string {
  const { diagnostics } = compileSnippet(membersProbe());
  const refused = diagnostics.filter((diagnostic) => diagnostic.severity === 'refusal');
  if (refused.length > 0) {
    throw new Error(
      `The skill's examples of members do not compile:\n${renderDiagnostics(refused)}`,
    );
  }
  const declarations = entriesFor(
    'declaration',
    [...DECLARATION_READERS.keys()],
    DECLARATION_TABLE,
  );
  const { kind, world } = memberWords();
  const words = [...new Set([...kind, ...world])];
  const members = entriesFor('member', words, MEMBER_TABLE).map((entry) => [
    code(entry.example),
    entry.means,
    kind.has(entry.word) ? 'yes' : '—',
    world.has(entry.word) ? 'yes' : '—',
  ]);
  return blocks(
    heading(2, 'Declarations'),
    'A `.sprout` file holds declarations, in any order. Names resolve across files, and `sprout`’s ' +
      'kinds, verbs and messages may be written unqualified.',
    table(
      ['declaration', 'declares'],
      declarations.map((entry) => [code(entry.example), entry.means]),
    ),
    heading(3, 'What a body holds'),
    'A body is what is between a declaration’s braces. Besides these, every body holds properties, ' +
      'written `:lit false`.',
    table(['member', 'is', 'in a kind or object', 'in the world'], members),
  );
}

/** What passing a limit does, in an author's words. */
const EXCEEDED: Readonly<Record<WhenExceeded, string>> = {
  refusal: 'the world is refused',
  fault: 'the turn faults, and nothing it did happens',
  raised: 'a sooner one waits this long',
  'move-refused': 'the move is refused',
  'nickname-refused': 'the nickname is refused',
};

/** The limits section: every limit, what it bounds, the figure it is at and what passing it does. */
export function limitsSection(limits: Limits): string {
  const figure = (value: number | null): string =>
    value === null ? 'the host’s to set; none by default' : value.toLocaleString('en-US');
  const row = (name: string, bounds: string, value: number | null, exceeded: WhenExceeded) => [
    code(name),
    bounds,
    figure(value),
    EXCEEDED[exceeded],
  ];
  const caps = LIMIT_TABLE.filter((limit) => limit.kind === 'cap').map((limit) =>
    row(limit.name, limit.bounds, limits.caps[limit.name as keyof Limits['caps']], limit.exceeded),
  );
  const budgets = LIMIT_TABLE.filter((limit) => limit.kind === 'budget').map((limit) =>
    row(
      limit.name,
      limit.bounds,
      limits.budgets[limit.name as keyof Limits['budgets']],
      limit.exceeded,
    ),
  );
  const head = ['limit', 'bounds', 'figure', 'past it'];
  return blocks(
    heading(2, 'Limits'),
    'Every figure is the host’s; these are the ones this skill was generated with. A cap is checked ' +
      'when the world compiles, and a budget while a turn runs. Blessed library source costs the author nothing.',
    heading(3, 'Caps'),
    table(head, caps),
    heading(3, 'Budgets'),
    table(head, budgets),
  );
}

/** The reserved words section: none may name an option or a binding, and the member words no message or verb. */
export function reservedSection(): string {
  const words = [...RESERVED_WORDS].map(code).join(' ');
  const members = listed([...MEMBER_WORDS].map(code), 'or');
  return blocks(
    heading(2, 'Reserved words'),
    'None of these may name an enum’s option or a binding:',
    words,
    `And no message or verb may be called ${members}.`,
  );
}

/** A parameter's type as an author writes it. */
function parameterType(extension: string, type: ExtensionParameterType): string {
  return typeof type === 'string' ? type : `${extension}.${type.type}`;
}

/** One installed extension: how to pin it, its types, its statements, and its own paragraph. */
function extensionShown(extension: Extension): string {
  const { name, major } = extension;
  const types = extension.types.map((type) => [
    code(`${name}.${type.name}`),
    type.compares === false ? '—' : 'yes',
    type.renders === false ? '—' : 'yes',
  ]);
  const statements = extension.statements.map((statement) => {
    const parameters = statement.parameters
      .map((parameter) => `${parameter.name}: ${parameterType(name, parameter.type)}`)
      .join(', ');
    return [code(`${name}.${statement.name}(${parameters})`), statement.describe ? 'yes' : '—'];
  });
  return blocks(
    heading(3, code(`${name} ${major}`)),
    `Pin it in the manifest, ${code(`"extensions": [{ "name": "${name}", "major": ${major} }]`)}, ` +
      `and write ${code(`extension ${name} ${major}`)} at the top of each file that uses it.`,
    types.length === 0 ? '' : table(['type', 'compares with `==`', 'renders in a slot'], types),
    statements.length === 0 ? '' : table(['statement', 'may stand in a `describe`'], statements),
    extension.skill,
  );
}

/** The extensions section: each extension the host installs, or that it installs none. */
export function extensionsSection(extensions: readonly Extension[]): string {
  return blocks(
    heading(2, 'Extensions this host installs'),
    extensions.length === 0
      ? 'None. A world that pins an extension this host does not install is refused at publish.'
      : 'An extension’s statement may stand in a `do`, a handler or a hook, and in a `describe` where it says so; never in a guard or a `permit`.',
    ...extensions.map(extensionShown),
  );
}
