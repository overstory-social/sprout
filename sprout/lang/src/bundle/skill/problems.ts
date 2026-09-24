// What the compiler warns about and refuses, in its own words, for the
// generated skill (the spec's The compiler › What it warns about, What it
// refuses, Diagnostics). Each entry is a snippet that provokes one; the
// words the skill prints are what compiling it said, so they cannot
// drift from the compiler's. A warning's snippet that is refused, or
// says nothing, and a refusal's that compiles, are defects the generator
// throws for.

import { BENCH, compileSnippet, onTheBench, type Snippet } from './bench.js';
import { blocks, code, fenced, heading } from './markdown.js';
import { renderDiagnostics, type Diagnostic } from '../../source/diagnostics.js';

/** One thing the compiler says, and a snippet that makes it say so. */
export interface ProblemEntry {
  /** What it is about, in an author's words. */
  readonly about: string;
  readonly snippet: Snippet;
}

const one = (name: string, text: string, hall?: string): Snippet => ({
  files: { [name]: text },
  ...(hall === undefined ? {} : { hall }),
});

/** A snippet of one file declaring the kind `of`, with an object of it in the hall. */
const kind = (file: string, text: string, object: string, of: string): Snippet =>
  one(file, text, `    object ${object} is ${of}`);

/** Each warning the compiler issues at publish, in the spec's order. */
export const WARNING_TABLE: readonly ProblemEntry[] = [
  {
    about: 'A handler nothing sends to',
    snippet: kind(
      'bell.sprout',
      'message :ring\n\nkind Bell {\n  on :ring { tell "The bell hums." }\n}\n',
      'bell',
      'Bell',
    ),
  },
  {
    about: 'A message nothing handles',
    snippet: kind(
      'bell.sprout',
      'message :ring\n\nkind Bell {\n  as target for strike { do { send self :ring  say "The bell rings." } }\n}\n\nverb strike { role target  "strike [target]" }\n',
      'bell',
      'Bell',
    ),
  },
  {
    about: 'A declaration hiding a standard library name',
    snippet: one('fixture.sprout', 'kind Fixture { }\n'),
  },
  {
    about: 'An object hiding one of its name further out',
    snippet: one(
      'lamp.sprout',
      'kind Lamp { }\n',
      '    object lamp is Lamp\n    object cupboard is sprout.Container {\n      object lamp is Lamp\n    }',
    ),
  },
  {
    about: 'A verb no object plays a role for',
    snippet: kind(
      'lever.sprout',
      'kind Lever { }\n\nverb pull { role target  "pull [target]" }\n',
      'lever',
      'Lever',
    ),
  },
  {
    about: 'A role in a verb nothing fills',
    snippet: {
      files: {
        'lid.sprout':
          'kind Lid {\n  as target for pry { do { say "The lid gives with a crack." } }\n}\n\nverb pry { role target  role tool: Crowbar  "pry [target] with [tool]" }\n',
        'crowbar.sprout': 'kind Crowbar { }\n',
      },
      hall: '    object lid is Lid',
    },
  },
  {
    about: 'A verb nothing that takes part in ever `say`s for',
    snippet: kind(
      'bell.sprout',
      'verb ring { role target: Bell  "ring [target]" }\n\nkind Bell {\n  :rung false\n  as target for ring { do { self.set(:rung, true) } }\n}\n',
      'bell',
      'Bell',
    ),
  },
  {
    about: 'A passage on an object or the world that nothing invokes',
    snippet: { hall: '    passage arrive { Someone comes in out of the rain. }' },
  },
  {
    about: 'An exit whose `when` is `false`',
    snippet: { hall: '    grammar { exit north "a bricked-up door" -> hall when (false) }' },
  },
  {
    about: '`destroy self` on a declared object',
    snippet: kind(
      'candle.sprout',
      'kind Candle {\n  as target for snuff { do { say "The candle gutters out."  destroy self } }\n}\n\nverb snuff { role target  "snuff [target]" }\n',
      'candle',
      'Candle',
    ),
  },
  {
    about: 'A `.prose` file no kind points at',
    snippet: one('lamp.prose', 'passage glow { It glows. }\n'),
  },
  {
    about: 'An `on :tick` on something that is not a place',
    snippet: kind(
      'cat.sprout',
      'kind Cat {\n  on :tick (elapsed) { tell "The cat stretches." }\n}\n',
      'cat',
      'Cat',
    ),
  },
  {
    about: 'A `wake` nothing answers',
    snippet: kind(
      'kiln.sprout',
      'kind Kiln {\n  as target for fire { do { wake in 10 minutes  say "The kiln roars." } }\n}\n\nverb fire { role target  "fire [target]" }\n',
      'kiln',
      'Kiln',
    ),
  },
  {
    about: 'An `on :woke` nothing asks for',
    snippet: kind(
      'bell.sprout',
      'kind Bell {\n  on :woke (elapsed) { tell "The bell chimes." }\n}\n',
      'bell',
      'Bell',
    ),
  },
  {
    about: 'A `{one of}` with one choice',
    snippet: kind(
      'cat.sprout',
      'kind Cat {\n  as target for pet { do { say purr } }\n  passage purr { {one of}The cat purrs.{/one of} }\n}\n\nverb pet { role target  "pet [target]" }\n',
      'cat',
      'Cat',
    ),
  },
];

