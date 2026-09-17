import { SPROUT_RESERVED_MESSAGES, type SproutMessage } from './sprout.js';
import { humanise, identOf } from './sprout-lang.js';

import {
  isContainer,
  openOf,
  visibleItems,
  type SproutObject,
  type SproutWorld,
} from './engine.js';

// The command parser (#342; sprout.md §5): typing to play. Inform's
// lineage, written here, grammar from Sprout — a builder who wants
// "sing to the robin" writes `grammar "sing to [self]"` on the robin
// and it works, in every client, deterministically, inside the room's
// transaction, with no model in the loop and nothing leaving the
// server. No LLM (§5.2, decided).
//
// The shape: a DICTIONARY of what can be named right now (every visible
// object's `:names`, its display name, its kind's name; a symbol-valued
// property's value is an adjective — "the wet cup"; the exits' labels;
// the people present), a GRAMMAR TABLE (every reachable message's
// grammar lines with `[self]` bound and `[arg]` slots, plus the
// built-ins), and a MATCH that aligns the typed words with each line,
// filling slots from the dictionary longest-noun-first. Ties on WHICH
// object ask "Which do you mean, the brass key or the iron key?" —
// unless the candidates are one kind in one state, when any will do
// and the first is taken without a question (§2.8). Ties on which verb
// prefer the object's own message over a built-in. A miss says how far
// it got, in Inform's words, because that tells the player which part
// landed.

export interface Exit {
  label: string;
  toRoomId: string;
}

export interface Person {
  handle: string;
  id: string;
}

export interface ParseContext {
  world: SproutWorld;
  /** The exits the actor may take from here. */
  exits: readonly Exit[];
  /** The people present, for `give … to`. */
  people: readonly Person[];
  /** The object the actor last referred to, for `it` / `them`. */
  lastNoun?: string | null;
}

export type Command =
  | { kind: 'verb'; targetId: string; message: string; args: Record<string, string> }
  | { kind: 'take'; itemIds: string[] }
  | { kind: 'drop'; itemIds: string[] }
  | { kind: 'put'; itemId: string; intoId: string }
  | { kind: 'give'; itemId: string; toProfileId: string }
  | { kind: 'go'; toRoomId: string }
  | { kind: 'look' }
  | { kind: 'examine'; id: string }
  | { kind: 'inventory' }
  | { kind: 'wait' }
  | { kind: 'help' };

export type ParseResult =
  | { ok: true; command: Command; noun: string | null }
  | {
      ok: false;
      /** What the actor reads. */
      reply: string;
      /** A miss the builder might learn from (a question is not one). */
      missed: boolean;
    };

// --- words ---------------------------------------------------------------------------

const FILLER = new Set(['the', 'a', 'an', 'some', 'please', 'my', 'your', 'this', 'that']);
const PRONOUNS = new Set(['it', 'them', 'this', 'that', 'him', 'her']);
const ALL = new Set(['all', 'everything']);

/** The command's words (named so beside sprout-lang's `tokenize`, the language's lexer). */
export function tokenizeCommand(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w !== '' && !FILLER.has(w));
}

function phraseOf(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w !== '' && !FILLER.has(w));
}

// --- the dictionary ----------------------------------------------------------------------

type SlotKind = 'object' | 'held' | 'container' | 'exit' | 'person';

interface Entry {
  id: string;
  slot: Exclude<SlotKind, 'held' | 'container'>;
  /** Every way to name it, longest first among equals; `primary` is what completion offers. */
  phrases: string[][];
  primary: string[][];
  adjectives: Set<string>;
  /** For "which do you mean": what tells this one from another of the same name. */
  distinct: string[];
  /** For the same-kind rule: the definition's name and the state, as a key. */
  sameness: string;
  object?: SproutObject;
}

function adjectivesOf(obj: SproutObject): string[] {
  const out: string[] = [];
  for (const p of obj.definition.properties) {
    if (p.type === 'enum') {
      const value = obj.state[p.name];
      if (typeof value === 'string') out.push(...phraseOf(value));
    }
  }
  for (const k of obj.kinds) out.push(...phraseOf(humanise(identOf(k))));
  return out;
}

