import {
  kindName,
  qualifiedName,
  type Catalogue,
  type InstanceId,
  type ResolvedRole,
  type ResolvedVerb,
} from '@overstory/sprout/lang';
import type {
  ParsedCommand,
  ParsedDraw,
  ParsedFiller,
  ParsedReading,
  ParsedThing,
} from '@overstory/sprout/core';
import { pathOf, type Standing } from '@overstory/sprout-player';

// `sprout parse`: what a world accepts. With no line, every phrase a
// visitor may type, those its synonyms give among them (the spec's Verbs
// › Slots; Parsing; the working notes' "Not language questions, but
// blocking"). With a line, what a visitor standing somewhere would make
// of it: the reading chosen, each role and what fills it, the draw where
// it tied with others, and its consent pass's answer, or the world's
// answer where it is not understood. The line is read by the engine the
// visitor stands on, exactly as a command turn reads it, and the reading is
// never run, so nothing in the world changes.

/** A role as a verb declares it: its name, what fills it, `many` and `optional`. */
function roleWritten(role: ResolvedRole): string {
  const filler = role.filler;
  const fills =
    filler === null || filler.fills === 'open'
      ? ''
      : filler.fills === 'kind'
        ? `: ${kindName(filler.kind)}`
        : `: ${filler.fills}`;
  return `${role.name}${fills}${role.many ? ' many' : ''}${role.optional ? ' optional' : ''}`;
}

/** Every phrase `catalogue`'s world accepts, under its verb. */
export function formatGrammar(catalogue: Catalogue): string {
  const verbs: ResolvedVerb[] = [];
  const phrases = new Map<ResolvedVerb, string[]>();
  for (const phrase of catalogue.phrases) {
    const { verb } = phrase;
    const written = phrase.parts
      .map((part) => ('slot' in part ? `[${verb.roles[part.slot]!.name}]` : part.words.join(' ')))
      .join(' ');
    // An object's synonym reads only where the object takes part.
    const words =
      phrase.only === null
        ? written
        : `${written}   (only with ${pathOf(catalogue.world, phrase.only)})`;
    if (!phrases.has(verb)) {
      verbs.push(verb);
      phrases.set(verb, []);
    }
    phrases.get(verb)!.push(words);
  }
  const blocks = verbs.map((verb) => {
    const roles = verb.roles.length === 0 ? '' : ` (${verb.roles.map(roleWritten).join(', ')})`;
    const typed = phrases.get(verb)!.map((words) => `  ${words}\n`);
    return `${qualifiedName(verb.library, verb.name)}${roles}\n${typed.join('')}`;
  });
  // Each intent after the verbs, with the steps it stands for.
  const intents = [...new Set(catalogue.intentPhrases.map((phrase) => phrase.intent))];
  for (const intent of intents) {
    const typed = catalogue.intentPhrases
      .filter((phrase) => phrase.intent === intent)
      .map(
        (phrase) =>
          `  ${phrase.parts.map((part) => ('slot' in part ? `[${intent.slots[part.slot]!}]` : part.words.join(' '))).join(' ')}\n`,
      );
    const steps = intent.steps
      .map((step) => qualifiedName(step.verb.library, step.verb.name))
      .join(', then ');
    blocks.push(
      `intent ${qualifiedName(intent.library, intent.name)}, which does ${steps}\n${typed.join('')}`,
    );
  }
  return (
    `${catalogue.world} accepts these phrases. Every way a line reads is ranked whole, and the best is understood.\n\n` +
    blocks.join('\n')
  );
}

/** A thing as the one who typed reads it, and where it is as an author writes it. */
function thingWords(thing: ParsedThing, world: InstanceId): string {
  return `${thing.name} (${pathOf(world, thing.id)})`;
}

/** What fills one role, as the one who typed it reads it. */
function fillerWords(filler: ParsedFiller | null, world: InstanceId): string {
  if (filler === null) return 'unbound';
  if ('object' in filler) return thingWords(filler.object, world);
  if ('set' in filler) {
    return filler.set.length === 0
      ? 'nothing'
      : filler.set.map((one) => thingWords(one, world)).join(', ');
  }
  if ('exit' in filler) {
    const { direction, label, to } = filler.exit;
    const way = direction === null ? 'link' : `exit ${direction}`;
    // A drawn way leads nowhere until it is taken.
    return `${way} "${label}" -> ${to === null ? 'one of (…)' : pathOf(world, to)}`;
  }
  return filler.symbol ? `:${filler.value}` : String(filler.value);
}

