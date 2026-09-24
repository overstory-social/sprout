// The statements, and where each may stand, for the generated skill (the
// spec's The compiler › The generated skill, What it refuses). The words
// are the parser's own table, and a word with no entry here is a defect
// the generator throws for. Where a statement may stand is not written
// down: its example is compiled in each kind of body, and the body it is
// refused in is one it may not stand in, so the table says what the
// checker does.

import { compileSnippet, type Snippet } from './bench.js';
import { entriesFor } from './entries.js';
import { blocks, code, heading, table } from './markdown.js';
import { STATEMENT_WORDS } from '../../syntax/parse/statements.js';

/** A kind of body a statement is written in, as the table's column names it. */
export interface Body {
  readonly name: string;
  /** The member `statement` stands in, written in the probing kind. */
  wrap(statement: string): string;
}

/** Every kind of body a block belongs to (the spec's Movement and consent; Verbs › The two passes; Events). */
export const BODIES: readonly Body[] = [
  { name: 'a guard', wrap: (s) => `accept (item, from) { ${s} }` },
  { name: 'a `permit`', wrap: (s) => `as target for poke { permit { ${s} } do { say "Poked." } }` },
  { name: 'a `do`', wrap: (s) => `as target for poke { do { ${s}  say "Poked." } }` },
  { name: 'a `describe`', wrap: (s) => `describe { text "A probe." ${s} }` },
  { name: 'a handler or hook', wrap: (s) => `on :stir { ${s} }` },
];

/** A statement as the skill lists it: the word it starts with, an example, and what it does. */
export interface StatementEntry {
  /** The word, or null for a call written as a statement. */
  readonly word: string | null;
  readonly example: string;
  readonly does: string;
  /** Whether the kind the example is compiled in is a place, as a `connect` needs; else an actor. */
  readonly place?: boolean;
}

/** Each statement, in the parser's order, then a call. */
export const STATEMENT_TABLE: readonly StatementEntry[] = [
  {
    word: 'if',
    example: 'if (self.get(:lit)) { } else { }',
    does: 'runs a block when a condition holds; `else if` chains; `if (x.is(K))` narrows `x`',
  },
  {
    word: 'refuse',
    example: 'refuse "Not now."',
    does: 'decides no, in text in quotes or a passage by its name',
  },
  { word: 'allow', example: 'allow', does: 'decides yes, and nothing after it runs' },
  {
    word: 'say',
    example: 'say "Hello."',
    does: 'speaks to the one acting, in text or a passage',
  },
  {
    word: 'tell',
    example: 'tell "Hello."',
    does: 'speaks to everyone else there, or `tell p "…"` to one person',
  },
  { word: 'text', example: 'text "Hello."', does: 'gives a description its words' },
  { word: 'let', example: 'let lit = self.get(:lit)', does: 'names a value, once, for the block' },
  {
    word: 'spawn',
    example: 'spawn Crumb in self',
    does: 'makes a new object of a kind inside something; `let c = spawn …` names it',
  },
  {
    word: 'destroy',
    example: 'destroy self',
    does: 'removes the object, and what it holds, when the body ends',
  },
  {
    word: 'finally',
    example: 'finally destroy self',
    does: 'removes the object once everything the turn sent has been handled',
  },
  { word: 'move', example: 'move self to hall', does: 'proposes a move, which consent may refuse' },
  {
    word: 'connect',
    example: 'connect onward to self',
    does: 'says where one of its own links leads, to a place made while the world runs',
    place: true,
  },
  {
    word: 'act',
    example: 'act poke (target: self)',
    does: 'runs a verb as the object itself, which is an actor',
  },
  { word: 'send', example: 'send self :stir', does: 'sends a message to one thing in range' },
  {
    word: 'broadcast',
    example: 'broadcast :stir',
    does: 'sends a message outward and inward through what holds what',
  },
  {
    word: 'wake',
    example: 'wake in 10 minutes',
    does: 'asks to be sent `:woke` later, in seconds, minutes or hours',
  },
  {
    word: 'each',
    example: 'each crumb: Crumb in self { send crumb :stir }',
    does: 'walks what a container holds directly, in its order; `: K` takes only those of a kind, and `each t of tools` walks a set role',
  },
  {
    word: null,
    example: 'self.set(:lit, true)',
    does: 'a call that writes, one of those under Writing below',
  },
];

/** The world a statement is probed in: one kind, `Probe`, with `example` in one body of it. */
function probe(entry: StatementEntry, body: Body): Snippet {
  const members = [
    ':lit false',
    ...(entry.place === true ? ['grammar { link onward "onward" }'] : []),
    'on :woke (elapsed) { }',
    body.wrap(entry.example),
  ];
  const composes = entry.place === true ? 'sprout.Place' : 'sprout.Actor';
  return {
    hall: '    object probe is Probe\n    object shed is sprout.Place',
    files: {
      'probe.sprout': [
        `kind Probe is ${composes} {`,
        ...members.map((member) => `  ${member}`),
        '}',
        '',
        'verb poke { role target  "poke [target]" }',
        'message :stir',
        '',
      ].join('\n'),
      'crumb.sprout': 'kind Crumb { }\n',
    },
  };
}

/** Whether `entry`'s example compiles, without a refusal, in `body`. */
export function standsIn(entry: StatementEntry, body: Body): boolean {
  const { diagnostics } = compileSnippet(probe(entry, body));
  return !diagnostics.some((diagnostic) => diagnostic.severity === 'refusal');
}

/** The table's entries in the parser's order, then a call; throws for a word the table does not have. */
export function statementEntries(): StatementEntry[] {
  const entries = entriesFor('statement', STATEMENT_WORDS, STATEMENT_TABLE);
  return [...entries, ...STATEMENT_TABLE.filter((one) => one.word === null)];
}

/** The statements section: each one, what it does, and each body it may stand in. */
export function statementsSection(): string {
  const rows = statementEntries().map((entry) => {
    const stands = BODIES.map((body) => (standsIn(entry, body) ? 'yes' : '—'));
    return [code(entry.example), entry.does, ...stands];
  });
  return blocks(
    heading(2, 'Statements, and where each may stand'),
    'A body is a block of statements. A guard (`depart`, `release`, `accept`) and a `permit` decide, ' +
      'a `do` and a handler act, and a `describe` gives words; which statements each may hold is ' +
      'what compiling each example in each body said. None may stand where it is marked —.',
    table(['statement', 'what it does', ...BODIES.map((body) => body.name)], rows),
  );
}