function objectEntry(obj: SproutObject): Entry {
  const phrases: string[][] = [];
  const seen = new Set<string>();
  const add = (p: string[]) => {
    const key = p.join(' ');
    if (p.length > 0 && !seen.has(key)) {
      seen.add(key);
      phrases.push(p);
    }
  };
  for (const n of obj.definition.names) add(phraseOf(n));
  const primary = phrases.length > 0 ? [...phrases] : [phraseOf(obj.definition.name)];
  add(phraseOf(obj.definition.name));
  add(identOf(obj.definition.name).split('_'));
  for (const k of obj.kinds) add(phraseOf(humanise(identOf(k))));
  // Any one word of the name will do — "lantern" for the brass lantern — as Inform allows.
  for (const w of phraseOf(obj.definition.name)) if (w.length > 2) add([w]);
  const enums = obj.definition.properties
    .filter((p) => p.type === 'enum')
    .map((p) => `${p.name}=${String(obj.state[p.name])}`);
  return {
    id: obj.id,
    slot: 'object',
    phrases,
    primary,
    adjectives: new Set(adjectivesOf(obj)),
    distinct: obj.definition.properties
      .filter((p) => p.type === 'enum' && typeof obj.state[p.name] === 'string')
      .map((p) => String(obj.state[p.name])),
    sameness: `${obj.definition.name}|${enums.join(',')}|${JSON.stringify(obj.state)}`,
    object: obj,
  };
}

/** What can be named right now: what the room shows, what the hands hold, the exits, the people. */
export function dictionary(ctx: ParseContext): Entry[] {
  const { world } = ctx;
  const entries: Entry[] = [];
  for (const obj of [...visibleItems(world, world.room), ...visibleItems(world, world.actor)]) {
    entries.push(objectEntry(obj));
  }
  for (const exit of ctx.exits) {
    const words = phraseOf(exit.label);
    const phrases = [words];
    // "go through the screen door" and "go door" both work: the whole label, and each of its content words.
    for (const w of words.filter(
      (w) => w.length > 3 && !['through', 'into', 'down', 'up'].includes(w),
    )) {
      phrases.push([w]);
    }
    for (const w of ['up', 'down', 'north', 'south', 'east', 'west', 'in', 'out']) {
      if (words.includes(w)) phrases.push([w]);
    }
    entries.push({
      id: exit.toRoomId,
      slot: 'exit',
      phrases,
      primary: [words],
      adjectives: new Set(),
      distinct: [],
      sameness: exit.toRoomId,
    });
  }
  for (const person of ctx.people) {
    entries.push({
      id: person.id,
      slot: 'person',
      phrases: [phraseOf(person.handle), ['@' + person.handle.toLowerCase()]],
      primary: [phraseOf(person.handle)],
      adjectives: new Set(),
      distinct: [],
      sameness: person.id,
    });
  }
  return entries;
}

// --- the grammar table -----------------------------------------------------------------

type Token = { lit: string; filler?: boolean } | { slot: string; kind: SlotKind };

interface Line {
  tokens: Token[];
  /** The message on an object, or a built-in. */
  action:
    | { kind: 'message'; ownerId: string; message: SproutMessage }
    | { kind: 'builtin'; name: Command['kind'] };
  /** True when `[self]` appears; otherwise the owner is implied. */
  namesSelf: boolean;
}

export function grammarTokens(line: string, args: readonly string[]): Token[] {
  const out: Token[] = [];
  for (const part of line.toLowerCase().split(/(\[[a-z][a-z0-9_]*\])/)) {
    const slot = /^\[([a-z][a-z0-9_]*)\]$/.exec(part);
    if (slot) {
      const name = slot[1]!;
      if (name === 'self' || args.includes(name)) out.push({ slot: name, kind: 'object' });
      continue;
    }
    for (const w of part.replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/)) {
      if (w === '') continue;
      out.push(FILLER.has(w) ? { lit: w, filler: true } : { lit: w });
    }
  }
  return out;
}