/** Paragraphs as the page indents them; a line that renders nothing says so. */
function indented(paragraphs: readonly string[]): string {
  const said = paragraphs.length > 0 ? paragraphs : ['(it renders nothing)'];
  return said.map((one) => `  ${one}\n`).join('');
}

/** A reading as the page writes it: its verb, then each role and what fills it. */
function readingWords(reading: ParsedReading, world: InstanceId): string {
  const roles = reading.roles.map((role) => `  ${role.name}: ${fillerWords(role.filler, world)}\n`);
  return `reads as ${reading.verb}\n${roles.join('')}`;
}

/** A reading drawn from a tie, and what the visitor is told it meant. */
function drawnWords(drawn: ParsedDraw | null): string {
  if (drawn === null) return '';
  const among = `drawn from ${drawn.among} readings that tied, as a turn seeded 0 draws it`;
  return drawn.meant === null
    ? `${among}\n`
    : `${among}; the visitor is told first:\n${indented(drawn.meant)}`;
}

/** What one command came to, after where it was typed and its words. */
function commandWords(command: ParsedCommand, world: InstanceId): string {
  if ('faulted' in command) {
    const { name, detail } = command.faulted;
    return `faults as its turn would, ${name}: ${detail}\n`;
  }
  if ('answered' in command) {
    const { passage, paragraphs } = command.answered;
    const name = passage === null ? '' : ` with \`${passage}\``;
    return `not understood; the world answers${name}:\n${indented(paragraphs)}`;
  }
  const tie = drawnWords(command.drawn);
  if ('intent' in command) {
    const { intent, steps } = command;
    const slots = intent.slots.map(
      (slot) =>
        `  ${slot.name}: ${slot.thing === null ? 'unbound' : thingWords(slot.thing, world)}\n`,
    );
    const planned =
      steps.length === 0
        ? 'it plans no step that can run, and is answered with `nothing_happens`\n'
        : `it runs ${steps.length === 1 ? 'one step' : `${steps.length} steps`}, each a turn of its own:\n${steps
            .map((step) => readingWords(step, world).replace(/^(?=.)/gm, '  '))
            .join('')}`;
    return `reads as the intent ${intent.name}\n${slots.join('')}${tie}${planned}`;
  }
  const head = `${readingWords(command.reading, world)}${tie}`;
  const { refused } = command;
  if (refused === null) return `${head}every participant consents\n`;
  if (refused.by === null || refused.origin === null) {
    return `${head}refused by the engine, since ${refused.role} is carried and the actor does not carry what fills it:\n${indented(refused.paragraphs)}`;
  }
  return `${head}refused by ${thingWords(refused.by, world)} as ${refused.role}, in ${refused.origin}'s permit:\n${indented(refused.paragraphs)}`;
}

/** What parsing a line gave: the page, and whether it could be read at all. */
export interface ParsedLine {
  readonly ok: boolean;
  readonly page: string;
}

/**
 * `line` as a visitor standing where `standing` has them would have it
 * read, on the engine they stand on, each command it holds in turn, each
 * charged to a command turn's steps: one that costs more is said to fault,
 * as its turn would.
 */
export function parseLine(line: string, standing: Standing): ParsedLine {
  const world = standing.host.catalogue.world;
  const commands = standing.engine.parse(standing.stored, standing.visit, line);
  const read = commands.map((command) => ({
    ok: !('faulted' in command),
    page: `in ${pathOf(world, standing.place)}, "${command.text}" ${commandWords(command, world)}`,
  }));
  if (read.length === 1) return read[0]!;
  return {
    ok: read.every((one) => one.ok),
    page:
      `"${line}" holds ${read.length} commands, each its own turn; each is read here against the world as it stands now, since nothing runs:\n\n` +
      read.map((one) => one.page).join('\n'),
  };
}
