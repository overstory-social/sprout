import {
  faultOf,
  SproutList,
  type Bound,
  type DrawnReading,
  type Following,
  type InstanceId,
  type IntentReading,
  type Parsed,
  type Reading,
  type Reread,
  type Said,
  type StoredBound,
  type Value,
} from '@overstory/sprout/lang';

// What the parser read, as a readings file keeps it beside each command turn (the spec's Parsing ›
// Matching a line, Choosing a reading; The runtime › Turns): what `host.parse` returned, the bounds it
// drew below and the steps it spent, and what a later turn of a line was handed instead of words. Every
// thing is by id and every name qualified, so a runtime that parses compares its own parse with this one
// field by field. Bindings are in the order the reading bound them, which a visitor's last reading keeps.

/** A chosen value as JSON: a boolean, a number, a string, or a list of them. */
export type ReadValue = boolean | number | string | readonly ReadValue[] | null;

/** What fills a role of a resolved reading: a `SeenFiller` by id alone, with a value role's chosen value. */
export type ReadFiller =
  | {
      readonly role: string;
      readonly binds: 'object';
      readonly id: InstanceId;
    }
  | {
      readonly role: string;
      readonly binds: 'set';
      readonly ids: readonly InstanceId[];
    }
  | {
      readonly role: string;
      readonly binds: 'exit';
      readonly direction: string | null;
      readonly label: string;
      readonly to: InstanceId;
    }
  | { readonly role: string; readonly binds: 'value'; readonly value: ReadValue }
  | { readonly role: string; readonly binds: 'unbound' };

/** A reading by its verb's qualified name, who performs it, and what fills each role it binds, in order. */
export interface ReadReading {
  readonly verb: string;
  readonly actor: InstanceId;
  readonly bindings: readonly ReadFiller[];
}

/** An intent's reading: the intent by its qualified name, who means it, and each slot it binds, in order. */
export interface ReadIntent {
  readonly intent: string;
  readonly actor: InstanceId;
  readonly bindings: readonly ReadFiller[];
}

/** An item of a run read afresh on its own turn (`Reread`), every id as it is. */
export interface ReadReread {
  readonly role: string;
  readonly words: string;
  readonly values: readonly { readonly role: string; readonly words: string }[];
  readonly referents: readonly InstanceId[];
}

/** A turn a line runs after the one that read it: a planned reading, with an item to re-read, or words of its own. */
export type ReadFollowing =
  { readonly planned: ReadReading; readonly reread?: ReadReread } | { readonly text: string };

/** What a later turn of a line is handed in place of reading its words: the reading planned, and the item to re-read. */
export interface Handed {
  readonly planned: ReadReading;
  readonly reread?: ReadReread;
}

/** A name a line of the engine's binds: a thing by id, or a value. */
export type ReadBinding =
  | { readonly name: string; readonly object: InstanceId }
  | { readonly name: string; readonly value: ReadValue };

/** What an answer says: a passage by name, words in quotes (the engine's own where nothing writes the line), a passage the world was loaded without, or a recording's transcript. */
export type ReadLine =
  | { readonly passage: string }
  | { readonly text: string }
  | { readonly absent: string }
  | { readonly recorded: string };

/** A thing the world's `pronoun_correction` names, and the pronoun the thing declares. */
export interface ReadCorrection {
  readonly thing: InstanceId;
  readonly pronoun: string | null;
}

/** A reading drawn from a tie: among how many, and the thing the engine's `meant` names, where it says one. */
export interface ReadDrawn {
  readonly among: number;
  readonly meant: InstanceId | null;
}

/** What reading a line spent: the bounds it drew below, in order, and the turn's steps. */
interface Spent {
  readonly draws: readonly number[];
  readonly steps: number;
}

/** What `host.parse` came to, and what it spent. */
export type ParseRecord =
  | ({
      readonly reading: ReadReading;
      readonly rest: readonly ReadFollowing[];
      readonly drawn: ReadDrawn | null;
      readonly corrected: readonly ReadCorrection[];
    } & Spent)
  | ({
      readonly intent: ReadIntent;
      readonly rest: readonly ReadFollowing[];
      readonly drawn: ReadDrawn | null;
      readonly corrected: readonly ReadCorrection[];
    } & Spent)
  | ({
      readonly answered: {
        readonly line: ReadLine;
        readonly by: InstanceId;
        readonly bindings: readonly ReadBinding[];
      };
    } & Spent)
  | ({ readonly faulted: { readonly name: string; readonly detail: string } } & Spent);

/** `value` as JSON. */
export function readValueOf(value: Value): ReadValue {
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value;
  }
  return value instanceof SproutList ? value.elements.map(readValueOf) : null;
}

/** What fills the role `role` of a reading, from what it binds; `unbound` where it binds nothing. */
export function fillerOf(role: string, bound: Bound | undefined): ReadFiller {
  if (bound === undefined) return { role, binds: 'unbound' };
  if ('object' in bound) return { role, binds: 'object', id: bound.object };
  if ('set' in bound) return { role, binds: 'set', ids: [...bound.set] };
  if ('exit' in bound) {
    const { direction, label, to } = bound.exit;
    return { role, binds: 'exit', direction, label, to };
  }
  return { role, binds: 'value', value: readValueOf(bound.value) };
}