const BUILTINS: { lines: string[]; name: Command['kind']; slots?: Record<string, SlotKind> }[] = [
  { lines: ['look', 'l', 'look around'], name: 'look' },
  { lines: ['examine [x]', 'x [x]', 'look at [x]', 'inspect [x]', 'read [x]'], name: 'examine' },
  { lines: ['inventory', 'i', 'inv'], name: 'inventory' },
  { lines: ['take [x]', 'get [x]', 'pick up [x]', 'pick [x] up', 'grab [x]'], name: 'take' },
  { lines: ['drop [x]', 'put down [x]', 'put [x] down'], name: 'drop', slots: { x: 'held' } },
  {
    lines: ['put [x] in [y]', 'put [x] into [y]', 'place [x] in [y]', 'put [x] on [y]'],
    name: 'put',
    slots: { x: 'object', y: 'container' },
  },
  {
    lines: ['give [x] to [y]', 'hand [x] to [y]', 'offer [x] to [y]'],
    name: 'give',
    slots: { x: 'held', y: 'person' },
  },
  {
    lines: ['go [x]', 'go through [x]', 'walk [x]', 'leave [x]', '[x]'],
    name: 'go',
    slots: { x: 'exit' },
  },
  { lines: ['wait', 'z'], name: 'wait' },
  { lines: ['help', '?', 'what can i do', 'what can i say'], name: 'help' },
];

/** A message a player can reach by typing (has a body, not the engine's). */
function reachable(m: SproutMessage): boolean {
  return !m.abstract && !SPROUT_RESERVED_MESSAGES.has(m.name);
}

/** The grammar lines of one message, the builder's or the default (§2.7). */
export function grammarLines(m: SproutMessage): string[] {
  if (m.grammar.length > 0) return m.grammar;
  const name = humanise(m.name).toLowerCase();
  return [`${name} [self]`, ...m.args.map((a) => `${name} [self] with [${a.name}]`)];
}

export function grammarTable(ctx: ParseContext): Line[] {
  const { world } = ctx;
  const lines: Line[] = [];
  for (const owner of [
    world.room,
    ...visibleItems(world, world.room),
    ...visibleItems(world, world.actor),
  ]) {
    for (const message of owner.definition.messages) {
      if (!reachable(message)) continue;
      const args = message.args.map((a) => a.name);
      for (const line of grammarLines(message)) {
        const tokens = grammarTokens(line, args);
        const namesSelf = tokens.some((t) => 'slot' in t && t.slot === 'self');
        lines.push({ tokens, action: { kind: 'message', ownerId: owner.id, message }, namesSelf });
        // A line that leaves the object implied ("kick the wheel", a v0 label)
        // may still be said with it: "kick the wheel lantern" is odd, but
        // "light" as a v0 verb on the lantern is "light the lantern" to a player.
        if (!namesSelf && owner.kind !== 'room') {
          lines.push({
            tokens: [...tokens, { slot: 'self', kind: 'object' }],
            action: { kind: 'message', ownerId: owner.id, message },
            namesSelf: true,
          });
        }
      }
    }
  }
  for (const b of BUILTINS) {
    for (const line of b.lines) {
      const tokens = grammarTokens(line, ['x', 'y']).map((t) =>
        'slot' in t ? { slot: t.slot, kind: b.slots?.[t.slot] ?? 'object' } : t,
      );
      lines.push({ tokens, action: { kind: 'builtin', name: b.name }, namesSelf: false });
    }
  }
  return lines;
}

// --- matching -----------------------------------------------------------------------------

interface Fill {
  slot: string;
  kind: SlotKind;
  candidates: Entry[];
  /** The words the actor used for it. */
  words: string[];
}

interface Match {
  line: Line;
  fills: Fill[];
  literals: number;
}

function fits(entry: Entry, kind: SlotKind, ctx: ParseContext): boolean {
  switch (kind) {
    case 'object':
      return entry.slot === 'object';
    case 'held':
      return entry.slot === 'object' && entry.object?.container === ctx.world.actor.id;
    case 'container':
      return (
        entry.slot === 'object' &&
        !!entry.object &&
        isContainer(entry.object) &&
        openOf(entry.object)
      );
    case 'exit':
      return entry.slot === 'exit';
    case 'person':
      return entry.slot === 'person';
  }
}

/** The entries a span of words names: adjectives first, then a phrase — the longest phrase wins. */
function nameSpan(
  words: string[],
  entries: readonly Entry[],
  kind: SlotKind,
  ctx: ParseContext,
): Entry[] {
  const out: Entry[] = [];
  for (const entry of entries) {
    if (!fits(entry, kind, ctx)) continue;
    for (const phrase of entry.phrases) {
      if (phrase.length > words.length) continue;
      const tail = words.slice(words.length - phrase.length);
      if (tail.join(' ') !== phrase.join(' ')) continue;
      const head = words.slice(0, words.length - phrase.length);
      if (head.every((w) => entry.adjectives.has(w))) {
        out.push(entry);
        break;
      }
    }
  }
  return out;
}

