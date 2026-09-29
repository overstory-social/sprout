import {
  consentPass,
  Draws,
  kindName,
  nicknamesIn,
  objectWords,
  parseCommand,
  partsOf,
  planIntent,
  pollTurn,
  qualifiedName,
  renderFor,
  type Bound,
  type Catalogue,
  type InstanceId,
  type IntentReading,
  type Line,
  type PollTurn,
  type Reading as LangReading,
  type RenderContext,
  type ResolvedRole,
  type ResolvedVerb,
} from '@overstory/sprout/lang';

import { pathOf, type Standing } from '@overstory/sprout-player';

// `sprout parse`: what a world accepts. With no line, every phrase a
// visitor may type, those its synonyms give among them (the spec's Verbs
// › Slots; Parsing; the working notes' "Not language questions, but
// blocking"). With a line, what a visitor standing somewhere would make
// of it: the reading chosen, each role and what fills it, the draw where
// it tied with others, and its consent pass's answer, or the world's
// answer where it is not understood. The line is read exactly as a command turn reads it,
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
  // A tie among readings is drawn as a turn seeded 0 draws it.
  const referents = state.visitors.get(standing.visit)!.referents;
  const parsed = parseCommand(line, actor, {
    ...turn,
    draws: new Draws(0),
    nicknames,
    referents,
  });
  if ('answered' in parsed) {
    const { said } = parsed.answered;
    const name = 'passage' in said ? ` with \`${said.passage.name}\`` : '';
    return `not understood; the world answers${name}:\n${spoken(parsed.answered, context)}`;
  }
  const { drawn } = parsed;
  const tie =
    drawn === null
      ? ''
      : `drawn from ${drawn.among} readings that tied, as a turn seeded 0 draws it${
          drawn.meant === null
            ? '\n'
            : `; the visitor is told first:\n${spoken(drawn.meant, context)}`
        }`;
  if ('intended' in parsed) return intentRead(parsed.intended, tie, turn, context);
  const { reading } = parsed;
  const head = `${readingWords(reading, context)}${tie}`;
  const refused = consentPass(reading, turn);
  if (refused === null) return `${head}every participant consents\n`;
  const by = `${objectWords(refused.by, actor, render)} (${pathOf(context.world, refused.by)})`;
  return `${head}refused by ${by} as ${refused.role}, in ${refused.origin}'s permit:\n${spoken(refused, context)}`;
}

/** A reading as the page writes it: its verb, then each role and what fills it. */
function readingWords(reading: LangReading, context: Reading): string {
  const { verb } = reading;
  const roles = verb.roles.map(
    (role) => `  ${role.name}: ${boundWords(reading.bindings.get(role.name), role, context)}\n`,
  );
  return `reads as ${qualifiedName(verb.library, verb.name)}\n${roles.join('')}`;
}

/** A line read as an intent: the intent, what fills each slot, and the steps it plans now, each as its own reading. */
function intentRead(
  intended: IntentReading,
  tie: string,
  turn: PollTurn,
  context: Reading,
): string {
  const { intent } = intended;
  const slots = intent.slots.map((slot) => {
    const bound = intended.bindings.get(slot);
    const words =
      bound !== undefined && 'object' in bound
        ? `${objectWords(bound.object, context.actor, context.render)} (${pathOf(context.world, bound.object)})`
        : 'unbound';
    return `  ${slot}: ${words}\n`;
  });
  const steps = planIntent(intended, turn);
  const planned =
    steps.length === 0
      ? 'it plans no step that can run, and is answered with `nothing_happens`\n'
      : `it runs ${steps.length === 1 ? 'one step' : `${steps.length} steps`}, each a turn of its own:\n${steps
          .map((step) => readingWords(step, context).replace(/^(?=.)/gm, '  '))
          .join('')}`;
  return `reads as the intent ${qualifiedName(intent.library, intent.name)}\n${slots.join('')}${tie}${planned}`;
}

/** What parsing a line gave: the page, and whether it could be read at all. */
export interface ParsedLine {
  readonly ok: boolean;
  readonly page: string;
}

/**
 * `line` as a visitor standing where `standing` has them would have it
 * read, each command it holds in turn, each charged to a command turn's
 * steps: one that costs more is said to fault, as its turn would.
 */
export function parseLine(line: string, standing: Standing): ParsedLine {
  const parts = partsOf(line);
  if (parts.length > 1) {
    const read = parts.map((part) => parsedCommand(part, standing));
    return {
      ok: read.every((one) => one.ok),
      page:
        `"${line}" holds ${parts.length} commands, each its own turn; each is read here against the world as it stands now, since nothing runs:\n\n` +
        read.map((one) => one.page).join('\n'),
    };
  }
  return parsedCommand(line, standing);
}

/** One command, read against the world as it stands. */
function parsedCommand(line: string, standing: Standing): ParsedLine {
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
