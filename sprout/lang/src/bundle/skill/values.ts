// Properties, their types, and what reads, writes and draws them, for the
// generated skill (the spec's Properties, types and values; Chance ›
// The forms). The words are the checker's own tables, and one with no
// entry here is a defect the generator throws for; every example is
// compiled, together, in one probing kind, and the generator throws
// where compiling them says anything at all.

import { compileSnippet, type Snippet } from './bench.js';
import { blocks, code, heading, listed, table } from './markdown.js';
import { BODIES, standsIn } from './statements.js';
import { entriesFor, type Entry } from './entries.js';
import { DRAWS } from '../../check/chance.js';
import { READINGS } from '../../check/check/readings.js';
import { EFFECTS } from '../../check/check/writes.js';
import { BUILT_IN_TYPES, INTEGER_MAX, INTEGER_MIN } from '../../declare/types.js';
import { renderDiagnostics } from '../../source/diagnostics.js';

/** Each type a property may have, by the word it is written with: an enum's and a list's by what they are. */
export const TYPE_TABLE: readonly Entry[] = [
  {
    word: 'boolean',
    example: ':lit false',
    means: '`true` or `false`, the type taken from the literal',
  },
  {
    word: 'integer',
    example: ':wear 0 min 0 max 99',
    means: 'a whole number, within `min` and `max` where they are written',
  },
  {
    word: 'string',
    example: ':note string default ""',
    means: 'short text, set and compared, never joined',
  },
  {
    word: 'enum',
    example: ':ward Ward default oak',
    means: 'one of an enum’s options; declare it with `enum Ward { oak, silver }`',
  },
  {
    word: 'list',
    example: ':opens [Ward] default [oak]',
    means: 'an ordered list of one type, without duplicates',
  },
  {
    word: 'remembers',
    example: 'remembers { :visits 0 min 0 max 99 }',
    means: 'properties held for each actor rather than once for the object',
  },
];

/** Each reading the checker knows. */
export const READING_TABLE: readonly Entry[] = [
  { word: 'get', example: 'self.get(:lit)', means: 'a property’s value' },
  {
    word: 'recall',
    example: 'actor.recall(:visits)',
    means: 'what `self` remembers about an actor',
  },
  {
    word: 'count',
    example: 'self.count',
    means:
      'how many things a container holds, or a list or set role; `count(K)` only those of a kind',
  },
  { word: 'holds', example: 'self.holds(tool)', means: 'whether a thing is directly inside it' },
  {
    word: 'is',
    example: 'tool.is(Probe)',
    means: 'whether a thing is of a kind; `if (x.is(K))` lets its branch read `x` as a `K`',
  },
  {
    word: 'includes',
    example: 'self.get(:opens).includes(:silver)',
    means: 'whether a list or a set role holds a value',
  },
];

/** Each call that writes, which only `self` may make of itself. */
export const WRITE_TABLE: readonly Entry[] = [
  { word: 'set', example: 'self.set(:lit, true)', means: 'gives a property a value of its type' },
  {
    word: 'adjust',
    example: 'self.adjust(:wear, 1)',
    means: 'adds to an integer, clamped to its range; on an actor, to what is remembered',
  },
  { word: 'add', example: 'self.add(:opens, :silver)', means: 'puts a value in a list, once' },
  { word: 'remove', example: 'self.remove(:opens, :oak)', means: 'takes a value out of a list' },
  {
    word: 'remember',
    example: 'actor.remember(:visits, 1)',
    means: 'sets what `self` remembers about an actor',
  },
];

/** A line said before a write of what it reads: rendered after the write, since a turn's lines render once its work is done. */
export const RENDERED_AFTER = {
  property: ':count 3 min 0 max 99',
  line: 'say "{self.get(:count)} left"',
  write: 'self.adjust(:count, -1)',
} as const;

/** Each draw, which a body that decides or describes may not make. */
export const DRAW_TABLE: readonly Entry[] = [
  { word: 'chance', example: 'chance(3)', means: 'true one time in three' },
  { word: 'random', example: 'random(6)', means: 'a whole number from 0 to 5' },
];

/** The kind every example stands in: each type a property, each reading a `let`, each write and draw in its `do`, and the line said before its write. */
export function valuesProbe(): Snippet {
  const readings = READING_TABLE.map((entry, i) => `let r${i} = ${entry.example}`);
  const draws = DRAW_TABLE.map((entry, i) => `let d${i} = ${entry.example}`);
  const statements = [
    ...readings,
    ...draws,
    ...WRITE_TABLE.map((entry) => entry.example),
    RENDERED_AFTER.line,
    RENDERED_AFTER.write,
  ];
  return {
    hall: '    object probe is Probe',
    files: {
      'probe.sprout': [
        'kind Probe is sprout.Actor {',
        ...TYPE_TABLE.map((entry) => `  ${entry.example}`),
        `  ${RENDERED_AFTER.property}`,
        '  as target for poke {',
        '    do {',
        ...statements.map((statement) => `      ${statement}`),
        '      say "Poked."',
        '    }',
        '  }',
        '}',
        '',
        'verb poke { role target  role tool  "poke [target] with [tool]" }',
        '',
      ].join('\n'),
      'ward.sprout': 'enum Ward { oak, silver }\n',
    },
  };
}

function rows(entries: readonly Entry[]): string[][] {
  return entries.map((entry) => [code(entry.example), entry.means]);
}

/** The values section: the types a property is declared with, then the calls that read, write and draw. */
export function valuesSection(): string {
  const { diagnostics } = compileSnippet(valuesProbe());
  if (diagnostics.length > 0) {
    throw new Error(
      `The skill's examples of values do not compile cleanly:\n${renderDiagnostics(diagnostics)}`,
    );
  }
  const types = entriesFor('type', [...BUILT_IN_TYPES, 'enum', 'list', 'remembers'], TYPE_TABLE);
  const draw = { word: 'let', example: `let d = ${DRAW_TABLE[0]!.example}`, does: '' };
  const drawsStand = BODIES.filter((body) => standsIn(draw, body)).map((body) => body.name);
  const range = `${INTEGER_MIN.toLocaleString('en-US')} to ${INTEGER_MAX.toLocaleString('en-US')}`;
  return blocks(
    heading(2, 'Properties and values'),
    'A property is a name, a type and a default, always written: there is no null. ' +
      `An integer written without \`min\` and \`max\` ranges over ${range}. ` +
      'A kind or an object restating a property it composes changes the default and keeps the type.',
    table(['declared as', 'holds'], rows(types)),
    heading(3, 'Reading'),
    table(['written', 'gives'], rows(entriesFor('reading', READINGS, READING_TABLE))),
    heading(3, 'Writing'),
    'Only `self` writes `self`; anything else is asked, with a message.',
    table(['written', 'does'], rows(entriesFor('write', [...EFFECTS], WRITE_TABLE))),
    'A turn’s lines are rendered once its work is done, against what it wrote, so a line reads a ' +
      'property as the turn left it whichever comes first: ' +
      `${code(RENDERED_AFTER.line)} followed by ${code(RENDERED_AFTER.write)} says the count ` +
      'after the adjust.',
    heading(3, 'Chance'),
    'In prose, `{one of}…{or}…{/one of}` picks one choice. ' +
      `A draw may stand in ${listed(drawsStand)}, and in no other body.`,
    table(['written', 'gives'], rows(entriesFor('draw', [...DRAWS], DRAW_TABLE))),
  );
}
