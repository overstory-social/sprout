import { SPROUT_RESERVED_MESSAGES, type SproutMessage } from './sprout.js';
import { humanise } from './sprout-lang.js';

// The grammar table is a LANGUAGE fact (the split proposal §3.1): which
// lines reach a message — the builder's `grammar` lines, or the default
// a message with none gets — and the built-in verbs a player may always
// type. Both are tokenised here, once, so the program (§3.3) carries the
// complete table and a matcher (core's, today `parser.ts`) keeps only
// what is a runtime question: the dictionary from live state, scoring,
// disambiguation, pronouns, completion. The skill teaches the same
// defaults and the same built-ins; `grammar.spec.ts` pins them together.

/** The words a player may leave out (“take the lamp”, “take lamp”). */
export const GRAMMAR_FILLER: ReadonlySet<string> = new Set([
  'the',
  'a',
  'an',
  'some',
  'please',
  'my',
  'your',
  'this',
  'that',
]);

/** What a slot may be filled with: any object in reach, one in the hands, an open container, an exit, a person present. */
export type SlotKind = 'object' | 'held' | 'container' | 'exit' | 'person';

/** One token of a tokenised grammar line: a literal word (filler may be omitted) or a slot. */
export type GrammarToken = { lit: string; filler?: boolean } | { slot: string; kind: SlotKind };

/** A message's line, tokenised: `[self]` and each declared argument become object slots; an unknown slot is dropped. */
export function grammarTokens(line: string, args: readonly string[]): GrammarToken[] {
  const out: GrammarToken[] = [];
  for (const part of line.toLowerCase().split(/(\[[a-z][a-z0-9_]*\])/)) {
    const slot = /^\[([a-z][a-z0-9_]*)\]$/.exec(part);
    if (slot) {
      const name = slot[1]!;
      if (name === 'self' || args.includes(name)) out.push({ slot: name, kind: 'object' });
      continue;
    }
    for (const w of part.replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/)) {
      if (w === '') continue;
      out.push(GRAMMAR_FILLER.has(w) ? { lit: w, filler: true } : { lit: w });
    }
  }
  return out;
}

/** The grammar lines of one message: the builder's, or the default (sprout.md §2.7) — `"<name> [self]"` and one line per argument. */
export function grammarLines(m: SproutMessage): string[] {
  if (m.grammar.length > 0) return m.grammar;
  const name = humanise(m.name).toLowerCase();
  return [`${name} [self]`, ...m.args.map((a) => `${name} [self] with [${a.name}]`)];
}

/** A message a player can reach by typing: it has a body, and it is not one the engine sends. */
export function reachableMessage(m: SproutMessage): boolean {
  return !m.abstract && !SPROUT_RESERVED_MESSAGES.has(m.name);
}

/** One reachable message's complete tokenised table: every line, authored or defaulted. */
export function messageGrammar(m: SproutMessage): GrammarToken[][] {
  const args = m.args.map((a) => a.name);
  return grammarLines(m).map((line) => grammarTokens(line, args));
}

/** The verbs every microworld answers without a builder writing them (sprout.md §5). */
export type BuiltinVerbName =
  'look' | 'examine' | 'inventory' | 'take' | 'drop' | 'put' | 'give' | 'go' | 'wait' | 'help';

export interface BuiltinVerb {
  name: BuiltinVerbName;
  /** The lines as written, slots `[x]` and `[y]`. */
  lines: readonly string[];
  /** What each slot takes; an object unless said otherwise. */
  slots?: Readonly<Partial<Record<'x' | 'y', SlotKind>>>;
  /** The same lines tokenised, slot kinds applied. */
  tokens: readonly (readonly GrammarToken[])[];
}

function builtin(
  name: BuiltinVerbName,
  lines: readonly string[],
  slots?: BuiltinVerb['slots'],
): BuiltinVerb {
  const tokens = lines.map((line) =>
    grammarTokens(line, ['x', 'y']).map((t) =>
      'slot' in t ? { slot: t.slot, kind: slots?.[t.slot as 'x' | 'y'] ?? 'object' } : t,
    ),
  );
  return slots ? { name, lines, slots, tokens } : { name, lines, tokens };
}

/** The built-in verb table, in the order a matcher tries them. */
export const BUILTIN_VERBS: readonly BuiltinVerb[] = [
  builtin('look', ['look', 'l', 'look around']),
  builtin('examine', ['examine [x]', 'x [x]', 'look at [x]', 'inspect [x]', 'read [x]']),
  builtin('inventory', ['inventory', 'i', 'inv']),
  builtin('take', ['take [x]', 'get [x]', 'pick up [x]', 'pick [x] up', 'grab [x]']),
  builtin('drop', ['drop [x]', 'put down [x]', 'put [x] down'], { x: 'held' }),
  builtin('put', ['put [x] in [y]', 'put [x] into [y]', 'place [x] in [y]', 'put [x] on [y]'], {
    x: 'object',
    y: 'container',
  }),
  builtin('give', ['give [x] to [y]', 'hand [x] to [y]', 'offer [x] to [y]'], {
    x: 'held',
    y: 'person',
  }),
  builtin('go', ['go [x]', 'go through [x]', 'walk [x]', 'leave [x]', '[x]'], { x: 'exit' }),
  builtin('wait', ['wait', 'z']),
  builtin('help', ['help', '?', 'what can i do', 'what can i say']),
];