function align(
  tokens: readonly string[],
  pattern: readonly Token[],
  entries: readonly Entry[],
  ctx: ParseContext,
): Match['fills'] | null {
  const go = (ti: number, pi: number, fills: Fill[]): Fill[] | null => {
    if (pi === pattern.length) return ti === tokens.length ? fills : null;
    const p = pattern[pi]!;
    if ('lit' in p) {
      if (p.filler) return go(ti, pi + 1, fills); // "the", "your": said or not, as the player likes
      return tokens[ti] === p.lit ? go(ti + 1, pi + 1, fills) : null;
    }
    // A slot: try the longest span first, so "flint and steel" beats "flint".
    for (let len = Math.min(5, tokens.length - ti); len >= 1; len--) {
      const words = tokens.slice(ti, ti + len);
      let candidates: Entry[];
      if (len === 1 && PRONOUNS.has(words[0]!) && ctx.lastNoun) {
        candidates = entries.filter((e) => e.id === ctx.lastNoun && fits(e, p.kind, ctx));
      } else if (len === 1 && ALL.has(words[0]!) && (p.kind === 'object' || p.kind === 'held')) {
        candidates = entries.filter(
          (e) =>
            fits(e, p.kind, ctx) &&
            (p.kind === 'held' || e.object?.container !== ctx.world.actor.id),
        );
        if (candidates.length === 0) continue;
        const rest = go(ti + len, pi + 1, [
          ...fills,
          { slot: p.slot, kind: p.kind, candidates, words: ['all'] },
        ]);
        if (rest) return rest;
        continue;
      } else {
        candidates = nameSpan(words, entries, p.kind, ctx);
      }
      if (candidates.length === 0) continue;
      const rest = go(ti + len, pi + 1, [
        ...fills,
        { slot: p.slot, kind: p.kind, candidates, words },
      ]);
      if (rest) return rest;
    }
    return null;
  };
  return go(0, 0, []);
}

function describeChoice(entries: readonly Entry[]): string {
  const names = entries.map((e) => {
    const base = e.phrases[0]!.join(' ');
    const adjectives = e.distinct.filter((d) => !base.includes(d));
    return adjectives.length > 0 ? `the ${adjectives.join(' ')} ${base}` : `the ${base}`;
  });
  if (names.length <= 2) return names.join(' or ');
  return `${names.slice(0, -1).join(', ')}, or ${names.at(-1)}`;
}

/** One of several: the same kind in the same state → the first; else a question. */
function choose(fill: Fill): { id: string } | { ask: string } {
  if (fill.candidates.length === 1) return { id: fill.candidates[0]!.id };
  const sorted = [...fill.candidates].sort((a, b) => (a.id < b.id ? -1 : 1));
  const first = sorted[0]!;
  if (sorted.every((c) => c.sameness === first.sameness)) return { id: first.id };
  return { ask: `Which do you mean, ${describeChoice(sorted)}?` };
}

/**
 * The typed line → a command, a question, or a miss. Deterministic:
 * the same words in the same room give the same answer.
 */