/** What a stored or logged reading's role holds, as the reading's filler of `role`. */
function storedFillerOf(role: string, bound: StoredBound): ReadFiller {
  if ('object' in bound) return { role, binds: 'object', id: bound.object as InstanceId };
  if ('set' in bound) return { role, binds: 'set', ids: bound.set.map((id) => id as InstanceId) };
  if ('exit' in bound) {
    const { direction, label, to } = bound.exit;
    return { role, binds: 'exit', direction, label, to: to as InstanceId };
  }
  return { role, binds: 'value', value: bound.value };
}

/**
 * A reading as a store or the log keeps it, `actor`'s: its verb by library
 * and name, and what fills each role it binds, in the order it bound them.
 */
export function keptReadingOf(
  kept: {
    readonly verb: { readonly library: string; readonly name: string };
    readonly bindings: readonly (readonly [string, StoredBound])[];
  },
  actor: InstanceId,
): ReadReading {
  return {
    verb: `${kept.verb.library}.${kept.verb.name}`,
    actor,
    bindings: kept.bindings.map(([role, bound]) => storedFillerOf(role, bound)),
  };
}

/** `reading` with every role it binds, in the order it bound them. */
export function readReadingOf(reading: Reading): ReadReading {
  return {
    verb: `${reading.verb.library}.${reading.verb.name}`,
    actor: reading.actor,
    bindings: [...reading.bindings].map(([role, bound]) => fillerOf(role, bound)),
  };
}

function readIntentOf(reading: IntentReading): ReadIntent {
  return {
    intent: `${reading.intent.library}.${reading.intent.name}`,
    actor: reading.actor,
    bindings: [...reading.bindings].map(([role, bound]) => fillerOf(role, bound)),
  };
}

function rereadOf(reread: Reread): ReadReread {
  return {
    role: reread.role,
    words: reread.words,
    values: reread.values.map(({ role, words }) => ({ role, words })),
    referents: [...reread.referents],
  };
}

function followingOf(following: Following): ReadFollowing {
  if ('text' in following) return { text: following.text };
  const planned = readReadingOf(following.planned);
  return following.reread === undefined
    ? { planned }
    : { planned, reread: rereadOf(following.reread) };
}

/** What a later turn of a line was handed: the reading planned for it, and the item it re-reads. */
export function handedOf(planned: Reading, reread: Reread | undefined): Handed {
  const read = readReadingOf(planned);
  return reread === undefined ? { planned: read } : { planned: read, reread: rereadOf(reread) };
}

/** The thing a line of the engine's names as `thing`, and the pronoun it binds. */
function thingOf(said: Said): ReadCorrection | null {
  const thing = said.bindings.get('thing');
  if (thing === undefined || thing.binds !== 'object') return null;
  const pronoun = said.bindings.get('pronoun');
  return {
    thing: thing.id,
    pronoun: pronoun?.binds === 'value' && typeof pronoun.value === 'string' ? pronoun.value : null,
  };
}

function drawnOf(drawn: DrawnReading | null): ReadDrawn | null {
  if (drawn === null) return null;
  return {
    among: drawn.among,
    meant: drawn.meant === null ? null : (thingOf(drawn.meant)?.thing ?? null),
  };
}

function lineOf(said: Said): ReadLine {
  const { said: speech } = said;
  if ('passage' in speech) return { passage: speech.passage.name };
  if ('text' in speech) return { text: speech.text };
  if ('absent' in speech) return { absent: speech.absent };
  return { recorded: speech.recorded.transcript };
}

function bindingsOf(said: Said): ReadBinding[] {
  return [...said.bindings].flatMap(([name, bound]): ReadBinding[] => {
    if (bound.binds === 'object') return [{ name, object: bound.id }];
    if (bound.binds === 'value') return [{ name, value: readValueOf(bound.value) }];
    return [];
  });
}

/** What `parsed` came to, having drawn below `draws` and spent `steps`. */
export function parseRecordOf(
  parsed: Parsed,
  draws: readonly number[],
  steps: number,
): ParseRecord {
  const spent = { draws: [...draws], steps };
  if ('answered' in parsed) {
    const { answered } = parsed;
    return {
      answered: { line: lineOf(answered), by: answered.by, bindings: bindingsOf(answered) },
      ...spent,
    };
  }
  const read = {
    rest: parsed.rest.map(followingOf),
    drawn: drawnOf(parsed.drawn),
    corrected: parsed.corrected.flatMap((said) => thingOf(said) ?? []),
  };
  return 'reading' in parsed
    ? { reading: readReadingOf(parsed.reading), ...read, ...spent }
    : { intent: readIntentOf(parsed.intended), ...read, ...spent };
}

/** A parse that faulted, as `thrown` names the fault, having drawn below `draws` and spent `steps`. */
export function faultedParseOf(
  thrown: unknown,
  draws: readonly number[],
  steps: number,
): ParseRecord {
  const { name, detail } = faultOf(thrown);
  return { faulted: { name, detail }, draws: [...draws], steps };
}
