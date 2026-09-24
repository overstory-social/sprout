import {
  consentPass,
  Draws,
  kindName,
  nicknamesIn,
  objectWords,
  parseCommand,
  pollTurn,
  qualifiedName,
  renderFor,
  type Bound,
  type Catalogue,
  type Choice,
  type InstanceId,
  type Line,
  type PollTurn,
  type RenderContext,
  type ResolvedRole,
  type ResolvedVerb,
} from '@overstory/sprout/lang';

import { pathOf, type Standing } from './stand.js';

// `sprout parse`: what a world accepts. With no line, every phrase a
// visitor may type, in the order the command parser tries them, the first
// that reads winning (the spec's Verbs › Slots; the working notes' "Not
// language questions, but blocking"). With a line, what a visitor
// standing somewhere would make of it: the reading, each role and what
// fills it, and its consent pass's answer, or the world's answer where it
// is not understood. The line is read exactly as a command turn reads it,
// and the reading is never run, so nothing in the world changes.

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

/** Every phrase `catalogue`'s world accepts, under its verb, in the order they are tried. */
export function formatGrammar(catalogue: Catalogue): string {
  const verbs: ResolvedVerb[] = [];
  const phrases = new Map<ResolvedVerb, string[]>();
  for (const phrase of catalogue.phrases) {
    const { verb } = phrase;
    const words = phrase.parts
      .map((part) => ('slot' in part ? `[${verb.roles[part.slot]!.name}]` : part.words.join(' ')))
      .join(' ');
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
  return (
    `${catalogue.world} accepts these phrases, in the order they are tried; the first that reads wins.\n\n` +
    blocks.join('\n')
  );
}

/** What fills one role, as the one who typed it reads it. */
function boundWords(bound: Bound | undefined, role: ResolvedRole, context: Reading): string {
  if (bound === undefined) return 'unbound';
  const thing = (id: InstanceId) =>
    `${objectWords(id, context.actor, context.render)} (${pathOf(context.world, id)})`;
  if ('object' in bound) return thing(bound.object);
  if ('set' in bound) return bound.set.length === 0 ? 'nothing' : bound.set.map(thing).join(', ');
  if ('exit' in bound) {
    const { direction, label, to } = bound.exit;
    const way = direction === null ? 'link' : `exit ${direction}`;
    return `${way} "${label}" -> ${pathOf(context.world, to)}`;
  }
  return role.filler?.fills === 'symbol' ? `:${String(bound.value)}` : String(bound.value);
}

/** What reading one line needs to put it in words. */
interface Reading {
  readonly world: InstanceId;
  readonly actor: InstanceId;
  readonly render: RenderContext;
}

function indented(paragraphs: readonly string[]): string {
  return paragraphs.map((one) => `  ${one}\n`).join('');
}

/** A line as the one who typed reads it; an absent passage says so. */
function spoken(line: Line, context: Reading): string {
  const paragraphs = renderFor(line, context.actor, context.render);
  return indented(paragraphs.length > 0 ? paragraphs : ['(it renders nothing)']);
}

/** What `line` makes, typed by the visitor `standing` holds, as a page. */
function readLine(line: string, standing: Standing, turn: PollTurn): string {
  const { state } = standing;
  const { actor } = standing;
  const nicknames = nicknamesIn(state);
  const render: RenderContext = { ...turn, nicknames, draws: null, actor };
  const context: Reading = { world: turn.state.world, actor, render };
  // A tie among things written alike is drawn as a turn seeded 0 draws it.
  const parsed = parseCommand(line, actor, { ...turn, draws: new Draws(0), nicknames });
  if ('answered' in parsed) {
    const { said } = parsed.answered;
    const name = 'passage' in said ? ` with \`${said.passage.name}\`` : '';
    const choices = parsed.choices.map(
      (choice: Choice) =>
        `  "${choice.line}" means ${objectWords(choice.id, actor, render)} (${pathOf(context.world, choice.id)})\n`,
    );
    return `not understood; the world answers${name}:\n${spoken(parsed.answered, context)}${choices.join('')}`;
  }
  const { reading } = parsed;
  const { verb } = reading;
  const roles = verb.roles.map(
    (role) => `  ${role.name}: ${boundWords(reading.bindings.get(role.name), role, context)}\n`,
  );
  const head = `reads as ${qualifiedName(verb.library, verb.name)}\n${roles.join('')}`;
  const refused = consentPass(reading, turn);
  if (refused === null) return `${head}every participant consents\n`;
  const by = `${objectWords(refused.by, actor, render)} (${pathOf(context.world, refused.by)})`;
  return `${head}refused by ${by} as ${refused.role}, in ${refused.origin}'s permit:\n${spoken(refused, context)}`;
}

/** What parsing a line gave: the page, and whether it could be read at all. */
export interface ParsedLine {
  readonly ok: boolean;
  readonly page: string;
}

/**
 * `line` as a visitor standing where `standing` has them would have it
 * read, charged to a command turn's steps: a line that costs more is said
 * to fault, as its turn would.
 */
export function parseLine(line: string, standing: Standing): ParsedLine {
  const { state, host, place } = standing;
  const where = `in ${pathOf(state.world, place)}, "${line}"`;
  const polled = pollTurn(state, host, (turn) => readLine(line, standing, turn), 'command');
  if (!polled.faulted) return { ok: true, page: `${where} ${polled.view}` };
  const { fault } = polled;
  return {
    ok: false,
    page: `${where} faults as its turn would, ${fault.name}: ${fault.detail}\n`,
  };
}