export function parseCommand(ctx: ParseContext, text: string): ParseResult {
  // "?" is help, before the tokeniser drops it as punctuation.
  const tokens = text.trim() === '?' ? ['help'] : tokenizeCommand(text);
  if (tokens.length === 0)
    return { ok: false, reply: 'Say something, and I will try.', missed: false };
  const entries = dictionary(ctx);
  const table = grammarTable(ctx);
  const matches: Match[] = [];
  for (const line of table) {
    const fills = align(tokens, line.tokens, entries, ctx);
    if (!fills) continue;
    matches.push({ line, fills, literals: line.tokens.filter((t) => 'lit' in t).length });
  }
  if (matches.length === 0) return miss(tokens, table, entries);
  // Prefer the object's own message over a built-in; then the most literal words; then order.
  matches.sort((a, b) => {
    const own = Number(b.line.action.kind === 'message') - Number(a.line.action.kind === 'message');
    return own !== 0 ? own : b.literals - a.literals;
  });
  const best = matches[0]!;
  const noun = (fills: Fill[]): string | null => {
    const objectFill = fills.find((f) => f.kind === 'object' || f.kind === 'held');
    return objectFill && objectFill.candidates.length >= 1 ? objectFill.candidates[0]!.id : null;
  };
  if (best.line.action.kind === 'message') {
    // Several objects answering one phrase: "which do you mean" among their owners.
    const owners = matches
      .filter((m) => m.line.action.kind === 'message' && m.literals === best.literals)
      .map((m) => (m.line.action as { ownerId: string }).ownerId);
    const distinctOwners = [...new Set(owners)];
    let ownerId = best.line.action.ownerId;
    const selfFill = best.fills.find((f) => f.slot === 'self');
    if (selfFill) {
      const chosen = choose(selfFill);
      if ('ask' in chosen) return { ok: false, reply: chosen.ask, missed: false };
      ownerId = chosen.id;
      if (ownerId !== best.line.action.ownerId) {
        // the words named another object with the same grammar: use its line
        const other = matches.find(
          (m) => m.line.action.kind === 'message' && m.line.action.ownerId === ownerId,
        );
        if (other) return finishMessage(other, ownerId, noun);
      }
    } else if (distinctOwners.length > 1) {
      const ownerEntries = entries.filter((e) => distinctOwners.includes(e.id));
      const chosen = choose({ slot: 'self', kind: 'object', candidates: ownerEntries, words: [] });
      if ('ask' in chosen) return { ok: false, reply: chosen.ask, missed: false };
      ownerId = chosen.id;
      const other = matches.find(
        (m) => m.line.action.kind === 'message' && m.line.action.ownerId === ownerId,
      );
      if (other) return finishMessage(other, ownerId, noun);
    }
    return finishMessage(best, ownerId, noun);
  }
  return finishBuiltin(best, noun);
}

function finishMessage(
  match: Match,
  ownerId: string,
  noun: (fills: Fill[]) => string | null,
): ParseResult {
  const action = match.line.action as { kind: 'message'; ownerId: string; message: SproutMessage };
  const args: Record<string, string> = {};
  for (const fill of match.fills) {
    if (fill.slot === 'self') continue;
    const chosen = choose(fill);
    if ('ask' in chosen) return { ok: false, reply: chosen.ask, missed: false };
    args[fill.slot] = chosen.id;
  }
  return {
    ok: true,
    command: { kind: 'verb', targetId: ownerId, message: action.message.name, args },
    noun: noun(match.fills) ?? ownerId,
  };
}

function finishBuiltin(match: Match, noun: (fills: Fill[]) => string | null): ParseResult {
  const name = (match.line.action as { kind: 'builtin'; name: Command['kind'] }).name;
  const one = (slot: string): { id: string } | { ask: string } | null => {
    const fill = match.fills.find((f) => f.slot === slot);
    return fill ? choose(fill) : null;
  };
  const many = (slot: string): string[] => {
    const fill = match.fills.find((f) => f.slot === slot);
    if (!fill) return [];
    if (fill.words[0] === 'all') return fill.candidates.map((c) => c.id).sort();
    const chosen = choose(fill);
    return 'id' in chosen ? [chosen.id] : [];
  };
  const asked = match.fills.map((f) => choose(f)).find((c) => 'ask' in c);
  if (asked && 'ask' in asked && !match.fills.some((f) => f.words[0] === 'all')) {
    return { ok: false, reply: asked.ask, missed: false };
  }
  const n = noun(match.fills);
  switch (name) {
    case 'look':
    case 'inventory':
    case 'wait':
    case 'help':
      return { ok: true, command: { kind: name }, noun: null };
    case 'examine': {
      const x = one('x');
      return x && 'id' in x
        ? { ok: true, command: { kind: 'examine', id: x.id }, noun: x.id }
        : { ok: false, reply: "You can't see any such thing.", missed: true };
    }
    case 'take':
      return { ok: true, command: { kind: 'take', itemIds: many('x') }, noun: n };
    case 'drop':
      return { ok: true, command: { kind: 'drop', itemIds: many('x') }, noun: n };
    case 'put': {
      const x = one('x');
      const y = one('y');
      if (!x || !y || 'ask' in x || 'ask' in y)
        return { ok: false, reply: "You can't see any such thing.", missed: true };
      return { ok: true, command: { kind: 'put', itemId: x.id, intoId: y.id }, noun: x.id };
    }
    case 'give': {
      const x = one('x');
      const y = one('y');
      if (!x || !y || 'ask' in x || 'ask' in y)
        return { ok: false, reply: "You can't see any such thing.", missed: true };
      return { ok: true, command: { kind: 'give', itemId: x.id, toProfileId: y.id }, noun: x.id };
    }
    case 'go': {
      const x = one('x');
      return x && 'id' in x
        ? { ok: true, command: { kind: 'go', toRoomId: x.id }, noun: null }
        : { ok: false, reply: "You can't go that way.", missed: true };
    }
    default:
      return { ok: false, reply: "I don't know how to do that here.", missed: true };
  }
}