/** Refusals an author meets first, each for a rule no table above shows. */
export const REFUSAL_TABLE: readonly ProblemEntry[] = [
  {
    about: 'A write to anything but `self`',
    snippet: kind(
      'lamp.sprout',
      'kind Lamp {\n  :lit false\n  as target for light { do { actor.set(:lit, true)  say "Lit." } }\n}\n\nverb light { role target  "light [target]" }\n',
      'lamp',
      'Lamp',
    ),
  },
  {
    about: '`say` where nobody is acting',
    snippet: kind(
      'cat.sprout',
      'message :stir\n\nkind Cat {\n  on :stir { say "The cat wakes." }\n  as target for pet { do { send self :stir  say "You pet the cat." } }\n}\n\nverb pet { role target  "pet [target]" }\n',
      'cat',
      'Cat',
    ),
  },
  {
    about: '`chance` in a guard',
    snippet: kind(
      'crate.sprout',
      'kind Crate {\n  contains\n  accept (item, from) { if (chance(2)) { refuse "It will not open." } }\n}\n',
      'crate',
      'Crate',
    ),
  },
  {
    about: 'A comparison between different types',
    snippet: kind(
      'kiln.sprout',
      'enum Door { open, closed }\n\nkind Kiln {\n  :door Door default open\n  describe { if (self.get(:door) == "closed") { text "Shut." } else { text "Open." } }\n}\n',
      'kiln',
      'Kiln',
    ),
  },
  {
    about: 'A symbol that is not one of its enum’s options',
    snippet: kind(
      'vessel.sprout',
      'enum State { raw, leather, dry }\n\nkind Vessel {\n  :state State default raw\n  describe { if (self.get(:state) == :dyr) { text "Dry." } else { text "Damp." } }\n}\n',
      'vessel',
      'Vessel',
    ),
  },
  {
    about: 'A composition written with the colon',
    snippet: one('lamp.sprout', 'kind Lamp : sprout.Fixture { }\n'),
  },
  {
    about: 'A kind in a file not named for it',
    snippet: one('things.sprout', 'kind Lamp { }\n'),
  },
  {
    about: 'An object outside the world',
    snippet: one('lamp.sprout', 'object lamp is sprout.Fixture\n'),
  },
  {
    about: 'A `describe` with no `text`',
    snippet: one('lamp.sprout', 'kind Lamp {\n  describe { let lit = true }\n}\n'),
  },
  {
    about: 'An unknown kind',
    snippet: { hall: '    object lamp is Lantern' },
  },
];

/** What compiling `entry`'s snippet said; throws where it did not say what its table promises. */
export function saidBy(entry: ProblemEntry, severity: Diagnostic['severity']): Diagnostic[] {
  const { bundle, diagnostics } = compileSnippet(entry.snippet);
  const said = diagnostics.filter((diagnostic) => diagnostic.severity === severity);
  const compiledAsPromised = severity === 'refusal' ? bundle === null : bundle !== null;
  if (!compiledAsPromised || said.length === 0) {
    throw new Error(
      `The skill's example of ${entry.about.toLowerCase()} does not give a ${severity}:\n${renderDiagnostics(diagnostics)}`,
    );
  }
  return said;
}

/** An entry as the skill shows it: what it is about, the files it wrote that matter, and what the compiler said. */
function shown(entry: ProblemEntry, severity: Diagnostic['severity']): string {
  const said = saidBy(entry, severity);
  const named = new Set(said.map((diagnostic) => diagnostic.at.source.name));
  const world = onTheBench(entry.snippet).files;
  const bench = `${BENCH}.sprout`;
  const written = [...(named.has(bench) ? [bench] : []), ...Object.keys(entry.snippet.files ?? {})];
  return blocks(
    heading(3, entry.about),
    ...written.map((name) => blocks(`${code(name)}:`, fenced('sprout', world[name]!))),
    fenced('text', renderDiagnostics(said)),
  );
}

/** The warnings section: every warning, and the words it is given in. */
export function warningsSection(): string {
  return blocks(
    heading(2, 'What the compiler warns about'),
    'A warning never refuses a world; each is most often a mistake. Each example is compiled in ' +
      `a world, ${code(BENCH)}, of one place, ${code('hall')}, that holds one of the kind it declares:`,
    fenced('sprout', onTheBench({ hall: '    object bell is Bell' }).files[`${BENCH}.sprout`]!),
    ...WARNING_TABLE.map((entry) => shown(entry, 'warning')),
  );
}

/** The refusals section: the refusals an author meets first, and the words each is given in. */
export function refusalsSection(): string {
  return blocks(
    heading(2, 'Some refusals, in the compiler’s words'),
    'Every problem names the line and column of the token it is about, and says what to write instead.',
    ...REFUSAL_TABLE.map((entry) => shown(entry, 'refusal')),
  );
}