/** How far it got, in Inform's words: which part landed tells the player what to change. */
function miss(tokens: string[], table: Line[], entries: Entry[]): ParseResult {
  const first = tokens[0]!;
  const verbLines = table.filter(
    (l) => l.tokens[0] && 'lit' in l.tokens[0] && l.tokens[0].lit === first,
  );
  if (verbLines.length > 0) {
    // The verb landed; the rest of the sentence did not.
    if (verbLines.every((l) => l.action.kind === 'builtin' && l.action.name === 'go')) {
      return { ok: false, reply: "You can't go that way.", missed: true };
    }
    if (tokens.length > 1) {
      return { ok: false, reply: "You can't see any such thing.", missed: true };
    }
    // "…wanting to light something." when a line takes an object; else the line as written.
    const takesObject = verbLines.some((l) => l.tokens.some((t) => 'slot' in t));
    const label = takesObject
      ? `${first} something`
      : verbLines[0]!.tokens.map((t) => ('lit' in t ? t.lit : 'something')).join(' ');
    return {
      ok: false,
      reply: `I only understood you as far as wanting to ${label}.`,
      missed: true,
    };
  }
  const known = entries.some(
    (e) => e.phrases.some((p) => p.includes(first)) || e.adjectives.has(first),
  );
  if (known) {
    return {
      ok: false,
      reply: `I see the ${first}, but not what to do with it. Try a verb first.`,
      missed: true,
    };
  }
  return { ok: false, reply: `I don't know the word "${first}" here.`, missed: true };
}

// --- completion --------------------------------------------------------------------------

/**
 * What the actor could type that begins with `prefix` (§5.2: the same
 * grammar, so nothing is offered that the parser would refuse). Slots
 * are expanded with the names of what is here; at most `limit` lines,
 * shortest first.
 */
export function complete(ctx: ParseContext, prefix: string, limit = 12): string[] {
  const entries = dictionary(ctx);
  const want = tokenizeCommand(prefix).join(' ');
  const out = new Set<string>();
  const expand = (tokens: readonly Token[], i: number, words: string[]): void => {
    if (out.size >= limit * 4) return;
    if (i === tokens.length) {
      const line = words.join(' ');
      if (line.startsWith(want) && line !== '') out.add(line);
      return;
    }
    const t = tokens[i]!;
    if ('lit' in t) {
      const next = [...words, t.lit];
      if (!want.startsWith(next.join(' ').slice(0, want.length))) return;
      expand(tokens, i + 1, next);
      return;
    }
    for (const entry of entries) {
      if (!fits(entry, t.kind, ctx)) continue;
      for (const phrase of entry.primary) {
        const next = [...words, ...phrase];
        const partial = next.join(' ');
        if (!partial.startsWith(want.slice(0, partial.length))) continue;
        expand(tokens, i + 1, next);
      }
    }
  };
  for (const line of grammarTable(ctx)) {
    // A message's own grammar with [self] bound: the owner's first name.
    const owner = line.action.kind === 'message' ? line.action.ownerId : null;
    const tokens = line.tokens.map((t) =>
      'slot' in t && t.slot === 'self' && owner
        ? ({ lit: entries.find((e) => e.id === owner)?.phrases[0]?.join(' ') ?? '' } as Token)
        : t,
    );
    expand(tokens, 0, []);
  }
  return [...out].sort((a, b) => a.length - b.length || a.localeCompare(b)).slice(0, limit);
}

/** What the room offers, for `help` and the easy mode: every grammar line, slots as ellipses. */
export function whatYouCanSay(ctx: ParseContext): string[] {
  const out = new Set<string>();
  for (const line of grammarTable(ctx)) {
    if (line.action.kind !== 'message') continue;
    const ownerId = line.action.ownerId;
    const owner = ctx.world.items.find((o) => o.id === ownerId) ?? ctx.world.room;
    const words = line.tokens
      .map((t) =>
        'lit' in t ? t.lit : t.slot === 'self' ? owner.definition.name.toLowerCase() : '…',
      )
      .join(' ');
    out.add(words);
  }
  return [...out];
}
